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
        _renderConfigPanels();
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
    const currentPath = (location.pathname || '').replace(/\/+$/, '') || '/';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const a = document.createElement('a');
      const url = item.url || '#';
      a.href = url;
      if (item.target) a.target = item.target;
      if (item.target === '_blank') a.rel = 'noopener noreferrer';
      // 判断是否是当前页：同路径或 './'/'.' 与当前叠合
      let isActive = false;
      try {
        const resolved = new URL(url, location.href);
        const linkPath = (resolved.pathname || '').replace(/\/+$/, '') || '/';
        if (linkPath === currentPath) isActive = true;
      } catch {}
      if (isActive) a.classList.add('active');
      const iconHtml = item.icon || '';
      const labelHtml = _esc(item.label || '');
      a.innerHTML = iconHtml + (iconHtml ? ' ' : '') + '<span>' + labelHtml + '</span>';
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

  // ---- Config panels rendering ----
  function _renderConfigPanels() {
    var container = document.getElementById('slot-config-panels');
    if (!container) return;
    var panels = _slots['config-panels'];
    container.innerHTML = '';
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      var div = document.createElement('div');
      div.className = 'config-panel';
      div.dataset.panelId = p.id;
      var h4 = document.createElement('h4');
      h4.textContent = p.label || p.id;
      div.appendChild(h4);
      var fieldsDiv = document.createElement('div');
      fieldsDiv.className = 'config-fields';
      var fields = p.fields || [];
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j];
        var wrap = document.createElement('div');
        var lbl = document.createElement('label');
        lbl.textContent = f.label || f.id;
        lbl.setAttribute('for', 'panel-' + p.id + '-' + f.id);
        wrap.appendChild(lbl);
        var elId = 'panel-' + p.id + '-' + f.id;
        if (f.type === 'select') {
          var sel = document.createElement('select');
          sel.id = elId;
          sel.dataset.fieldId = f.id;
          // options filled async in loadConfigPanels
          wrap.appendChild(sel);
        } else {
          var inp = document.createElement('input');
          inp.type = f.type === 'password' ? 'password' : 'text';
          inp.id = elId;
          inp.dataset.fieldId = f.id;
          if (f.placeholder) inp.placeholder = f.placeholder;
          wrap.appendChild(inp);
        }
        fieldsDiv.appendChild(wrap);
      }
      div.appendChild(fieldsDiv);
      container.appendChild(div);
    }
  }

  async function loadConfigPanels() {
    _renderConfigPanels();
    var panels = _slots['config-panels'];
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      // resolve async options for select fields
      var fields = p.fields || [];
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j];
        if (f.type === 'select') {
          var sel = document.getElementById('panel-' + p.id + '-' + f.id);
          if (!sel) continue;
          var opts = f.options;
          if (typeof opts === 'function') { try { opts = await opts(); } catch (e) { opts = []; } }
          if (!Array.isArray(opts)) opts = [];
          sel.innerHTML = '<option value="">(default)</option>';
          for (var k = 0; k < opts.length; k++) {
            var o = opts[k];
            var opt = document.createElement('option');
            opt.value = typeof o === 'object' ? o.value : o;
            opt.textContent = typeof o === 'object' ? (o.label || o.value) : o;
            sel.appendChild(opt);
          }
        }
      }
      // load current values
      if (typeof p.onLoad === 'function') {
        try {
          var vals = await p.onLoad();
          if (vals && typeof vals === 'object') {
            for (var key in vals) {
              var el = document.getElementById('panel-' + p.id + '-' + key);
              if (el) el.value = vals[key] || '';
            }
          }
        } catch (e) { console.warn('[t2aChat] config panel onLoad error:', p.id, e); }
      }
    }
  }

  async function saveConfigPanels() {
    var panels = _slots['config-panels'];
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (typeof p.onSave !== 'function') continue;
      var vals = {};
      var fields = p.fields || [];
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j];
        var el = document.getElementById('panel-' + p.id + '-' + f.id);
        if (el) vals[f.id] = el.value;
      }
      try { await p.onSave(vals); } catch (e) { console.warn('[t2aChat] config panel onSave error:', p.id, e); }
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
    loadConfigPanels,
    saveConfigPanels,
  };
})();
