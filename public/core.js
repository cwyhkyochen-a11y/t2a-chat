// T2A Chat — 核心逻辑
// 职责：鉴权、WebSocket 管理、会话 CRUD、发送、流式控制、设置
// 依赖：dom-helpers.js (_t2aDom), slots.js (_t2aSlots)

(function () {
  'use strict';

  // v0.2.0 P2: API_BASE / LOGIN_URL 可由宿主通过 window.T2A_CHAT_CONFIG 覆盖
  const _cfg = window.T2A_CHAT_CONFIG || {};
  const API_BASE = _cfg.apiBase || '/api/chat';
  const LOGIN_URL = _cfg.loginUrl || (API_BASE + '/login');
  let currentConvId = null;
  let isStreaming = false;
  let wsManager = null;
  let _modelsCache = null;
  let _selectEpoch = 0;
  let _selectAbortController = null;

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
      if (t) {
        t.classList.add('done');
        if (!this.content) {
          this.streamDiv.remove();
        } else {
          dom.hydrateFormPlaceholders(this.streamDiv);
        }
      }
      this.streamDiv = null;
      this.content = '';
      this._thinkingDetails = null;
    },
  };

  // ---- 鉴权 ----
  function getPw() { return localStorage.getItem('t2a-chat-pw'); }
  function setPw(pw) { localStorage.setItem('t2a-chat-pw', pw); }
  function clearPw() { localStorage.removeItem('t2a-chat-pw'); }

  async function doLogin() {
    const pw = document.getElementById('loginPass').value.trim();
    if (!pw) return;
    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    document.getElementById('loginError').classList.remove('show');

    // v0.2.0 P2: 先调宿主 login 接口（设置 cookie），成功后再连 WS
    try {
      const res = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        let errMsg = 'Invalid password';
        try { const j = await res.json(); if (j && j.error) errMsg = j.error; } catch (e) {}
        document.getElementById('loginError').textContent = errMsg;
        document.getElementById('loginError').classList.add('show');
        btn.disabled = false; btn.textContent = 'Sign In';
        return;
      }
      // 登录成功，cookie 已 set；保存密码方便重连提示，但鉴权走 cookie
      setPw(pw);
      connectWebSocket(pw);
    } catch (err) {
      document.getElementById('loginError').textContent = 'Network error';
      document.getElementById('loginError').classList.add('show');
      btn.disabled = false; btn.textContent = 'Sign In';
    }
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
      onInterlude: handleInterlude,
      onThinking: handleThinking,
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
      // v0.2.0 P2: 触发 ready 事件，adapter 可以做后置初始化
      if (window._t2aSlots) window._t2aSlots.emit('ready', { apiBase: API_BASE });
    } else {
      document.getElementById('loginError').textContent = data.error || 'Invalid password';
      document.getElementById('loginError').classList.add('show');
      btn.disabled = false; btn.textContent = 'Sign In';
      clearPw();
      // v0.2.1: cookie 过期 / WS 被踢 → 重新显示登录浮层
      document.getElementById('loginOverlay').classList.remove('hidden');
      document.getElementById('app').style.display = 'none';
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
    if (currentConvId) loadContextUsage(currentConvId);
  }

  function handleText(data) {
    dom.hideThinking();
    // Close thinking block when first text delta arrives
    if (streamCtx._thinkingDetails) {
      streamCtx._thinkingDetails.removeAttribute('open');
      streamCtx._thinkingDetails = null;
    }
    streamCtx.ensureSegment();
    streamCtx.content += (data.delta || '');
    const t = streamCtx.streamDiv.querySelector('.stream-text');
    if (t) t.innerHTML = dom.renderMd(streamCtx.content);
    dom.scrollToBottom();
  }

  function handleInterlude(data) {
    streamCtx.finalizeSegment();
    dom.hideThinking();
    dom.appendInterludeMsg(data.text || '');
    dom.scrollToBottom();
  }

  function handleThinking(data) {
    dom.hideThinking();
    const container = dom.ensureContainer();
    if (!streamCtx._thinkingDetails) {
      const details = document.createElement('details');
      details.className = 'thinking-block';
      details.setAttribute('open', '');
      details.innerHTML = '<summary>\ud83d\udcad Thinking...</summary><div class="thinking-content"></div>';
      container.appendChild(details);
      streamCtx._thinkingDetails = details;
    }
    const content = streamCtx._thinkingDetails.querySelector('.thinking-content');
    if (content) content.textContent += (data.delta || '');
    dom.scrollToBottom();
  }

  function handleToolCall(data) {
    dom.hideThinking();
    streamCtx.finalizeSegment();
    const row = dom.appendToolMsg({ id: data.id, name: data.name, args: data.args || {}, status: 'processing' });
    if (data.id) toolRows[data.id] = row;
    dom.scrollToBottom();
    // v0.2.0 P2: 暴露给 adapter 做后处理（如：imagine 把 tool row 升级成 task badge）
    if (window._t2aSlots) window._t2aSlots.emit('tool:call', { ...data, row });
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
    // v0.2.0 P2: adapter 钩子
    if (window._t2aSlots) window._t2aSlots.emit('tool:end', { ...data, row });
  }

  function handleToolError(data) {
    const row = toolRows[data.id];
    if (row) {
      row.classList.add('error');
      const badge = row.querySelector('.axis-badge');
      if (badge) { badge.className = 'axis-badge error'; badge.textContent = data.error ? String(data.error).slice(0, 40) : 'error'; }
    }
    dom.toast('工具出错：' + (data.error || 'unknown'), 'error');
    if (window._t2aSlots) window._t2aSlots.emit('tool:error', { ...data, row });
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
    try {
      // v0.2.0 P2: 鉴权走 cookie，不再传 user_password
      const res = await fetch(API_BASE + '/conversations', { credentials: 'include' });
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
    setStreamingUi(false);
    const myEpoch = ++_selectEpoch;
    // 中断上一次选择的 in-flight fetch，释放浏览器 connection
    if (_selectAbortController) {
      try { _selectAbortController.abort(); } catch (e) {}
    }
    _selectAbortController = new AbortController();
    const signal = _selectAbortController.signal;
    currentConvId = id;
    // 立即更新选中态（不等 loadConversations fetch 回来）
    document.querySelectorAll('.conv-item').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('onclick') && el.getAttribute('onclick').indexOf("'" + id + "'") >= 0);
    });
    loadConversations();
    // emit switching 事件，adapter 可以做清理 + 显示 loading
    if (window._t2aSlots) window._t2aSlots.emit('conversation:switching', { id: id });
    // 立即显示消息区 loading
    dom.showMessagesLoading();
    // subscribe 提前：不依赖 messages 已加载，currentConvId 已赋值
    if (wsManager && wsManager.authenticated) wsManager.subscribe(id, null);
    // messages 与 context-usage 并行拉取
    await Promise.all([loadMessages(id, myEpoch, signal), loadContextUsage(id, myEpoch, signal)]);
  }

  async function deleteConversation(id) {
    if (!confirm('Delete this conversation?')) return;
    await fetch(API_BASE + '/conversations/' + id, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (String(currentConvId) === String(id)) newConversation();
    loadConversations();
  }

  async function loadMessages(convId, epoch, signal) {
    try {
      const res = await fetch(API_BASE + '/conversations/' + convId, { credentials: 'include', signal: signal });
      if (!res.ok) { dom.hideMessagesLoading(); return; }
      const data = await res.json();
      // 竞态校验：若 epoch 已过期，静默丢弃
      if (epoch !== undefined && epoch !== _selectEpoch) return;
      dom.hideMessagesLoading();
      document.getElementById('chatTitle').textContent = (data.conversation && data.conversation.title) || 'Chat';
      document.getElementById('messages').innerHTML = '';
      if (!data.messages || !data.messages.length) { dom.showWelcome(); return; }
      dom.renderHistory(data.messages);
      dom.scrollToBottom();
      // v0.2.0 P2: adapter 钩子，可基于历史回放 tool_calls 还原任务状态
      if (window._t2aSlots) window._t2aSlots.emit('history:loaded', { conversationId: convId, messages: data.messages, raw: data });
    } catch (e) {
      // AbortError 静默丢弃（被主动 abort）
      if (e && e.name === 'AbortError') return;
      if (epoch !== undefined && epoch !== _selectEpoch) return;
      dom.hideMessagesLoading();
      console.error('loadMessages error:', e); dom.toast('加载消息失败', 'warning');
    }
  }

  // ---- 发送 ----
  function sendMessage(text, attachments) {
    var input = document.getElementById('msgInput');
    var message = text || input.value.trim();
    if (!attachments && window._t2aAttachments) {
      attachments = window._t2aAttachments.getCurrent();
      if (attachments && attachments.length === 0) attachments = null;
    }
    if ((!message && !attachments) || isStreaming) return;
    if (!text) { input.value = ''; input.style.height = 'auto'; }
    dom.appendUserBubble(message, attachments || null);
    dom.scrollToBottom();
    setStreamingUi(true);
    wsManager.send(currentConvId, message, attachments || null);
    if (window._t2aSlots) window._t2aSlots.emit('message:sent', { text: message, conversationId: currentConvId });
    if (window._t2aAttachments) window._t2aAttachments.clear();
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
  function showSettings() {
    document.getElementById('settingsPass').value = getPw() || '';
    document.getElementById('settingsModal').classList.add('active');
    if (window._t2aSlots && window._t2aSlots.loadConfigPanels) window._t2aSlots.loadConfigPanels();
  }
  function hideSettings() { document.getElementById('settingsModal').classList.remove('active'); }
  async function saveSettings() {
    var pw = document.getElementById('settingsPass').value.trim();
    if (pw) { setPw(pw); if (wsManager) wsManager.disconnect(); connectWebSocket(pw); }
    if (window._t2aSlots && window._t2aSlots.saveConfigPanels) await window._t2aSlots.saveConfigPanels();
    hideSettings(); dom.toast('Settings saved', 'success');
  }
  function logout() {
    clearPw(); if (wsManager) wsManager.disconnect();
    // v0.2.0 P2: 通知宿主清 cookie
    fetch(API_BASE + '/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
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
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) _modelsCache = await res.json();
    } catch (e) { console.warn('[t2aChat] loadModels failed:', e); }
  }

  async function apiCancelTask(taskId) {
    try {
      const res = await fetch(API_BASE + '/tasks/' + taskId + '/cancel', { method: 'POST', credentials: 'include' });
      const result = await res.json();
      if (window._t2aSlots) window._t2aSlots.emit('task:cancelled', { taskId, result });
      return result;
    } catch (e) { console.error('[t2aChat] cancelTask error:', e); dom.toast('取消失败', 'error'); }
  }

  async function apiCreateTask(type, params) {
    try {
      const res = await fetch(API_BASE + '/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, params }),
      });
      const result = await res.json();
      if (window._t2aSlots) window._t2aSlots.emit('task:created', { type, result });
      return result;
    } catch (e) { console.error('[t2aChat] createTask error:', e); dom.toast('创建任务失败', 'error'); }
  }

  async function apiGetTaskStatus(taskId) {
    try {
      const res = await fetch(API_BASE + '/tasks/' + encodeURIComponent(taskId), { credentials: 'include' });
      if (res.ok) return await res.json();
    } catch (e) { console.error('[t2aChat] getTaskStatus error:', e); }
    return null;
  }

  // ---- Slash commands ----
  function _registerDefaultCommands() {
    if (!window._t2aCommands) return;
    window._t2aCommands.registerCommand({
      name: '/compact',
      description: '压缩当前会话历史，保留最近几轮',
      handler: async function () {
        if (!currentConvId) { dom.toast('请先选择或发起一个对话', 'warning'); return; }
        if (isStreaming) { dom.toast('流式进行中，请稍候', 'warning'); return; }
        try {
          dom.toast('压缩中…', 'info', 1500);
          const res = await fetch(API_BASE + '/conversations/' + currentConvId + '/compact', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keepLastN: 10 }),
          });
          if (res.ok) {
            dom.toast('已压缩对话历史', 'success');
            await loadMessages(currentConvId);
          } else {
            let msg = '压缩失败';
            try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
            dom.toast(msg, 'error');
          }
        } catch (e) { dom.toast('网络错误', 'error'); }
      },
    });
    window._t2aCommands.registerCommand({
      name: '/clear',
      description: '新建一个对话',
      handler: async function () { newConversation(); },
    });
    const msgInput = document.getElementById('msgInput');
    if (msgInput) window._t2aCommands.init(msgInput);
  }

  // ---- Context usage ----
  async function loadContextUsage(convId, epoch, signal) {
    const el = document.getElementById('contextUsage');
    if (!el) return;
    try {
      const res = await fetch(API_BASE + '/conversations/' + convId + '/context-usage', { credentials: 'include', signal: signal });
      if (!res.ok) { el.textContent = ''; return; }
      const data = await res.json();
      // 竞态校验
      if (epoch !== undefined && epoch !== _selectEpoch) return;
      const used = data.used || 0;
      const max = data.max || 0;
      const warning = data.warning || 0;
      if (!max) { el.textContent = ''; return; }
      const pct = used / max;
      const usedK = (used / 1000).toFixed(1) + 'k';
      const maxK = (max / 1000).toFixed(1) + 'k';
      el.textContent = usedK + ' / ' + maxK;
      el.className = 'context-usage';
      if (pct > 0.9) {
        el.classList.add('danger');
      } else if (used > warning && warning > 0) {
        el.classList.add('warn');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      el.textContent = '';
    }
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
  // 初始化默认 slash commands
  _registerDefaultCommands();

  // v0.5.0: 初始化附件管理器
  if (window._t2aAttachments) window._t2aAttachments.init();

  // v0.2.0 P2: cookie-based auth，启动时直接尝试连接 WS。
  // 如果 cookie 还在 → upgrade 鉴权通过 → auth_ok；否则 401 close → 显示登录浮层。
  // FIX: 没有保存的密码且没有 session cookie 时，不发起 WS 连接（避免无谓的 401 → 弹错误）。
  // 注意：cookie 是 HttpOnly，前端读不到；这里以 localStorage pw 作为是否曾经登录的近似信号。
  (function () {
    const savedPw = getPw();
    if (savedPw) {
      connectWebSocket(savedPw);
    } else {
      // 没有存储的密码，直接显示登录浮层，不发 WS 请求
      const overlay = document.getElementById('loginOverlay');
      const app = document.getElementById('app');
      if (overlay) overlay.classList.remove('hidden');
      if (app) app.style.display = 'none';
    }
  })();

  document.getElementById('loginPass').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });

  if (window._t2aSlots) {
    window._t2aSlots.on('suggestion:clicked', function (data) { if (data.text) sendMessage(data.text); });
    window._t2aSlots.on('task:cancel-request', function (data) { if (data.taskId) apiCancelTask(data.taskId); });
  }

  // v0.4.0: form block 提交回写
  if (window._t2aFormSubmit) {
    window._t2aFormSubmit.onSubmit = function (text, formEl) { sendMessage(text); };
  }

  // v0.2.0 P2: 当 ws close 4001 表示鉴权失败 → 显示登录浮层
  window.addEventListener('focus', function () {
    // 简单 hook：focus 时若未登录态则确保浮层可见
    if (wsManager && !wsManager.authenticated) {
      const overlay = document.getElementById('loginOverlay');
      if (overlay && overlay.classList.contains('hidden') === false) return;
    }
  });
})();
