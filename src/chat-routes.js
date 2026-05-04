// chat-routes.js — chat 模块的非流式接口
// 会话列表 / 详情 / 删除 / agent-config / settings
//
// v0.2.0: 改造为统一通过 ctx.resolveUser(req) 鉴权，不再读 user_password 字段

const { readBody, jsonRes } = require('./utils');

// ---- 路由分发 ----
async function handle(req, res, ctx) {
  const url = req.url.split('?')[0];
  const method = req.method;

  // POST /api/chat — 发送消息（创建对话）
  if (url === '/api/chat' && method === 'POST') {
    const chatHandler = require('./chat-handler');
    return chatHandler.handleChat(req, res, ctx);
  }

  // GET /api/chat/conversations
  if (url === '/api/chat/conversations' && method === 'GET') {
    return handleGetConversations(req, res, ctx);
  }

  // POST /api/chat/conversations
  if (url === '/api/chat/conversations' && method === 'POST') {
    return handleCreateConversation(req, res, ctx);
  }

  // GET /api/chat/settings
  if (url === '/api/chat/settings' && method === 'GET') {
    return handleGetSettings(req, res, ctx);
  }

  // PUT /api/chat/settings
  if (url === '/api/chat/settings' && method === 'PUT') {
    return handleUpdateSettings(req, res, ctx);
  }

  // /api/chat/conversations/:id
  const convMatch = url.match(/^\/api\/chat\/conversations\/(\d+)$/);
  if (convMatch) {
    const id = Number(convMatch[1]);
    if (method === 'GET') return handleGetConversationDetail(req, res, ctx, id);
    if (method === 'DELETE') return handleDeleteConversation(req, res, ctx, id);
  }

  // POST /api/chat/:id/interrupt
  const interruptMatch = url.match(/^\/api\/chat\/(\d+)\/interrupt$/);
  if (interruptMatch && method === 'POST') {
    const chatHandler = require('./chat-handler');
    return chatHandler.handleInterrupt(req, res, ctx, Number(interruptMatch[1]));
  }

  // GET /api/chat/agent-config
  if (url === '/api/chat/agent-config' && method === 'GET') {
    return handleGetAgentConfig(req, res, ctx);
  }

  // PUT /api/chat/agent-config
  if (url === '/api/chat/agent-config' && method === 'PUT') {
    return handleUpdateAgentConfig(req, res, ctx);
  }

  return false; // 不匹配
}

// ---- Handlers ----

async function handleGetConversations(req, res, ctx) {
  const { resolveUser, dbChat } = ctx;
  try {
    const user = await resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    return jsonRes(res, 200, dbChat.getConversations(user.id));
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleCreateConversation(req, res, ctx) {
  const { resolveUser, dbChat } = ctx;
  try {
    const user = await resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const body = JSON.parse((await readBody(req)).toString());
    return jsonRes(res, 200, { id: dbChat.createConversation(user.id, body.title) });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleDeleteConversation(req, res, ctx, id) {
  const { resolveUser, dbChat, db } = ctx;
  try {
    const user = await resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const conv = dbChat.getConversation(id);
    if (!conv) return jsonRes(res, 404, { error: '对话不存在' });
    if (conv.user_id !== user.id) return jsonRes(res, 403, { error: '无权删除此对话' });
    dbChat.deleteConversation(id);
    // 清理 t2a_messages / t2a_sessions
    try {
      db.prepare('DELETE FROM t2a_messages WHERE session_id = ?').run(String(id));
      db.prepare('DELETE FROM t2a_sessions WHERE id = ?').run(String(id));
    } catch (e) {
      console.warn('[chat] delete t2a rows failed', e.message);
    }
    return jsonRes(res, 200, { ok: true });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

// GET /api/chat/conversations/:id — 历史回放（单一数据源：t2a_messages）
async function handleGetConversationDetail(req, res, ctx, id) {
  const { resolveUser, dbChat, db } = ctx;
  try {
    const user = await resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const conv = dbChat.getConversation(id);
    if (!conv) return jsonRes(res, 404, { error: '对话不存在' });
    if (conv.user_id !== user.id) return jsonRes(res, 403, { error: '无权访问此对话' });

    const t2aRows = db.prepare(
      `SELECT id, role, content, content_type, tool_calls, tool_call_id,
              event_source, event_payload, event_default_response,
              event_trigger_agent, interrupted, created_at
         FROM t2a_messages
        WHERE session_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC`
    ).all(String(id));

    const messages = t2aRows.map(r => ({
      id: r.id,
      role: r.role,
      content: r.content,
      content_type: r.content_type,
      tool_calls: r.tool_calls,
      tool_call_id: r.tool_call_id,
      event_source: r.event_source,
      event_payload: r.event_payload,
      interrupted: !!r.interrupted,
      created_at: r.created_at,
    }));

    return jsonRes(res, 200, { conversation: conv, messages });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

function handleGetAgentConfig(req, res, ctx) {
  const { dbConfig } = ctx;
  try {
    return jsonRes(res, 200, dbConfig.getAgentConfig() || {});
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleUpdateAgentConfig(req, res, ctx) {
  const { dbConfig, taskRegistry } = ctx;
  try {
    const body = JSON.parse((await readBody(req)).toString());
    // T3: 默认模型必须从枚举中选（如果传了 model 字段）
    if (body.model && taskRegistry) {
      const allModels = taskRegistry.getModels();
      if (allModels.length > 0 && !allModels.find(m => m.id === body.model)) {
        return jsonRes(res, 400, { error: `model "${body.model}" 不在已注册的枚举中` });
      }
    }
    const config = dbConfig.getAgentConfig();
    if (!config) return jsonRes(res, 404, { error: 'No agent config found' });
    dbConfig.updateAgentConfig(config.id, body);
    return jsonRes(res, 200, { ok: true });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

// GET /api/chat/settings — 公开读取（不含敏感 key）
function handleGetSettings(req, res, ctx) {
  const { dbConfig } = ctx;
  const all = dbConfig.getAllSettings();
  const safe = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.includes('api_key')) continue;
    safe[k] = v;
  }
  return jsonRes(res, 200, safe);
}

// PUT /api/chat/settings
async function handleUpdateSettings(req, res, ctx) {
  const { dbConfig } = ctx;
  const body = JSON.parse((await readBody(req)).toString());
  for (const [k, v] of Object.entries(body)) {
    dbConfig.setSetting(k, v);
  }
  return jsonRes(res, 200, { ok: true });
}

module.exports = {
  handle,
  handleGetConversations,
  handleCreateConversation,
  handleGetConversationDetail,
  handleDeleteConversation,
  handleGetAgentConfig,
  handleUpdateAgentConfig,
  handleGetSettings,
  handleUpdateSettings,
};
