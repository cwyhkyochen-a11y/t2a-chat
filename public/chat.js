// T2A Chat — Main Application Logic
const API_BASE = '/api/chat';

let currentConvId = null;
let isStreaming = false;
let wsManager = null;

// Stream context for progressive text rendering
const streamCtx = {
  streamDiv: null,
  content: '',
  ensureSegment() {
    if (this.streamDiv) return this.streamDiv;
    const container = ensureContainer();
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = '<div class="avatar">' + IC_BOT + '</div><div><div class="bubble"><div class="stream-text"></div></div></div>';
    container.appendChild(div);
    this.streamDiv = div;
    this.content = '';
    scrollToBottom();
    return div;
  },
  finalizeSegment() {
    if (!this.streamDiv) return;
    const t = this.streamDiv.querySelector('.stream-text');
    if (t) {
      t.classList.add('done');
      if (!this.content) this.streamDiv.remove();
    }
    this.streamDiv = null;
    this.content = '';
  },
};

// SVG Icons
const IC_USER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const IC_BOT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>';

// ---- Toast ----
function toast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3000;
  const container = document.getElementById('toastContainer');
  if (!container) return;
  while (container.children.length >= 3) container.removeChild(container.firstChild);
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 220); }, duration);
}

// ---- Auth ----
function getPw() { return localStorage.getItem('t2a-chat-pw'); }
function setPw(pw) { localStorage.setItem('t2a-chat-pw', pw); }
function clearPw() { localStorage.removeItem('t2a-chat-pw'); }

function doLogin() {
  const pw = document.getElementById('loginPass').value.trim();
  if (!pw) return;
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  document.getElementById('loginError').classList.remove('show');
  setPw(pw);
  connectWebSocket(pw);
}

function connectWebSocket(pw) {
  if (wsManager) wsManager.disconnect();

  wsManager = new ChatWSManager({
    password: pw,
    onAuth: handleAuth,
    onText: handleText,
    onToolCall: handleToolCall,
    onToolEnd: handleToolEnd,
    onToolError: handleToolError,
    onTurnStart: handleTurnStart,
    onTurnEnd: handleTurnEnd,
    onError: handleWsError,
    onNotice: handleNotice,
    onSystemEvent: handleSystemEvent,
    onConversationCreated: handleConversationCreated,
    onConnectionState: handleConnectionState,
    onInterrupt: handleWsInterrupt,
    onSync: handleSync,
  });
  wsManager.connect();
}

function handleAuth(data) {
  if (data.success) {
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    const btn = document.getElementById('loginBtn');
    btn.disabled = false;
    btn.textContent = 'Sign In';
    loadConversations();
  } else {
    document.getElementById('loginError').textContent = data.error || 'Invalid password';
    document.getElementById('loginError').classList.add('show');
    const btn = document.getElementById('loginBtn');
    btn.disabled = false;
    btn.textContent = 'Sign In';
    clearPw();
  }
}

// Auto-login
(function () {
  const pw = getPw();
  if (pw) {
    connectWebSocket(pw);
  }
})();

document.getElementById('loginPass').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') doLogin();
});

// ---- Connection state ----
function handleConnectionState(data) {
  const banner = document.getElementById('wsBanner');
  if (!banner) return;
  if (data.state === 'reconnecting') {
    banner.textContent = '连接断开，重连中...';
    banner.className = 'ws-banner disconnected';
    document.getElementById('sendBtn').disabled = true;
    document.getElementById('msgInput').disabled = true;
  } else if (data.state === 'connected') {
    banner.textContent = '已重连';
    banner.className = 'ws-banner connected';
    setTimeout(() => { banner.className = 'ws-banner'; }, 1500);
    document.getElementById('sendBtn').disabled = false;
    document.getElementById('msgInput').disabled = false;
  }
}

// ---- WebSocket event handlers ----
const toolRows = {};

function handleTurnStart() {
  setStreamingUi(true);
  showThinking();
}

function handleTurnEnd(data) {
  streamCtx.finalizeSegment();
  hideThinking();
  setStreamingUi(false);
  if (data && data.conversation_id) currentConvId = data.conversation_id;
  loadConversations();
}

