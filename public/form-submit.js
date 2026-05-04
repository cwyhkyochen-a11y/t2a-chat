/**
 * form-submit.js — 表单提交回写逻辑
 * 监听 form-block submit 按钮 → 校验 → 序列化 → 通过 onSubmit 回调发送
 */
(function () {
  'use strict';

  function serializeFormValues(result) {
    var lines = ['[表单回复]'];
    var fields = result.fields || [];
    var values = result.values || {};

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var val = values[field.id];

      // 跳过空值
      if (val === undefined || val === null || val === '') continue;
      if (Array.isArray(val) && val.length === 0) continue;

      var label = field.label || field.id;
      var formatted;

      if (Array.isArray(val)) {
        // 多选用顿号分隔
        formatted = val.join('、');
      } else if (typeof val === 'string' && val.indexOf('\n') !== -1) {
        // textarea 含换行，后续行缩进 2 空格
        var parts = val.split('\n');
        formatted = parts[0];
        for (var j = 1; j < parts.length; j++) {
          formatted += '\n  ' + parts[j];
        }
      } else {
        formatted = String(val);
      }

      lines.push(label + ': ' + formatted);
    }

    return lines.join('\n');
  }

  function handleFormSubmit(formEl) {
    var renderer = window._t2aFormRenderer;
    if (!renderer) return;

    // 校验
    var errors = renderer.validate(formEl);
    var errEl = formEl.querySelector('.form-error-msg');

    if (errors && errors.length > 0) {
      if (errEl) {
        errEl.textContent = errors[0].label + ': ' + errors[0].message;
        errEl.style.display = '';
      }
      return;
    }

    // 收集
    var result = renderer.collect(formEl);
    var text = serializeFormValues(result);

    // 回调发送
    if (window._t2aFormSubmit && typeof window._t2aFormSubmit.onSubmit === 'function') {
      window._t2aFormSubmit.onSubmit(text, formEl);
    }

    // 标记已提交
    renderer.markSubmitted(formEl, new Date());

    // 清除错误
    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }
  }

  // 事件委托
  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('messages');
    if (!container) return;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.form-submit-btn');
      if (!btn) return;
      var formEl = btn.closest('.form-block');
      if (!formEl || formEl.dataset.state !== 'unsubmitted') return;
      handleFormSubmit(formEl);
    });
  });

  // 导出
  window._t2aFormSubmit = {
    onSubmit: null,
    handleFormSubmit: handleFormSubmit,
    serializeFormValues: serializeFormValues
  };
})();
