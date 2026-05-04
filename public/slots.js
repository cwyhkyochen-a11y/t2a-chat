// T2A Chat — 插槽管理 + 事件总线
// 职责：管理 input-buttons / sidebar-links / welcome-suggestions / config-panels 插槽
// 以及全局事件订阅

(function () {
  'use strict';

  // ---- 事件总线 ----
  const _listeners = {};

  function on(event, handler) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(handler);
  }

  function off(event, handler) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(h => h !== handler);
  }

  function emit(event, data) {
    const handlers = _listeners[event];
    if (!handlers) return;
    for (let i = 0; i < handlers.length; i++) {
      try { handlers[i](data); } catch (e) { console.error('[t2aChat] event handler error:', event, e); }
    }
  }

  // ---- 插槽注册表 ----
  // slotName → [item, item, ...]
  const _slots = {
    'input-buttons': [],
    'sidebar-links': [],
    'welcome-suggestions': [],
    'config-panels': [],
  };

  /**
   * 注册一个插槽项
   * @param {string} slotName - 'input-buttons' | 'sidebar-links' | 'welcome-suggestions' | 'config-panels'
   * @param {object} item - 插槽配置对象
   *   input-buttons: { id, icon?, label?, onClick(ctx) }
   *   sidebar-links: { id, url, label, icon? }
   *   welcome-suggestions: { id, text, onClick?(ctx) }
   *   config-panels: { id, label, fields, onLoad?, onSave? }
   */
  function registerSlot(slotName, item) {
    if (!_slots[slotName]) {
      console.warn('[t2aChat] unknown slot:', slotName);
      return;
    }
    // 去重
    const existing = _slots[slotName].findIndex(s => s.id === item.id);
    if (existing >= 0) {
      _slots[slotName][existing] = item;
    } else {
      _slots[slotName].push(item);
    }
    // 触发渲染
    _renderSlot(slotName);
    emit('slot:registered', { slotName, item });
  }

  /**
   * 注册 config 面板（admin 后台用）
   */
  function registerConfigPanel(id, config) {
    registerSlot('config-panels', { id, ...config });
  }

  /**
   * 获取某个插槽的所有项
   */
  function getSlotItems(slotName) {
    return _slots[slotName] || [];
  }

  // ---- 插槽渲染 ----

  function _renderSlot(slotName) {
    switch (slotName) {
      case 'input-buttons':
        _renderInputButtons();
        break;
      case 'sidebar-links':
        _renderSidebarLinks();
        break;
      case 'welcome-suggestions':
        _renderWelcomeSuggestions();
        break;
      case 'config-panels':
        // config 面板由 admin 页面处理，这里只 emit 事件
        break;
    }
  }

  function _renderInputButtons() {
    const container = document.getElementById('slot-input-buttons');
    if (!container) return;
    const items = _slots['input-buttons'];
    container.innerHTML = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const btn = document.createElement('button');
      btn.className = 'slot-btn';
      btn.title = item.label || '';
      btn.innerHTML = item.icon || item.label || '';
      btn.onclick = function () {
        if (item.onClick) item.onClick({ emit });
      };
      container.appendChild(btn);
    }
  }

  function _renderSidebarLinks() {
    const container = document.getElementById('slot-sidebar-links');
    if (!container) return;
    const items = _slots['sidebar-links'];
    container.innerHTML = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const a = document.createElement('a');
      a.className = 'mode-link';
      a.href = item.url || '#';
      a.innerHTML = (item.icon || '') + ' ' + _esc(item.label || '');
      container.appendChild(a);
    }
  }

  function _renderWelcomeSuggestions() {
    const container = document.getElementById('slot-welcome-suggestions');
    if (!container) return;
    const items = _slots['welcome-suggestions'];
    container.innerHTML = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const div = document.createElement('div');
      div.className = 'suggestion';
      div.textContent = item.text || '';
      div.onclick = function () {
        if (item.onClick) {
          item.onClick({ emit });
        } else {
          // 默认行为：发送文本
          emit('suggestion:clicked', { text: item.text });
        }
      };
      container.appendChild(div);
    }
  }

  // ---- UI 配置加载 ----
  // 从后端拉 sidebarLinks + branding 配置
  async function loadUiConfig(apiBase) {
    try {
      const res = await fetch(apiBase + '/config/ui');
      if (!res.ok) return null;
      const config = await res.json();
      // 注入 sidebar links
      if (config.sidebarLinks && Array.isArray(config.sidebarLinks)) {
        for (let i = 0; i < config.sidebarLinks.length; i++) {
          const link = config.sidebarLinks[i];
          registerSlot('sidebar-links', {
            id: link.id || 'link-' + i,
            url: link.url,
            label: link.label,
            icon: link.icon || '',
          });
        }
      }
      // 注入 welcome suggestions
      if (config.welcomeSuggestions && Array.isArray(config.welcomeSuggestions)) {
        for (let i = 0; i < config.welcomeSuggestions.length; i++) {
          const s = config.welcomeSuggestions[i];
          registerSlot('welcome-suggestions', {
            id: s.id || 'sug-' + i,
            text: s.text,
          });
        }
      }
      return config;
    } catch (e) {
      console.warn('[t2aChat] loadUiConfig failed:', e);
      return null;
    }
  }

  // ---- 工具函数 ----
  function _esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ---- 暴露 ----
  window._t2aSlots = {
    on,
    off,
    emit,
    registerSlot,
    registerConfigPanel,
    getSlotItems,
    loadUiConfig,
  };
})();
