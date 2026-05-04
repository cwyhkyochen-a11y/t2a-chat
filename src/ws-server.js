// WebSocket server for real-time chat events
// 绑定到已有 http.Server
//
// v0.2.0: auth 改为 resolveWsUser（从 upgrade 请求鉴权），
// 移除客户端 auth 消息流程，连接时即鉴权

const WebSocket = require('ws');

let wss = null;

// ---- 心跳 ----
const PING_INTERVAL = 30000;

/**
 * @param {import('http').Server} server
 * @param {object} deps
 * @param {object} deps.db - better-sqlite3 实例
 * @param {object} deps.dbChat - db-chat 模块
 * @param {object} deps.dbConfig - db-config 模块
 * @param {object} deps.dbChatLLM - db-chat-llm 模块
 * @param {function} deps.resolveWsUser - (req) => { id, name } | null
 * @param {import('./session-pool').SessionPool} deps.sessionPool
 * @param {string} deps.basePath
 */
function initWebSocket(server, deps) {
  const { dbChat, resolveWsUser, sessionPool, basePath } = deps;
  const wsPath = basePath + '/ws';

  wss = new WebSocket.Server({ noServer: true });

  // 在 HTTP upgrade 时完成鉴权
  server.on('upgrade', async (req, socket, head) => {
    const pathname = req.url ? req.url.split('?')[0] : '';
    if (pathname !== wsPath) {
      // 不是我们的 ws 路径，忽略（让其他 handler 处理）
      socket.destroy();
      return;
    }

    let user = null;
    try {
      user = await resolveWsUser(req);
    } catch (err) {
      console.error('[ws] resolveWsUser error:', err.message);
    }
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = user.id;
      ws.userName = user.name;
      ws.authenticated = true;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    ws.conversationId = null;
    ws._unsubs = [];
    ws._alive = true;
    ws._baseUrl = buildBaseUrl(req);
    ws._deps = deps;

    // 鉴权已在 upgrade 阶段完成，直接发 auth_ok
    safeSend(ws, { type: 'auth_ok', user_id: ws.userId });

    // Heartbeat
    ws._pingInterval = setInterval(() => {
      if (!ws._alive) {
        ws.terminate();
        return;
      }
      ws._alive = false;
      safeSend(ws, { type: 'ping' });
    }, PING_INTERVAL);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      handleClientMessage(ws, msg);
    });

    ws.on('close', () => cleanup(ws));
    ws.on('error', () => cleanup(ws));
  });

  return wss;
}

function buildBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['host'] || 'localhost:3000';
  return proto + '://' + host;
}

function cleanup(ws) {
  clearInterval(ws._pingInterval);
  unbindSession(ws);
}

function unbindSession(ws) {
  while (ws._unsubs.length) {
    try { ws._unsubs.pop()(); } catch {}
  }
  ws.conversationId = null;
}

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ---- 消息路由 ----
function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'subscribe': return handleSubscribe(ws, msg);
    case 'unsubscribe': return handleUnsubscribe(ws);
    case 'send': return handleSend(ws, msg);
    case 'interrupt': return handleInterrupt(ws, msg);
    case 'pong':
      ws._alive = true;
      return;
    default: break;
  }
}

// ---- Subscribe ----
function handleSubscribe(ws, msg) {
  const { dbChat, sessionPool } = ws._deps;
  const convId = msg.conversation_id;
  if (!convId) {
    safeSend(ws, { type: 'error', error: 'conversation_id required' });
    return;
  }
  const conv = dbChat.getConversation(convId);
  if (!conv) {
    safeSend(ws, { type: 'error', error: '对话不存在' });
    return;
  }
  if (conv.user_id !== ws.userId) {
    safeSend(ws, { type: 'error', error: '无权访问此对话' });
    return;
  }

  // 解绑旧 session 事件
  unbindSession(ws);
  ws.conversationId = convId;

  const session = sessionPool.getOrCreateSession(convId, ws.userId, ws._baseUrl);
  bindSessionEvents(ws, session);

  // 如果 session 正在忙，通知客户端 turn_start
  const state = session.getState();
  if (state === 'thinking' || state === 'streaming' || state === 'tool_running') {
    safeSend(ws, { type: 'turn_start' });
  }

  // 同步缺失消息
  if (msg.last_message_id != null) {
    try {
      const allMsgs = dbChat.getMessages(convId);
      const missed = allMsgs.filter(m => m.id > msg.last_message_id);
      if (missed.length > 0) {
        safeSend(ws, { type: 'sync', messages: missed });
      }
    } catch {}
  }

  safeSend(ws, { type: 'subscribed', conversation_id: convId });
}

