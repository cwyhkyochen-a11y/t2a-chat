// T2A Chat — Slash command palette
// 在输入框输入 `/` 时，弹出 command 候选面板，支持上下箭头/Tab/Enter/Esc。
// 宿主可通过 t2aChat.registerCommand 注册命令：
//   { name: '/compact', description: '压缩对话历史', handler: (args, ctx) => void|Promise }

(function () {
  'use strict';

  const _commands = [];
  let _activeIdx = 0;
  let _filtered = [];
  let _input = null;

  function registerCommand(cmd) {
    if (!cmd || typeof cmd.name !== 'string' || cmd.name[0] !== '/') {
      console.warn('[commands] invalid command, name must start with "/"', cmd);
      return;
    }
    if (typeof cmd.handler !== 'function') {
      console.warn('[commands] invalid command, handler must be function', cmd);
      return;
    }
    // 同名替换
    const idx = _commands.findIndex(c => c.name === cmd.name);
    if (idx >= 0) _commands[idx] = cmd;
    else _commands.push(cmd);
  }

  function _filter(query) {
    return _commands.filter(c => c.name.startsWith(query));
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, m => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  function _showPalette() {
    const palette = document.getElementById('commandPalette');
    if (!palette) return;
    if (_filtered.length === 0) { _hidePalette(); return; }
    palette.innerHTML = _filtered.map(function (c, i) {
      return '<div class="cmd-item ' + (i === _activeIdx ? 'active' : '') + '" data-idx="' + i + '">' +
        '<span class="cmd-name">' + _esc(c.name) + '</span>' +
        '<span class="cmd-desc">' + _esc(c.description || '') + '</span>' +
        '</div>';
    }).join('');
    palette.classList.remove('hidden');
    palette.querySelectorAll('.cmd-item').forEach(function (el, i) {
      el.onmousedown = function (e) {
        // mousedown 而不是 click：避免 input blur 先触发把 palette 隐藏掉
        e.preventDefault();
        _activeIdx = i;
        _executeOrComplete();
      };
    });
  }

  function _hidePalette() {
    const p = document.getElementById('commandPalette');
    if (p) p.classList.add('hidden');
  }

  function _isVisible() {
    const p = document.getElementById('commandPalette');
    return p && !p.classList.contains('hidden');
  }

  function _onInput() {
    if (!_input) return;
    const value = _input.value;
    if (!value || value[0] !== '/') { _hidePalette(); return; }
    // 多行后不再当命令处理（避免句子中的 /）
    if (value.indexOf('\n') >= 0) { _hidePalette(); return; }
    // 只取第一个 token 做匹配（"/compact xxx" 仍然能匹配 /compact）
    const firstToken = value.split(/\s+/)[0];
    _filtered = _filter(firstToken);
    if (_activeIdx >= _filtered.length) _activeIdx = 0;
    _showPalette();
  }

  function _onKeydown(e) {
    if (!_isVisible()) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _activeIdx = (_activeIdx + 1) % _filtered.length;
      _showPalette();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _activeIdx = (_activeIdx - 1 + _filtered.length) % _filtered.length;
      _showPalette();
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      _completeCurrent();
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const value = _input.value.trim();
      const cmd = _filtered[_activeIdx];
      if (cmd && (value === cmd.name || value.indexOf(cmd.name + ' ') === 0)) {
        e.preventDefault();
        _executeCommand(cmd, value);
        return true;
      }
      e.preventDefault();
      _completeCurrent();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _hidePalette();
      return true;
    }
    return false;
  }

  function _completeCurrent() {
    const cmd = _filtered[_activeIdx];
    if (!cmd || !_input) return;
    _input.value = cmd.name + ' ';
    _input.focus();
    // 触发 autoResize
    if (typeof window.autoResize === 'function') window.autoResize(_input);
    _hidePalette();
  }

  function _executeOrComplete() {
    const cmd = _filtered[_activeIdx];
    if (!cmd || !_input) return;
    const value = _input.value.trim();
    // 如果输入已完整匹配命令名，直接执行
    if (value === cmd.name || value.indexOf(cmd.name + ' ') === 0) {
      _executeCommand(cmd, value);
    } else {
      _completeCurrent();
    }
  }

  function _executeCommand(cmd, fullText) {
    const args = fullText.slice(cmd.name.length).trim();
    try {
      const result = cmd.handler(args, { input: _input });
      Promise.resolve(result).catch(function (e) {
        console.error('[command]', cmd.name, e);
      });
    } finally {
      if (_input) {
        _input.value = '';
        _input.style.height = 'auto';
      }
      _hidePalette();
    }
  }

  function init(input) {
    _input = input;
    if (!input) return;
    input.addEventListener('input', _onInput);
    // 用 capture 阶段，确保在 chat 自带 handleKey(Enter发送) 之前拦截
    input.addEventListener('keydown', _onKeydown, true);
    input.addEventListener('blur', function () {
      // 延迟隐藏，给 mousedown 留出时间
      setTimeout(_hidePalette, 150);
    });
  }

  function listCommands() {
    return _commands.slice();
  }

  window._t2aCommands = { registerCommand, init, listCommands };
})();