function handleText(data) {
  hideThinking();
  streamCtx.ensureSegment();
  streamCtx.content += (data.delta || '');
  const t = streamCtx.streamDiv.querySelector('.stream-text');
  if (t) t.innerHTML = renderMd(streamCtx.content);
  scrollToBottom();
}

function handleToolCall(data) {
  hideThinking();
  streamCtx.finalizeSegment();
  const row = appendToolMsg({ id: data.id, name: data.name, args: data.args || {}, status: 'processing' });
  if (data.id) toolRows[data.id] = row;
  scrollToBottom();
}

function handleToolEnd(data) {
  const row = toolRows[data.id];
  if (row) {
    row.classList.add('done');
    const badge = row.querySelector('.axis-badge');
    if (badge) {
      badge.className = 'axis-badge done';
      badge.textContent = typeof data.durationMs === 'number' ? '✓ ' + Math.round(data.durationMs) + 'ms' : '✓ done';
    }
  }
  scrollToBottom();
}

function handleToolError(data) {
  const row = toolRows[data.id];
  if (row) {
    row.classList.add('error');
    const badge = row.querySelector('.axis-badge');
    if (badge) {
      badge.className = 'axis-badge error';
      badge.textContent = data.error ? String(data.error).slice(0, 40) : 'error';
    }
  }
  toast('工具出错：' + (data.error || 'unknown'), 'error');
}

function handleSystemEvent(data) {
  streamCtx.finalizeSegment();
  const container = ensureContainer();
  const div = document.createElement('div');
  div.className = 'axis-msg event';
  const source = data.source || 'system';
  const payload = data.payload || {};
  const summary = payload.message || payload.text || '';
  div.innerHTML =
    '<div class="axis-body">' +
      '<div class="axis-head">' +
        '<span class="axis-label">⚙ ' + esc(source) + '</span>' +
        '<span class="axis-summary">' + esc(summary) + '</span>' +
      '</div>' +
    '</div>';
  container.appendChild(div);
  scrollToBottom();
}

function handleNotice(data) {
  const container = ensureContainer();
  const div = document.createElement('div');
  div.className = 'notice-axis';
  div.innerHTML = '<span class="notice-tag">' + esc(data.text || data.code || '') + '</span>';
  container.appendChild(div);
  scrollToBottom();
}

function handleWsInterrupt() {
  const t = streamCtx.streamDiv && streamCtx.streamDiv.querySelector('.stream-text');
  if (t) {
    t.classList.add('done');
    const tag = document.createElement('span');
    tag.className = 'bubble-stopped-tag';
    tag.textContent = '（已停止）';
    t.appendChild(tag);
  }
  streamCtx.finalizeSegment();
  hideThinking();
  setStreamingUi(false);
  toast('已停止', 'info', 1500);
}

function handleConversationCreated(data) {
  if (data.conversation_id) {
    currentConvId = data.conversation_id;
    loadConversations();
  }
}

function handleSync() {}

function handleWsError(data) {
  toast('Error: ' + (data.error || 'unknown'), 'error');
}

// ---- Thinking indicator ----
function showThinking() {
  const container = ensureContainer();
  let dot = container.querySelector('.thinking-indicator');
  if (dot) return;
  dot = document.createElement('div');
  dot.className = 'message assistant thinking-indicator';
  dot.innerHTML = '<div class="avatar">' + IC_BOT + '</div><div><div class="bubble thinking"><span></span><span></span><span></span></div></div>';
  container.appendChild(dot);
  scrollToBottom();
}

function hideThinking() {
  const container = document.getElementById('messages');
  const dot = container && container.querySelector('.thinking-indicator');
  if (dot) dot.remove();
}

// ---- Conversations ----
async function loadConversations() {
  const pw = getPw();
  if (!pw) return;
  try {
    const res = await fetch(API_BASE + '/conversations?user_password=' + encodeURIComponent(pw));
    if (!res.ok) return;
    const convs = await res.json();
    const list = document.getElementById('convList');
    list.innerHTML = convs.map(function (c) {
      var active = String(c.id) === String(currentConvId) ? 'active' : '';
      return '<div class="conv-item ' + active + '" onclick="selectConversation(\'' + c.id + '\')">' +
        '<span class="conv-title">' + esc(c.title || 'New Chat') + '</span>' +
        '<button class="conv-del" onclick="event.stopPropagation();deleteConversation(\'' + c.id + '\')" title="Delete">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button></div>';
    }).join('') || '<div style="padding:20px;text-align:center;color:var(--color-text-tertiary);font-size:13px">No conversations</div>';
  } catch (e) {
    console.error('loadConversations error:', e);
  }
}

