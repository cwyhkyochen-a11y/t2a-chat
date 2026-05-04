// T2A Chat — DOM 渲染辅助
// 职责：消息气泡、工具卡片、历史渲染、markdown、scroll、icon、esc

(function () {
  'use strict';

  // SVG 图标
  const IC_USER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const IC_BOT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>';
  const IC_GEAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';

  // ---- 转义 ----
  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ---- 极简 Markdown ----
  function renderMd(text) {
    if (!text) return '';
    var html = esc(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^(\d+)[\.、．]\s*(.+)$/gm, '<oli>$2</oli>');
    html = html.replace(/^[-*•]\s+(.+)$/gm, '<uli>$1</uli>');
    html = html.replace(/(?:<oli>[\s\S]*?<\/oli>(?:\n)?)+/g, function (m) {
      return '<ol>' + m.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>').replace(/\n/g, '') + '</ol>';
    });
    html = html.replace(/(?:<uli>[\s\S]*?<\/uli>(?:\n)?)+/g, function (m) {
      return '<ul>' + m.replace(/<uli>/g, '<li>').replace(/<\/uli>/g, '</li>').replace(/\n/g, '') + '</ul>';
    });
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    return '<p>' + html + '</p>';
  }

  // ---- 容器管理 ----
  var _renderBatchTarget = null;

  function ensureContainer() {
    if (_renderBatchTarget) return _renderBatchTarget;
    var container = document.getElementById('messages');
    var welcome = container.querySelector('.welcome');
    if (welcome) welcome.remove();
    return container;
  }

  function scrollToBottom() {
    var el = document.getElementById('messages');
    requestAnimationFrame(function () { el.scrollTop = el.scrollHeight; });
  }

  // ---- 气泡 ----
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
    div.innerHTML =
      '<div class="axis-body">' +
        '<div class="axis-head">' +
          '<span class="axis-label">🔧 ' + esc(label) + '</span>' +
          '<span class="axis-summary">' + esc(summary) + '</span>' +
          '<span class="axis-badge ' + statusCls + '">' + esc(badgeText) + '</span>' +
        '</div>' +
        '<div class="axis-detail"><pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:11px;margin:0">' + esc(JSON.stringify(opts.args || {}, null, 2)) + '</pre></div>' +
      '</div>';

    var head = div.querySelector('.axis-head');
    head.onclick = function () { div.classList.toggle('expanded'); };
    container.appendChild(div);
    return div;
  }

  // ---- 俚语（interlude）气泡 ----
  function appendInterludeMsg(text) {
    var container = ensureContainer();
    var div = document.createElement('div');
    div.className = 'message assistant interlude';
    div.innerHTML = '<div class="avatar">' + IC_BOT + '</div><div><div class="bubble">' + esc(text || '') + '</div></div>';
    container.appendChild(div);
    return div;
  }

  // ---- 系统事件渲染（升级为一等公民） ----
  function appendSystemEventMsg(source, summary) {
    var container = ensureContainer();
    var div = document.createElement('div');
    div.className = 'message system-msg';
    div.innerHTML =
      '<div class="avatar">' + IC_GEAR + '</div>' +
      '<div class="system-body">' +
        '<div class="bubble system-bubble">' +
          '<span class="system-source">' + esc(source) + '</span>' +
          '<span class="system-text">' + esc(summary) + '</span>' +
        '</div>' +
      '</div>';
    container.appendChild(div);
    return div;
  }

  function appendNoticeMsg(text) {
    var container = ensureContainer();
    var div = document.createElement('div');
    div.className = 'notice-axis';
    div.innerHTML = '<span class="notice-tag">' + esc(text || '') + '</span>';
    container.appendChild(div);
    return div;
  }

  // ---- 思考指示器 ----
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

  // ---- 消息区加载占位 ----
  function showMessagesLoading() {
    const container = document.getElementById('messages');
    if (!container) return;
    container.innerHTML = '<div class="messages-loading"><div class="messages-loading-spinner"></div><span>Loading…</span></div>';
  }

  function hideMessagesLoading() {
    const container = document.getElementById('messages');
    if (!container) return;
    const node = container.querySelector('.messages-loading');
    if (node) node.remove();
  }

  // ---- 历史渲染 ----
  function renderHistory(messages) {
    var realContainer = document.getElementById('messages');
    var welcome = realContainer.querySelector('.welcome');
    if (welcome) welcome.remove();
    var fragment = document.createDocumentFragment();
    _renderBatchTarget = fragment;
    try {
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
        } else if (m.role === 'interlude') {
          appendInterludeMsg(m.content || '');
        } else if (m.role === 'notice') {
          appendNoticeMsg(m.content || '');
        } else if (m.role === 'system_event') {
          var payload = null;
          try { payload = JSON.parse(m.event_payload || 'null'); } catch (e) {}
          var source = m.event_source || 'system';
          var summary = payload && (payload.message || payload.text) || '';
          appendSystemEventMsg(source, summary);
        }
      }
    } finally {
      _renderBatchTarget = null;
    }
    realContainer.appendChild(fragment);
  }

  // ---- 欢迎页 ----
  function showWelcome() {
    const msgs = document.getElementById('messages');
    msgs.innerHTML =
      '<div class="welcome">' +
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 16px;color:#b4b4b0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        '<h2>T2A Chat</h2>' +
        '<p>Start a conversation with your AI assistant</p>' +
        '<div id="slot-welcome-suggestions" class="welcome-suggestions"></div>' +
      '</div>';
    // 重新触发 welcome-suggestions 渲染
    if (window._t2aSlots) {
      const items = window._t2aSlots.getSlotItems('welcome-suggestions');
      if (items.length > 0) {
        window._t2aSlots.registerSlot('welcome-suggestions', items[items.length - 1]);
      }
    }
  }

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

  // ---- 暴露 ----
  window._t2aDom = {
    IC_USER, IC_BOT, IC_GEAR,
    esc, renderMd,
    ensureContainer, scrollToBottom,
    appendUserBubble, appendAssistantBubble, appendInterludeMsg, appendToolMsg,
    appendSystemEventMsg, appendNoticeMsg,
    showThinking, hideThinking,
    showMessagesLoading, hideMessagesLoading,
    renderHistory, showWelcome,
    toast,
  };
})();
