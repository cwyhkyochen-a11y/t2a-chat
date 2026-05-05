// T2A Chat — Tools Panel (with Model Preferences)
// 独立可挂载模块，展示业务系统注册的 tools（分组 + 标签）+ task type model 偏好
// API: window._t2aToolsPanel = { mount(el), refresh(), setApiBase(base) }

(function () {
  'use strict';

  var _apiBase = '/api/chat';
  var _mounted = false;
  var _container = null;
  var _tools = [];
  var _loaded = false;

  // ---- 样式注入 ----
  var style = document.createElement('style');
  style.textContent = [
    '.tools-panel-inner { padding: 12px; overflow-y: auto; }',
    '.tools-section { margin-bottom: 20px; }',
    '.tools-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-tertiary, #999); margin-bottom: 10px; padding: 0 4px; display: flex; align-items: center; gap: 6px; }',
    '.tools-group { margin-bottom: 14px; }',
    '.tools-group-title { font-size: 11px; font-weight: 600; color: var(--color-text-secondary, #777); margin-bottom: 6px; padding: 0 4px; }',
    '.tool-card { padding: 10px 12px; border: 1px solid var(--color-border, #e5e5e5); border-radius: 8px; margin-bottom: 8px; background: var(--color-bg-secondary, #fafafa); transition: border-color 0.15s; }',
    '.tool-card:hover { border-color: var(--color-border-hover, #ccc); }',
    '.tool-card-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary, #1a1a1a); margin-bottom: 3px; font-family: var(--font-mono, monospace); }',
    '.tool-card-desc { font-size: 12px; color: var(--color-text-secondary, #666); line-height: 1.4; margin-bottom: 6px; }',
    '.tool-card-tags { display: flex; flex-wrap: wrap; gap: 4px; }',
    '.tool-tag { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: var(--color-tag-bg, #f0f0f0); color: var(--color-tag-text, #555); border: 1px solid var(--color-tag-border, #e0e0e0); }',
    '.tools-empty { padding: 40px 20px; text-align: center; color: var(--color-text-tertiary, #999); font-size: 13px; }',
    '.tools-loading { padding: 40px 20px; text-align: center; color: var(--color-text-tertiary, #999); font-size: 13px; }',
  ].join('\n');
  document.head.appendChild(style);

  // ---- 工具函数 ----
  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // ---- 渲染 ----
  function render() {
    if (!_container) return;
    if (!_loaded) {
      _container.innerHTML = '<div class="tools-loading">Loading\u2026</div>';
      return;
    }

    var html = '<div class="tools-panel-inner">';

    // Section 1: Tools
    html += '<div class="tools-section">';
    html += '<div class="tools-section-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Available Tools</div>';

    if (_tools.length === 0) {
      html += '<div class="tools-empty">No tools registered</div>';
    } else {
      // 按 group 分组
      var groups = {};
      for (var i = 0; i < _tools.length; i++) {
        var t = _tools[i];
        var g = t.group || 'Other';
        if (!groups[g]) groups[g] = [];
        groups[g].push(t);
      }
      var groupNames = Object.keys(groups);
      for (var gi = 0; gi < groupNames.length; gi++) {
        var gName = groupNames[gi];
        var items = groups[gName];
        html += '<div class="tools-group">';
        if (groupNames.length > 1) {
          html += '<div class="tools-group-title">' + esc(gName) + '</div>';
        }
        for (var ti = 0; ti < items.length; ti++) {
          var tool = items[ti];
          html += '<div class="tool-card">';
          html += '<div class="tool-card-name">' + esc(tool.name) + '</div>';
          if (tool.description) {
            html += '<div class="tool-card-desc">' + esc(tool.description) + '</div>';
          }
          if (tool.tags && tool.tags.length) {
            html += '<div class="tool-card-tags">';
            for (var k = 0; k < tool.tags.length; k++) {
              html += '<span class="tool-tag">' + esc(tool.tags[k]) + '</span>';
            }
            html += '</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';

    html += '</div>';
    _container.innerHTML = html;
  }

  // ---- API ----
  async function fetchData() {
    var results = await Promise.all([
      fetch(_apiBase + '/tools', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : { tools: [] }; }).catch(function () { return { tools: [] }; }),
    ]);

    _tools = Array.isArray(results[0].tools) ? results[0].tools : [];
    _loaded = true;
    render();
  }

  function mount(el) {
    if (!el) return;
    _container = el;
    _mounted = true;
    if (!_loaded) fetchData();
    else render();
  }

  function refresh() {
    _loaded = false;
    fetchData();
  }

  function setApiBase(base) {
    _apiBase = base || '/api/chat';
  }

  // ---- 暴露 ----
  window._t2aToolsPanel = {
    mount: mount,
    refresh: refresh,
    setApiBase: setApiBase,
  };
})();