function newConversation() {
  currentConvId = null;
  document.getElementById('chatTitle').textContent = 'New Chat';
  showWelcome();
  loadConversations();
  if (wsManager) wsManager.unsubscribe();
}

async function selectConversation(id) {
  currentConvId = id;
  loadConversations();
  await loadMessages(id);
  if (wsManager && wsManager.authenticated) {
    wsManager.subscribe(id, null);
  }
}

async function deleteConversation(id) {
  if (!confirm('Delete this conversation?')) return;
  const pw = getPw();
  await fetch(API_BASE + '/conversations/' + id, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_password: pw })
  });
  if (String(currentConvId) === String(id)) newConversation();
  loadConversations();
}

// ---- Messages ----
async function loadMessages(convId) {
  const pw = getPw();
  try {
    const res = await fetch(API_BASE + '/conversations/' + convId + '?user_password=' + encodeURIComponent(pw));
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('chatTitle').textContent = (data.conversation && data.conversation.title) || 'Chat';
    const container = document.getElementById('messages');
    container.innerHTML = '';
    if (!data.messages || !data.messages.length) { showWelcome(); return; }
    renderHistory(data.messages);
    scrollToBottom();
  } catch (e) {
    console.error('loadMessages error:', e);
    toast('加载消息失败', 'warning');
  }
}

function renderHistory(messages) {
  const toolResultsByCallId = {};
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role === 'tool' && m.tool_call_id) toolResultsByCallId[m.tool_call_id] = m;
  }
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role === 'user') {
      appendUserBubble(m.content || '');
    } else if (m.role === 'assistant') {
      if (m.content) appendAssistantBubble(m.content, { interrupted: m.interrupted });
      if (m.tool_calls) {
        try {
          var tcs = JSON.parse(m.tool_calls);
          for (var j = 0; j < tcs.length; j++) {
            var tc = tcs[j];
            var fn = tc.function && tc.function.name;
            var args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
            appendToolMsg({ id: tc.id, name: fn, args: args, status: 'done' });
          }
        } catch (e) {}
      }
    } else if (m.role === 'notice') {
      var div = document.createElement('div');
      div.className = 'notice-axis';
      div.innerHTML = '<span class="notice-tag">' + esc(m.content || '') + '</span>';
      document.getElementById('messages').appendChild(div);
    } else if (m.role === 'system_event') {
      var payload = null;
      try { payload = JSON.parse(m.event_payload || 'null'); } catch (e) {}
      var container = ensureContainer();
      var div = document.createElement('div');
      div.className = 'axis-msg event';
      var source = m.event_source || 'system';
      var summary = payload && (payload.message || payload.text) || '';
      div.innerHTML =
        '<div class="axis-body">' +
          '<div class="axis-head">' +
            '<span class="axis-label">⚙ ' + esc(source) + '</span>' +
            '<span class="axis-summary">' + esc(summary) + '</span>' +
          '</div>' +
        '</div>';
      container.appendChild(div);
    }
  }
}

function showWelcome() {
  document.getElementById('messages').innerHTML =
    '<div class="welcome">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 16px;color:#b4b4b0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      '<h2>T2A Chat</h2>' +
      '<p>Start a conversation with your AI assistant</p>' +
    '</div>';
}

// ---- DOM helpers ----
function ensureContainer() {
  var container = document.getElementById('messages');
  var welcome = container.querySelector('.welcome');
  if (welcome) welcome.remove();
  return container;
}

function appendUserBubble(content) {
  var container = ensureContainer();
  var div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = '<div class="avatar">' + IC_USER + '</div><div class="bubble" style="white-space:pre-wrap">' + esc(content) + '</div>';
  container.appendChild(div);
}

function appendAssistantBubble(content, opts) {
  var container = ensureContainer();
  var div = document.createElement('div');
  div.className = 'message assistant';
  var stopTag = opts && opts.interrupted ? '<span class="bubble-stopped-tag">（已停止）</span>' : '';
  div.innerHTML = '<div class="avatar">' + IC_BOT + '</div><div><div class="bubble">' + renderMd(content) + stopTag + '</div></div>';
  container.appendChild(div);
}

