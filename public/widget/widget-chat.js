// widget-chat.js — compact widget chat logic
(function() {
  const params = new URLSearchParams(window.location.search);
  const TOKEN = params.get('token') || '';
  const BASE_PATH = params.get('basePath') || '/chat';
  const BASE = window.location.origin;
  const API_BASE = BASE + BASE_PATH;
  const headers = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN });

  let ws = null;
  let currentConvId = null;
  let conversations = [];
  let streamingEl = null;
  let attachments = []; // [{id, filename, url}]
  let unreadCount = 0;

  // DOM refs
  const convTitle = document.getElementById('convTitle');
  const convDropdown = document.getElementById('convDropdown');
  const convDropdownBtn = document.getElementById('convDropdownBtn');
  const convList = document.getElementById('convList');
  const messagesArea = document.getElementById('messagesArea');
  const msgInput = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');
  const panelOverlay = document.getElementById('panelOverlay');
  const taskPanel = document.getElementById('taskPanel');
  const settingsPanel = document.getElementById('settingsPanel');
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');
  const attachmentsPreview = document.getElementById('attachmentsPreview');

  // --- postMessage helpers ---
  function notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 't2a:' + type, data: data }, '*');
    }
  }

  function notifyUnread() {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 't2a:unread', count: unreadCount }, '*');
    }
  }

  // Listen for messages from parent
  window.addEventListener('message', function(ev) {
    if (!ev.data || typeof ev.data.type !== 'string') return;
    if (ev.data.type === 't2a:panel_opened') {
      unreadCount = 0;
      notifyUnread();
    }
  });

  // --- Init ---
  async function init() {
    if (!TOKEN) { messagesArea.innerHTML = '<div class="empty-state">Missing token parameter</div>'; return; }
    await loadConversations();
    if (conversations.length > 0) { await switchConv(conversations[0].id); }
    else { await createConv(); }
    connectWS();
    notifyParent('ready');
  }

  // --- Conversations ---
  async function loadConversations() {
    try {
      const res = await fetch(API_BASE + '/api/conversations', { headers: headers() });
      conversations = await res.json();
    } catch(e) { conversations = []; }
  }

  function renderConvList() {
    convList.innerHTML = conversations.length === 0
      ? '<div class="empty-state">No conversations</div>'
      : conversations.map(c => `<div class="conv-item ${c.id === currentConvId ? 'active' : ''}" data-id="${c.id}">${esc(c.title || 'Chat ' + c.id)}</div>`).join('');
    convList.querySelectorAll('.conv-item').forEach(el => {
      el.onclick = () => { switchConv(Number(el.dataset.id)); toggleDropdown(false); };
    });
  }

  async function switchConv(id) {
    currentConvId = id;
    const conv = conversations.find(c => c.id === id);
    convTitle.textContent = conv ? (conv.title || 'Chat ' + id) : 'Chat';
    messagesArea.innerHTML = '';
    streamingEl = null;
    try {
      const res = await fetch(API_BASE + '/api/conversations/' + id, { headers: headers() });
      const data = await res.json();
      if (data.messages) data.messages.forEach(m => renderMessage(m));
      scrollBottom();
    } catch(e) {}
  }

  async function createConv() {
    try {
      const res = await fetch(API_BASE + '/api/conversations', { method: 'POST', headers: headers(), body: JSON.stringify({ title: 'New Chat' }) });
      const data = await res.json();
      await loadConversations();
      await switchConv(data.id);
    } catch(e) {}
  }

  // --- Dropdown ---
  function toggleDropdown(show) {
    const visible = show !== undefined ? show : convDropdown.classList.contains('hidden');
    convDropdown.classList.toggle('hidden', !visible);
    if (visible) renderConvList();
  }
  convDropdownBtn.onclick = () => toggleDropdown();
  document.getElementById('newConvBtn').onclick = () => { toggleDropdown(false); createConv(); };

  // --- WebSocket ---
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + BASE_PATH + '/ws?token=' + TOKEN);
    ws.onmessage = (ev) => {
      try { handleWsMsg(JSON.parse(ev.data)); } catch(e) {}
    };
    ws.onclose = () => { setTimeout(connectWS, 3000); };
  }

  function handleWsMsg(msg) {
    if (msg.conversation_id && msg.conversation_id !== currentConvId) return;
    switch(msg.type) {
      case 'chunk': appendChunk(msg.content || ''); break;
      case 'message_done': finalizeStream(msg); break;
      case 'tool_call': renderToolCall(msg); break;
      case 'tool_result': renderToolResult(msg); break;
      case 'system_event': renderSystemEvent(msg); break;
      case 'form_block': renderFormBlock(msg); break;
      case 'error': renderSystemMsg('Error: ' + (msg.error || msg.message || 'Unknown')); break;
    }
    // Notify parent of new assistant messages
    if (msg.type === 'message_done' || msg.type === 'chunk') {
      unreadCount++;
      notifyUnread();
      if (msg.type === 'message_done') {
        notifyParent('message', { role: 'assistant', content: msg.content || '' });
      }
    }
  }

  // --- Send ---
  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text && attachments.length === 0) return;
    if (!currentConvId) return;
    msgInput.value = '';
    autoResize();
    renderMessage({ role: 'user', content: text });
    notifyParent('message', { role: 'user', content: text });
    scrollBottom();
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload = { type: 'chat', conversation_id: currentConvId, content: text };
      if (attachments.length > 0) {
        payload.attachments = attachments.map(a => ({ id: a.id, filename: a.filename, url: a.url }));
      }
      ws.send(JSON.stringify(payload));
    }
    clearAttachments();
  }
  sendBtn.onclick = sendMessage;
  msgInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  msgInput.oninput = autoResize;
  function autoResize() { msgInput.style.height = 'auto'; msgInput.style.height = Math.min(msgInput.scrollHeight, 100) + 'px'; }

  // --- Attachments ---
  attachBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await uploadFile(files[i]);
    }
    fileInput.value = '';
  };

  async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(API_BASE + '/api/uploads', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + TOKEN },
        body: formData,
      });
      const data = await res.json();
      attachments.push({ id: data.id, filename: data.filename || file.name, url: data.url });
      renderAttachments();
    } catch(e) {
      console.error('Upload failed:', e);
    }
  }

  function renderAttachments() {
    if (attachments.length === 0) {
      attachmentsPreview.classList.add('hidden');
      attachmentsPreview.innerHTML = '';
      return;
    }
    attachmentsPreview.classList.remove('hidden');
    attachmentsPreview.innerHTML = attachments.map((a, i) =>
      `<div class="attach-chip"><span class="attach-name">${esc(a.filename)}</span><button class="attach-remove" data-idx="${i}">&times;</button></div>`
    ).join('');
    attachmentsPreview.querySelectorAll('.attach-remove').forEach(btn => {
      btn.onclick = () => { attachments.splice(Number(btn.dataset.idx), 1); renderAttachments(); };
    });
  }

  function clearAttachments() {
    attachments = [];
    renderAttachments();
  }

  // --- Form Block ---
  function renderFormBlock(msg) {
    const formId = msg.form_id || ('form-' + Date.now());
    const fields = msg.fields || [];
    const el = document.createElement('div');
    el.className = 'msg msg-form';
    el.id = 'form-' + formId;
    let html = '<div class="form-block-title">' + esc(msg.title || 'Form') + '</div>';
    html += '<div class="form-fields">';
    fields.forEach(f => {
      html += '<div class="form-field">';
      html += '<label class="form-label">' + esc(f.label || f.name) + '</label>';
      switch(f.type) {
        case 'select':
          html += '<select class="form-input" data-name="' + esc(f.name) + '">';
          (f.options || []).forEach(o => { html += '<option value="' + esc(o.value || o) + '">' + esc(o.label || o) + '</option>'; });
          html += '</select>';
          break;
        case 'checkbox':
          html += '<input type="checkbox" class="form-checkbox" data-name="' + esc(f.name) + '">';
          break;
        case 'textarea':
          html += '<textarea class="form-input form-textarea" data-name="' + esc(f.name) + '" rows="3"></textarea>';
          break;
        case 'number':
          html += '<input type="number" class="form-input" data-name="' + esc(f.name) + '">';
          break;
        default:
          html += '<input type="text" class="form-input" data-name="' + esc(f.name) + '">';
      }
      html += '</div>';
    });
    html += '</div>';
    html += '<button class="form-submit-btn" data-form-id="' + esc(formId) + '">Submit</button>';
    el.innerHTML = html;
    messagesArea.appendChild(el);
    scrollBottom();
    // Bind submit
    el.querySelector('.form-submit-btn').onclick = function() { submitForm(el, formId, fields); };
  }

  function submitForm(el, formId, fields) {
    const data = {};
    fields.forEach(f => {
      const input = el.querySelector('[data-name="' + f.name + '"]');
      if (!input) return;
      if (f.type === 'checkbox') { data[f.name] = input.checked; }
      else { data[f.name] = input.value; }
    });
    // Send via WS
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'form_submit', conversation_id: currentConvId, form_id: formId, data: data }));
    }
    // Disable form
    el.querySelectorAll('input, select, textarea, button').forEach(inp => { inp.disabled = true; });
    el.classList.add('form-submitted');
    notifyParent('form_submitted', { form_id: formId, values: data });
  }

  // --- Render ---
  function renderMessage(m) {
    if (m.role === 'user') { appendMsg('msg msg-user', m.content); }
    else if (m.role === 'assistant') { appendMsg('msg msg-assistant', m.content || ''); }
    else if (m.role === 'system' || m.event_source) { renderSystemMsg(m.content || m.event_source || 'system'); }
    else if (m.content_type === 'tool_call' || m.tool_calls) { renderToolCallMsg(m); }
  }

  function appendMsg(cls, text) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    messagesArea.appendChild(el);
  }

  function appendChunk(text) {
    if (!streamingEl) {
      streamingEl = document.createElement('div');
      streamingEl.className = 'msg msg-assistant msg-streaming';
      messagesArea.appendChild(streamingEl);
    }
    streamingEl.textContent += text;
    scrollBottom();
  }

  function finalizeStream(msg) {
    if (streamingEl) { streamingEl.classList.remove('msg-streaming'); streamingEl = null; }
    else if (msg.content) { appendMsg('msg msg-assistant', msg.content); }
    scrollBottom();
  }

  function renderToolCall(msg) {
    const el = document.createElement('div');
    el.className = 'msg msg-tool';
    el.innerHTML = '<div class="tool-name">' + esc(msg.name || 'tool') + '</div><div class="tool-result">Running...</div>';
    el.id = 'tc-' + (msg.call_id || '');
    messagesArea.appendChild(el);
    scrollBottom();
  }

  function renderToolResult(msg) {
    const el = document.getElementById('tc-' + (msg.call_id || ''));
    if (el) { el.querySelector('.tool-result').textContent = truncate(msg.result || msg.content || 'Done', 120); }
  }

  function renderToolCallMsg(m) {
    const el = document.createElement('div');
    el.className = 'msg msg-tool';
    let calls = [];
    try { calls = typeof m.tool_calls === 'string' ? JSON.parse(m.tool_calls) : (m.tool_calls || []); } catch(e) {}
    el.innerHTML = calls.map(c => '<div class="tool-name">' + esc(c.function?.name || 'tool') + '</div>').join('') || '<div class="tool-name">tool_call</div>';
    messagesArea.appendChild(el);
  }

  function renderSystemEvent(msg) { renderSystemMsg(msg.payload?.message || msg.source || 'event'); }
  function renderSystemMsg(text) { appendMsg('msg msg-system', text); scrollBottom(); }
  function scrollBottom() { messagesArea.scrollTop = messagesArea.scrollHeight; }

  // --- Panels ---
  function openPanel(panel) { panelOverlay.classList.remove('hidden'); panel.classList.remove('hidden'); setTimeout(() => panel.classList.add('visible'), 10); }
  function closePanel(panel) { panel.classList.remove('visible'); setTimeout(() => { panel.classList.add('hidden'); panelOverlay.classList.add('hidden'); }, 200); }
  panelOverlay.onclick = () => { closePanel(taskPanel); closePanel(settingsPanel); };
  document.getElementById('taskListBtn').onclick = () => { loadTasks(); openPanel(taskPanel); };
  document.getElementById('taskPanelClose').onclick = () => closePanel(taskPanel);
  document.getElementById('settingsBtn').onclick = () => { loadSettings(); openPanel(settingsPanel); };
  document.getElementById('settingsPanelClose').onclick = () => closePanel(settingsPanel);

  // --- Tasks ---
  async function loadTasks() {
    const body = document.getElementById('taskPanelBody');
    try {
      const res = await fetch(API_BASE + '/api/tasks', { headers: headers() });
      const tasks = await res.json();
      if (!tasks.length) { body.innerHTML = '<div class="empty-state">No tasks</div>'; return; }
      body.innerHTML = tasks.map(t => `<div class="task-item"><div class="task-title">${esc(t.title || t.type || 'Task')}</div><div class="task-status task-status-${t.status || 'pending'}">${t.status || 'pending'}</div></div>`).join('');
    } catch(e) { body.innerHTML = '<div class="empty-state">Failed to load tasks</div>'; }
  }

  // --- Settings ---
  async function loadSettings() {
    const body = document.getElementById('settingsPanelBody');
    try {
      const res = await fetch(API_BASE + '/api/settings', { headers: headers() });
      const settings = await res.json();
      const model = settings.default_model || '';
      body.innerHTML = `<div class="setting-group"><div class="setting-label">Default Model</div><input class="setting-input" id="settingModel" value="${esc(model)}"></div><button class="setting-save-btn" id="saveSettingsBtn">Save</button>`;
      document.getElementById('saveSettingsBtn').onclick = saveSettings;
    } catch(e) { body.innerHTML = '<div class="empty-state">Failed to load settings</div>'; }
  }

  async function saveSettings() {
    const model = document.getElementById('settingModel')?.value || '';
    try {
      await fetch(API_BASE + '/api/settings', { method: 'PUT', headers: headers(), body: JSON.stringify({ default_model: model }) });
    } catch(e) {}
  }

  // --- Helpers ---
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function truncate(s, n) { return s.length > n ? s.slice(0, n) + '...' : s; }

  // --- Start ---
  init();
})();
