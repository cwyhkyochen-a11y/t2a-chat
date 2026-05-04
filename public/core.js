// T2A Chat — 核心逻辑
// 职责：鉴权、WebSocket 管理、会话 CRUD、发送、流式控制、设置
// 依赖：dom-helpers.js (_t2aDom), slots.js (_t2aSlots)

(function () {
  'use strict';

  const API_BASE = '/api/chat';
  let currentConvId = null;
  let isStreaming = false;
  let wsManager = null;
  let _modelsCache = null;

  const dom = window._t2aDom;

  // 流式上下文
  const streamCtx = {
    streamDiv: null,
    content: '',
    ensureSegment() {
      if (this.streamDiv) return this.streamDiv;
      const container = dom.ensureContainer();
      const div = document.createElement('div');
      div.className = 'message assistant';
      div.innerHTML = '<div class="avatar">' + dom.IC_BOT + '</div><div><div class="bubble"><div class="stream-text"></div></div></div>';
      container.appendChild(div);
      this.streamDiv = div;
      this.content = '';
      dom.scrollToBottom();
      return div;
    },
    finalizeSegment() {
      if (!this.streamDiv) return;
      const t = this.streamDiv.querySelector('.stream-text');
      if (t) { t.classList.add('done'); if (!this.content) this.streamDiv.remove(); }
      this.streamDiv = null;
      this.content = '';
    },
  };

  // ---- 鉴权 ----
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
      onSync: function () {},
    });
    wsManager.connect();
  }

  function handleAuth(data) {
    const btn = document.getElementById('loginBtn');
    if (data.success) {
      document.getElementById('loginOverlay').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';
      btn.disabled = false; btn.textContent = 'Sign In';
      loadConversations();
      if (window._t2aSlots) window._t2aSlots.loadUiConfig(API_BASE);
      _loadModels();
    } else {
      document.getElementById('loginError').textContent = data.error || 'Invalid password';
      document.getElementById('loginError').classList.add('show');
      btn.disabled = false; btn.textContent = 'Sign In';
      clearPw();
    }
  }

  // ---- 连接状态 ----
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

  // ---- WS 事件 ----
  const toolRows = {};

  function handleTurnStart() { setStreamingUi(true); dom.showThinking(); }

  function handleTurnEnd(data) {
    streamCtx.finalizeSegment();
    dom.hideThinking();
    setStreamingUi(false);
    if (data && data.conversation_id) currentConvId = data.conversation_id;
    loadConversations();
  }

  function handleText(data) {
    dom.hideThinking();
    streamCtx.ensureSegment();
    streamCtx.content += (data.delta || '');
    const t = streamCtx.streamDiv.querySelector('.stream-text');
    if (t) t.innerHTML = dom.renderMd(streamCtx.content);
    dom.scrollToBottom();
  }

  function handleToolCall(data) {
    dom.hideThinking();
    streamCtx.finalizeSegment();
    const row = dom.appendToolMsg({ id: data.id, name: data.name, args: data.args || {}, status: 'processing' });
    if (data.id) toolRows[data.id] = row;
    dom.scrollToBottom();
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
    dom.scrollToBottom();
  }

  function handleToolError(data) {
    const row = toolRows[data.id];
    if (row) {
      row.classList.add('error');
      const badge = row.querySelector('.axis-badge');
      if (badge) { badge.className = 'axis-badge error'; badge.textContent = data.error ? String(data.error).slice(0, 40) : 'error'; }
    }
    dom.toast('工具出错：' + (data.error || 'unknown'), 'error');
  }

  function handleSystemEvent(data) {
    streamCtx.finalizeSegment();
    const source = data.source || 'system';
    const payload = data.payload || {};
    const summary = payload.message || payload.text || '';
    dom.appendSystemEventMsg(source, summary);
    dom.scrollToBottom();
    if (window._t2aSlots) window._t2aSlots.emit('system:event', data);
  }

  function handleNotice(data) {
    dom.appendNoticeMsg(data.text || data.code || '');
    dom.scrollToBottom();
  }

  function handleWsInterrupt() {
    const t = streamCtx.streamDiv && streamCtx.streamDiv.querySelector('.stream-text');
    if (t) {
      t.classList.add('done');
      const tag = document.createElement('span');
      tag.className = 'bubble-stopped-tag'; tag.textContent = '（已停止）';
      t.appendChild(tag);
    }
    streamCtx.finalizeSegment();
    dom.hideThinking();
    setStreamingUi(false);
    dom.toast('已停止', 'info', 1500);
  }

  function handleConversationCreated(data) {
    if (data.conversation_id) { currentConvId = data.conversation_id; loadConversations(); }
  }

  function handleWsError(data) { dom.toast('Error: ' + (data.error || 'unknown'), 'error'); }

  // ---- 会话管理 ----
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
        return '<div class="conv-item ' + active + '" onclick="t2aChat._internal.selectConversation(\'' + c.id + '\')">' +
          '<span class="conv-title">' + dom.esc(c.title || 'New Chat') + '</span>' +
          '<button class="conv-del" onclick="event.stopPropagation();t2aChat._internal.deleteConversation(\'' + c.id + '\')" title="Delete">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button></div>';
      }).join('') || '<div style="padding:20px;text-align:center;color:var(--color-text-tertiary);font-size:13px">No conversations</div>';
    } catch (e) { console.error('loadConversations error:', e); }
  }

  function newConversation() {
    currentConvId = null;
    document.getElementById('chatTitle').textContent = 'New Chat';
    dom.showWelcome();
    loadConversations();
    if (wsManager) wsManager.unsubscribe();
  }

  async function selectConversation(id) {
    currentConvId = id;
    loadConversations();
    await loadMessages(id);
    if (wsManager && wsManager.authenticated) wsManager.subscribe(id, null);
  }

  async function deleteConversation(id) {
    if (!confirm('Delete this conversation?')) return;
    const pw = getPw();
    await fetch(API_BASE + '/conversations/' + id, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_password: pw })
    });
    if (String(currentConvId) === String(id)) newConversation();
    loadConversations();
  }

  async function loadMessages(convId) {
    const pw = getPw();
    try {
      const res = await fetch(API_BASE + '/conversations/' + convId + '?user_password=' + encodeURIComponent(pw));
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('chatTitle').textContent = (data.conversation && data.conversation.title) || 'Chat';
      document.getElementById('messages').innerHTML = '';
      if (!data.messages || !data.messages.length) { dom.showWelcome(); return; }
      dom.renderHistory(data.messages);
      dom.scrollToBottom();
    } catch (e) { console.error('loadMessages error:', e); dom.toast('加载消息失败', 'warning'); }
  }

  // ---- 发送 ----
  function sendMessage(text, attachments) {
    var input = document.getElementById('msgInput');
    var message = text || input.value.trim();
    if (!message || isStreaming) return;
    if (!text) { input.value = ''; input.style.height = 'auto'; }
    dom.appendUserBubble(message);
    dom.scrollToBottom();
    setStreamingUi(true);
    wsManager.send(currentConvId, message, attachments || null);
    if (window._t2aSlots) window._t2aSlots.emit('message:sent', { text: message, conversationId: currentConvId });
  }

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

  // ---- 设置 ----
  function showSettings() { document.getElementById('settingsPass').value = getPw() || ''; document.getElementById('settingsModal').classList.add('active'); }
  function hideSettings() { document.getElementById('settingsModal').classList.remove('active'); }
  function saveSettings() {
    var pw = document.getElementById('settingsPass').value.trim();
    if (pw) { setPw(pw); if (wsManager) wsManager.disconnect(); connectWebSocket(pw); }
    hideSettings(); dom.toast('Settings saved', 'success');
  }
  function logout() {
    clearPw(); if (wsManager) wsManager.disconnect();
    document.getElementById('app').style.display = 'none';
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginPass').value = '';
    hideSettings();
  }

  // ---- 移动端 ----
  function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
  function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
  function autoResize(el) { el.style.height = '0px'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

  // ---- API 辅助 ----
  async function _loadModels(taskType) {
    try {
      const url = API_BASE + '/models' + (taskType ? '?taskType=' + encodeURIComponent(taskType) : '');
      const res = await fetch(url);
      if (res.ok) _modelsCache = await res.json();
    } catch (e) { console.warn('[t2aChat] loadModels failed:', e); }
  }

  async function apiCancelTask(taskId) {
    try {
      const res = await fetch(API_BASE + '/tasks/' + taskId + '/cancel', { method: 'POST' });
      const result = await res.json();
      if (window._t2aSlots) window._t2aSlots.emit('task:cancelled', { taskId, result });
      return result;
    } catch (e) { console.error('[t2aChat] cancelTask error:', e); dom.toast('取消失败', 'error'); }
  }

  async function apiCreateTask(type, params) {
    try {
      const res = await fetch(API_BASE + '/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params }),
      });
      const result = await res.json();
      if (window._t2aSlots) window._t2aSlots.emit('task:created', { type, result });
      return result;
    } catch (e) { console.error('[t2aChat] createTask error:', e); dom.toast('创建任务失败', 'error'); }
  }

  async function apiGetTaskStatus(taskId) {
    try {
      const res = await fetch(API_BASE + '/tasks?task_id=' + encodeURIComponent(taskId));
      if (res.ok) return await res.json();
    } catch (e) { console.error('[t2aChat] getTaskStatus error:', e); }
    return null;
  }

  // ---- 暴露 ----
  window._t2aCore = {
    get currentConvId() { return currentConvId; },
    get isStreaming() { return isStreaming; },
    get wsManager() { return wsManager; },
    doLogin, logout, connectWebSocket,
    loadConversations, newConversation, selectConversation, deleteConversation, loadMessages,
    sendMessage, stopStream,
    showSettings, hideSettings, saveSettings,
    toggleSidebar, handleKey, autoResize,
    showWelcome: dom.showWelcome,
    ensureContainer: dom.ensureContainer,
    appendUserBubble: dom.appendUserBubble,
    appendAssistantBubble: dom.appendAssistantBubble,
    appendToolMsg: dom.appendToolMsg,
    scrollToBottom: dom.scrollToBottom,
    toast: dom.toast, esc: dom.esc, renderMd: dom.renderMd,
    cancelTask: apiCancelTask, createTask: apiCreateTask, getTaskStatus: apiGetTaskStatus,
  };

  // ---- 自动登录 + 事件绑定 ----
  (function () {
    const pw = getPw();
    if (pw) connectWebSocket(pw);
  })();

  document.getElementById('loginPass').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });

  if (window._t2aSlots) {
    window._t2aSlots.on('suggestion:clicked', function (data) { if (data.text) sendMessage(data.text); });
    window._t2aSlots.on('task:cancel-request', function (data) { if (data.taskId) apiCancelTask(data.taskId); });
  }
})();