function appendToolMsg(opts) {
  var container = ensureContainer();
  var div = document.createElement('div');
  var statusCls = opts.status || 'processing';
  div.className = 'axis-msg tool' + (opts.status === 'done' ? ' done' : '') + (opts.status === 'error' ? ' error' : '');
  if (opts.id) div.dataset.toolId = opts.id;

  var label = opts.name || 'tool';
  var summary = '';
  if (opts.args) {
    var keys = Object.keys(opts.args);
    if (keys.length > 0) {
      var parts = [];
      for (var k = 0; k < Math.min(keys.length, 3); k++) {
        var val = String(opts.args[keys[k]]).slice(0, 50);
        parts.push(keys[k] + ':' + val);
      }
      summary = parts.join(', ');
    }
  }

  var badgeText = opts.status === 'done' ? '✓ done' : '⏳';
  var badgeCls = statusCls;

  div.innerHTML =
    '<div class="axis-body">' +
      '<div class="axis-head">' +
        '<span class="axis-label">🔧 ' + esc(label) + '</span>' +
        '<span class="axis-summary">' + esc(summary) + '</span>' +
        '<span class="axis-badge ' + badgeCls + '">' + esc(badgeText) + '</span>' +
      '</div>' +
      '<div class="axis-detail"><pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:11px;margin:0">' + esc(JSON.stringify(opts.args || {}, null, 2)) + '</pre></div>' +
    '</div>';

  var head = div.querySelector('.axis-head');
  head.onclick = function () { div.classList.toggle('expanded'); };
  container.appendChild(div);
  return div;
}

// ---- Send ----
function sendMessage() {
  var input = document.getElementById('msgInput');
  var message = input.value.trim();
  if (!message || isStreaming) return;
  input.value = '';
  input.style.height = 'auto';

  appendUserBubble(message);
  scrollToBottom();
  setStreamingUi(true);

  wsManager.send(currentConvId, message, null);
}

// ---- Stream control ----
function stopStream() {
  if (!isStreaming || !currentConvId) return;
  if (wsManager) wsManager.interrupt(currentConvId);
}

function setStreamingUi(streaming) {
  isStreaming = streaming;
  document.getElementById('sendBtn').disabled = streaming;
  document.getElementById('sendBtn').style.display = streaming ? 'none' : 'flex';
  document.getElementById('stopBtn').style.display = streaming ? 'flex' : 'none';
}

// ---- Settings ----
function showSettings() {
  document.getElementById('settingsPass').value = getPw() || '';
  document.getElementById('settingsModal').classList.add('active');
}

function hideSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

function saveSettings() {
  var pw = document.getElementById('settingsPass').value.trim();
  if (pw) {
    setPw(pw);
    if (wsManager) wsManager.disconnect();
    connectWebSocket(pw);
  }
  hideSettings();
  toast('Settings saved', 'success');
}

function logout() {
  clearPw();
  if (wsManager) wsManager.disconnect();
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('loginPass').value = '';
  hideSettings();
}

// ---- Mobile sidebar ----
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ---- Utilities ----
function scrollToBottom() {
  var el = document.getElementById('messages');
  requestAnimationFrame(function () { el.scrollTop = el.scrollHeight; });
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = '0px';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderMd(text) {
  if (!text) return '';
  var html = esc(text);
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Ordered list
  html = html.replace(/^(\d+)[\.、．]\s*(.+)$/gm, '<oli>$2</oli>');
  // Unordered list
  html = html.replace(/^[-*•]\s+(.+)$/gm, '<uli>$1</uli>');
  // Wrap lists
  html = html.replace(/(?:<oli>[\s\S]*?<\/oli>(?:\n)?)+/g, function (m) {
    return '<ol>' + m.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>').replace(/\n/g, '') + '</ol>';
  });
  html = html.replace(/(?:<uli>[\s\S]*?<\/uli>(?:\n)?)+/g, function (m) {
    return '<ul>' + m.replace(/<uli>/g, '<li>').replace(/<\/uli>/g, '</li>').replace(/\n/g, '') + '</ul>';
  });
  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return '<p>' + html + '</p>';
}
