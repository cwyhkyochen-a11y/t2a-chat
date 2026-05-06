/**
 * T2A Widget SDK
 * 嵌入式聊天 widget，通过 iframe 加载 t2a-chat 页面
 */
(function () {
  'use strict';

  var config = null;
  var isOpen = false;
  var container = null;
  var bubble = null;
  var badge = null;
  var panel = null;
  var iframe = null;
  var unreadCount = 0;
  var listeners = {};

  // 默认配置
  var defaults = {
    endpoint: '',
    token: '',
    basePath: '/chat',
    position: 'bottom-right',
    theme: {
      primaryColor: '#0066ff',
      bubbleSize: 56,
    },
    title: 'AI Assistant',
    fullscreenUrl: null,
  };

  // SVG 图标
  var ICON_CHAT = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_FULLSCREEN = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  // 构建 chat URL
  function buildChatUrl() {
    var url = config.endpoint;
    if (config.token) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(config.token);
    }
    url += (url.indexOf('?') === -1 ? '?' : '&') + 'mode=widget';
    url += '&basePath=' + encodeURIComponent(config.basePath);
    return url;
  }

  // 获取全屏 URL
  function getFullscreenUrl() {
    return config.fullscreenUrl || buildChatUrl().replace('mode=widget', 'mode=fullscreen');
  }

  // 创建 DOM 结构
  function createDOM() {
    var size = config.theme.bubbleSize || 56;

    // 容器
    container = document.createElement('div');
    container.className = 't2a-container t2a-position-' + config.position;

    // 气泡按钮
    bubble = document.createElement('button');
    bubble.className = 't2a-bubble';
    bubble.style.width = size + 'px';
    bubble.style.height = size + 'px';
    bubble.innerHTML = ICON_CHAT;
    bubble.setAttribute('aria-label', 'Open chat');
    bubble.addEventListener('click', toggle);

    // Unread badge
    badge = document.createElement('span');
    badge.className = 't2a-badge t2a-badge-hidden';
    bubble.appendChild(badge);

    // 面板
    panel = document.createElement('div');
    panel.className = 't2a-panel';

    // Header
    var header = document.createElement('div');
    header.className = 't2a-panel-header';

    var title = document.createElement('span');
    title.className = 't2a-panel-title';
    title.textContent = config.title;

    var actions = document.createElement('div');
    actions.className = 't2a-panel-actions';

    var fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 't2a-btn-icon';
    fullscreenBtn.innerHTML = ICON_FULLSCREEN;
    fullscreenBtn.setAttribute('aria-label', 'Open fullscreen');
    fullscreenBtn.addEventListener('click', function () {
      window.open(getFullscreenUrl(), '_blank');
    });

    var closeBtn = document.createElement('button');
    closeBtn.className = 't2a-btn-icon';
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.setAttribute('aria-label', 'Close chat');
    closeBtn.addEventListener('click', close);

    actions.appendChild(fullscreenBtn);
    actions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(actions);

    // iframe 容器
    var iframeWrap = document.createElement('div');
    iframeWrap.className = 't2a-iframe-wrap';

    // Loading 状态
    var loading = document.createElement('div');
    loading.className = 't2a-loading';
    loading.innerHTML = '<div class="t2a-spinner"></div>';

    // iframe
    iframe = document.createElement('iframe');
    iframe.className = 't2a-iframe';
    iframe.setAttribute('allow', 'microphone');
    iframe.addEventListener('load', function () {
      loading.style.display = 'none';
    });

    iframeWrap.appendChild(loading);
    iframeWrap.appendChild(iframe);

    // 组装面板
    panel.appendChild(header);
    panel.appendChild(iframeWrap);

    // 组装容器
    container.appendChild(panel);
    container.appendChild(bubble);
    document.body.appendChild(container);
  }

  // 加载 CSS（如果未手动引入）
  function ensureCSS() {
    if (document.querySelector('link[href*="t2a-widget.css"]')) return;
    var scripts = document.querySelectorAll('script[src*="t2a-widget"]');
    if (scripts.length === 0) return;
    var scriptSrc = scripts[scripts.length - 1].src;
    var cssUrl = scriptSrc.replace(/\.js(\?.*)?$/, '.css');
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    document.head.appendChild(link);
  }

  // postMessage 监听
  function setupPostMessage() {
    window.addEventListener('message', function (ev) {
      if (!ev.data || typeof ev.data.type !== 'string') return;
      if (ev.data.type.indexOf('t2a:') !== 0) return;

      var eventName = ev.data.type.replace('t2a:', '');

      // Unread badge 处理
      if (eventName === 'unread') {
        if (!isOpen) {
          unreadCount = ev.data.count || 0;
          updateBadge();
        }
      }

      // 触发注册的回调
      emit(eventName, ev.data.data || ev.data);
    });
  }

  // 事件系统
  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function off(event, callback) {
    if (!listeners[event]) return;
    if (!callback) { listeners[event] = []; return; }
    listeners[event] = listeners[event].filter(function (fn) { return fn !== callback; });
  }

  function emit(event, data) {
    if (!listeners[event]) return;
    listeners[event].forEach(function (fn) {
      try { fn(data); } catch (e) { console.error('[T2AWidget] listener error:', e); }
    });
  }

  // 向 iframe 发送消息
  function send(message) {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(message, '*');
    }
  }

  // Badge
  function updateBadge() {
    if (unreadCount <= 0) {
      badge.classList.add('t2a-badge-hidden');
      badge.textContent = '';
    } else {
      badge.classList.remove('t2a-badge-hidden');
      badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    }
  }

  // 打开面板
  function open() {
    if (isOpen) return;
    isOpen = true;
    // 懒加载 iframe src
    if (!iframe.src) {
      iframe.src = buildChatUrl();
    }
    panel.classList.add('t2a-panel-open');
    bubble.classList.add('t2a-bubble-hidden');
    // 清零未读
    unreadCount = 0;
    updateBadge();
    // 通知 iframe 面板已打开
    send({ type: 't2a:panel_opened' });
  }

  // 关闭面板
  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('t2a-panel-open');
    bubble.classList.remove('t2a-bubble-hidden');
  }

  // 切换
  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  // 销毁
  function destroy() {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    bubble = null;
    badge = null;
    panel = null;
    iframe = null;
    config = null;
    isOpen = false;
    unreadCount = 0;
    listeners = {};
  }

  // 初始化
  function init(options) {
    if (container) destroy();

    config = {};
    for (var key in defaults) {
      if (defaults.hasOwnProperty(key)) {
        config[key] = options[key] !== undefined ? options[key] : defaults[key];
      }
    }
    // 合并 theme
    config.theme = {};
    for (var tk in defaults.theme) {
      if (defaults.theme.hasOwnProperty(tk)) {
        config.theme[tk] = (options.theme && options.theme[tk] !== undefined)
          ? options.theme[tk]
          : defaults.theme[tk];
      }
    }

    ensureCSS();
    createDOM();
    setupPostMessage();

    // 应用主题色到气泡
    if (config.theme.primaryColor && config.theme.primaryColor !== '#0066ff') {
      bubble.style.backgroundColor = config.theme.primaryColor;
    }
  }

  // 暴露 API
  window.T2AWidget = {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    destroy: destroy,
    on: on,
    off: off,
    send: send,
  };
})();