// ---- Unsubscribe ----
function handleUnsubscribe(ws) {
  unbindSession(ws);
  safeSend(ws, { type: 'unsubscribed' });
}

// ---- Send ----
function handleSend(ws, msg) {
  const { dbChat, sessionPool } = ws._deps;
  let convId = msg.conversation_id;
  const message = msg.message || '';
  const imageUrl = msg.image_url || null;
  if (!message && !imageUrl) {
    safeSend(ws, { type: 'error', error: 'message or image_url required' });
    return;
  }

  // 创建新对话
  if (!convId) {
    const title = (message || '图片').slice(0, 20) + ((message || '').length > 20 ? '...' : '');
    convId = dbChat.createConversation(ws.userId, title);
    safeSend(ws, { type: 'conversation_created', conversation_id: convId });
  } else {
    // 验证权限
    const conv = dbChat.getConversation(convId);
    if (!conv || conv.user_id !== ws.userId) {
      safeSend(ws, { type: 'error', error: '无权访问此对话' });
      return;
    }
  }

  // 如果当前未 subscribe 此对话，先切换
  if (ws.conversationId !== convId) {
    unbindSession(ws);
    ws.conversationId = convId;
    const session = sessionPool.getOrCreateSession(convId, ws.userId, ws._baseUrl);
    bindSessionEvents(ws, session);
  }

  const session = sessionPool.getOrCreateSession(convId, ws.userId, ws._baseUrl);

  // 构建 content
  let content;
  const userText = message.trim();
  if (imageUrl) {
    const absUrl = imageUrl.startsWith('http') ? imageUrl : ws._baseUrl + imageUrl;
    const parts = [];
    if (userText) parts.push({ type: 'text', text: userText });
    parts.push({ type: 'image_url', imageUrl: { url: absUrl } });
    content = parts;
  } else {
    content = userText;
  }

  // turn_start
  safeSend(ws, { type: 'turn_start' });

  session.sendUserMessage(content)
    .then(() => {
      safeSend(ws, { type: 'turn_end', conversation_id: convId });
    })
    .catch(err => {
      safeSend(ws, { type: 'error', error: err && err.message || String(err) });
      safeSend(ws, { type: 'turn_end', conversation_id: convId });
    });
}

// ---- Interrupt ----
function handleInterrupt(ws, msg) {
  const { sessionPool } = ws._deps;
  const convId = msg.conversation_id || ws.conversationId;
  if (!convId) return;
  const session = sessionPool.peek(String(convId));
  if (session) session.interrupt('user');
}

// ---- 绑定 session bus 事件 ----
function bindSessionEvents(ws, session) {
  const push = (type, data) => safeSend(ws, { type, ...data });

  const unsubs = [];
  unsubs.push(session.on('text', p => push('text', { delta: p.delta })));
  unsubs.push(session.on('tool_start', p => push('tool_call', { id: p.id, name: p.name, args: p.args })));
  unsubs.push(session.on('tool_end', p => push('tool_end', { id: p.id, name: p.name, result: p.result, durationMs: p.durationMs })));
  unsubs.push(session.on('tool_error', p => push('tool_error', { id: p.id, name: p.name, error: p.error && p.error.message || String(p.error) })));
  unsubs.push(session.on('system_event_arrived', p => push('system_event', { source: p.source, payload: p.payload })));
  unsubs.push(session.on('interrupt', p => push('interrupt', { reason: p.reason })));
  unsubs.push(session.on('overflow_warning', p => push('overflow_warning', { used: p.used, max: p.max })));
  unsubs.push(session.on('overflow_hit', p => push('overflow_hit', { used: p.used, max: p.max })));
  unsubs.push(session.on('interlude', p => push('interlude', { bucket: p.bucket, text: p.text })));
  unsubs.push(session.on('long_wait', p => push('long_wait', { id: p.id, name: p.name, elapsedMs: p.elapsedMs })));
  unsubs.push(session.on('system_notice', p => push('system_notice', { code: p.code, text: p.text })));
  unsubs.push(session.on('notice', p => push('notice', { type: p.type, text: p.text, payload: p.payload })));
  unsubs.push(session.on('error', p => push('error', { error: p.error && p.error.message || String(p.error) })));

  ws._unsubs = unsubs;
}

// ---- 外部推送接口 ----
function pushToConversation(conversationId, message) {
  if (!wss) return;
  const convIdStr = String(conversationId);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN && String(ws.conversationId) === convIdStr) {
      ws.send(JSON.stringify(message));
    }
  }
}

module.exports = { initWebSocket, pushToConversation };
