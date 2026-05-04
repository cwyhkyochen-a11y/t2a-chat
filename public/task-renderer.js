// T2A Chat — Task 卡片渲染注册表
// 职责：管理 task renderer 注册 + 5 种默认渲染器（image/video/form_short/form_file/text）

(function () {
  'use strict';

  // ---- Renderer 注册表 ----
  const _renderers = {};

  /**
   * 注册 task 渲染器
   * @param {string} name - renderer 名（如 'image-card', 'video-card'）
   * @param {object} renderer
   *   - render(task, container): 首次渲染
   *   - onUpdate(task, container): 状态更新时重绘
   *   - onCancel?(task, container): 取消时的特殊处理
   */
  function registerTaskRenderer(name, renderer) {
    _renderers[name] = renderer;
  }

  /**
   * 获取 renderer
   */
  function getRenderer(name) {
    return _renderers[name] || _renderers['text-card'] || null;
  }

  /**
   * 渲染一个 task 卡片到容器
   * @param {object} task - { id, type, status, prompt?, result?, params?, progress? }
   * @param {HTMLElement} container - 挂载点
   * @returns {HTMLElement} 渲染出的卡片元素
   */
  function renderTask(task, container) {
    const rendererName = task.render || _typeToRenderer(task.type);
    const renderer = getRenderer(rendererName);
    if (!renderer) {
      console.warn('[t2aChat] no renderer for:', rendererName);
      return null;
    }
    const el = document.createElement('div');
    el.className = 'task-card task-card--' + (task.type || 'unknown');
    el.dataset.taskId = task.id || '';
    el.dataset.renderer = rendererName;
    renderer.render(task, el);
    container.appendChild(el);
    return el;
  }

  /**
   * 更新已渲染的 task 卡片
   */
  function updateTask(task, cardEl) {
    if (!cardEl) return;
    const rendererName = cardEl.dataset.renderer;
    const renderer = getRenderer(rendererName);
    if (renderer && renderer.onUpdate) {
      renderer.onUpdate(task, cardEl);
    }
  }

  /**
   * 取消 task 的渲染处理
   */
  function cancelTask(task, cardEl) {
    if (!cardEl) return;
    const rendererName = cardEl.dataset.renderer;
    const renderer = getRenderer(rendererName);
    if (renderer && renderer.onCancel) {
      renderer.onCancel(task, cardEl);
    } else {
      // 默认：更新状态为 cancelled
      task.status = 'cancelled';
      updateTask(task, cardEl);
    }
  }

  // ---- 类型 → renderer 映射 ----
  function _typeToRenderer(type) {
    const map = {
      image: 'image-card',
      video: 'video-card',
      form_short: 'form-short-card',
      form_file: 'form-file-card',
      text: 'text-card',
    };
    return map[type] || 'text-card';
  }

  // ---- 状态 badge 工具 ----
  function _statusBadge(status) {
    const labels = {
      processing: '生成中...',
      submitted: '已提交',
      success: '已完成',
      succeeded: '已完成',
      error: '失败',
      failed: '失败',
      cancelled: '已取消',
    };
    const classes = {
      processing: 'processing',
      submitted: 'processing',
      success: 'done',
      succeeded: 'done',
      error: 'error',
      failed: 'error',
      cancelled: 'error',
    };
    const label = labels[status] || status;
    const cls = classes[status] || 'processing';
    return '<span class="task-badge task-badge--' + cls + '">' + _esc(label) + '</span>';
  }

  // 取消按钮（生成中时显示）
  function _cancelBtn(task) {
    if (task.status !== 'processing' && task.status !== 'submitted') return '';
    return '<button class="task-cancel-btn" data-task-id="' + _esc(task.id) + '" title="取消">✕</button>';
  }

  // ---- 5 种默认 renderer ----

  // 1. image-card
  registerTaskRenderer('image-card', {
    render(task, el) {
      el.innerHTML = this._html(task);
      this._bindCancel(el, task);
    },
    onUpdate(task, el) {
      el.innerHTML = this._html(task);
      this._bindCancel(el, task);
    },
    onCancel(task, el) {
      task.status = 'cancelled';
      el.innerHTML = this._html(task);
    },
    _html(task) {
      const prompt = task.prompt || (task.params && task.params.prompt) || '';
      const thumb = task.result && task.result.url
        ? '<img class="task-thumb" src="' + _esc(task.result.url) + '" alt="result">'
        : '<div class="task-thumb-placeholder">🖼</div>';
      return '<div class="task-card-inner">' +
        '<div class="task-card-header">' +
          '<span class="task-card-icon">🖼</span>' +
          _statusBadge(task.status) +
          _cancelBtn(task) +
        '</div>' +
        '<div class="task-card-body">' +
          '<p class="task-prompt">' + _esc(prompt) + '</p>' +
          (task.status === 'success' || task.status === 'succeeded' ? thumb : '') +
        '</div>' +
      '</div>';
    },
    _bindCancel(el, task) {
      const btn = el.querySelector('.task-cancel-btn');
      if (btn) btn.onclick = () => _emitCancel(task.id);
    },
  });

  // 2. video-card
  registerTaskRenderer('video-card', {
    render(task, el) {
      el.innerHTML = this._html(task);
      this._bindCancel(el, task);
    },
    onUpdate(task, el) {
      el.innerHTML = this._html(task);
      this._bindCancel(el, task);
    },
    onCancel(task, el) {
      task.status = 'cancelled';
      el.innerHTML = this._html(task);
    },
    _html(task) {
      const prompt = task.prompt || (task.params && task.params.prompt) || '';
      const videoEl = task.result && task.result.url
        ? '<video class="task-video-preview" src="' + _esc(task.result.url) + '" controls></video>'
        : '<div class="task-thumb-placeholder">🎬</div>';
      return '<div class="task-card-inner">' +
        '<div class="task-card-header">' +
          '<span class="task-card-icon">🎬</span>' +
          _statusBadge(task.status) +
          _cancelBtn(task) +
        '</div>' +
        '<div class="task-card-body">' +
          '<p class="task-prompt">' + _esc(prompt) + '</p>' +
          (task.status === 'success' || task.status === 'succeeded' ? videoEl : '') +
        '</div>' +
      '</div>';
    },
    _bindCancel(el, task) {
      const btn = el.querySelector('.task-cancel-btn');
      if (btn) btn.onclick = () => _emitCancel(task.id);
    },
  });

  // 3. form-short-card
  registerTaskRenderer('form-short-card', {
    render(task, el) {
      el.innerHTML = this._html(task);
    },
    onUpdate(task, el) {
      el.innerHTML = this._html(task);
    },
    _html(task) {
      const params = task.params || {};
      const keys = Object.keys(params);
      let kvHtml = '';
      for (let i = 0; i < Math.min(keys.length, 6); i++) {
        kvHtml += '<div class="task-kv"><span class="task-kv-key">' + _esc(keys[i]) + '</span>' +
          '<span class="task-kv-val">' + _esc(String(params[keys[i]]).slice(0, 80)) + '</span></div>';
      }
      return '<div class="task-card-inner">' +
        '<div class="task-card-header">' +
          '<span class="task-card-icon">📋</span>' +
          _statusBadge(task.status) +
        '</div>' +
        '<div class="task-card-body">' + kvHtml + '</div>' +
      '</div>';
    },
  });

  // 4. form-file-card
  registerTaskRenderer('form-file-card', {
    render(task, el) {
      el.innerHTML = this._html(task);
      this._bindCancel(el, task);
    },
    onUpdate(task, el) {
      el.innerHTML = this._html(task);
      this._bindCancel(el, task);
    },
    _html(task) {
      const params = task.params || {};
      const fileName = params.fileName || params.file_name || '文件处理';
      const progress = task.progress != null ? task.progress : -1;
      const progressHtml = progress >= 0
        ? '<div class="task-progress"><div class="task-progress-bar" style="width:' + progress + '%"></div></div>'
        : '';
      return '<div class="task-card-inner">' +
        '<div class="task-card-header">' +
          '<span class="task-card-icon">📄</span>' +
          _statusBadge(task.status) +
          _cancelBtn(task) +
        '</div>' +
        '<div class="task-card-body">' +
          '<p class="task-prompt">' + _esc(fileName) + '</p>' +
          progressHtml +
        '</div>' +
      '</div>';
    },
    _bindCancel(el, task) {
      const btn = el.querySelector('.task-cancel-btn');
      if (btn) btn.onclick = () => _emitCancel(task.id);
    },
  });

  // 5. text-card
  registerTaskRenderer('text-card', {
    render(task, el) {
      el.innerHTML = this._html(task);
    },
    onUpdate(task, el) {
      el.innerHTML = this._html(task);
    },
    _html(task) {
      const text = task.prompt || task.params && task.params.text || '';
      return '<div class="task-card-inner">' +
        '<div class="task-card-header">' +
          '<span class="task-card-icon">📝</span>' +
          _statusBadge(task.status) +
        '</div>' +
        '<div class="task-card-body">' +
          '<p class="task-prompt">' + _esc(text) + '</p>' +
        '</div>' +
      '</div>';
    },
  });

  // ---- 内部工具 ----
  function _esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function _emitCancel(taskId) {
    if (window._t2aSlots && window._t2aSlots.emit) {
      window._t2aSlots.emit('task:cancel-request', { taskId });
    }
  }

  // ---- 暴露 ----
  window._t2aTaskRenderer = {
    registerTaskRenderer,
    getRenderer,
    renderTask,
    updateTask,
    cancelTask,
  };
})();
