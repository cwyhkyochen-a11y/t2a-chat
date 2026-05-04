/**
 * t2a-chat Form Renderer
 * 根据 parser 输出渲染交互式表单 DOM，提供 collect / validate / 状态切换
 * 纯原生 JS，无依赖，浏览器 + Node 通用
 */
;(function (root) {
  'use strict';

  // ─── Helpers ──────────────────────────────────────────────────────

  function el(tag, cls, attrs) {
    var node = document.createElement(tag);
    if (cls) {
      var classes = cls.split(' ');
      for (var i = 0; i < classes.length; i++) {
        if (classes[i]) node.classList.add(classes[i]);
      }
    }
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        node.setAttribute(keys[i], attrs[keys[i]]);
      }
    }
    return node;
  }

  function text(parent, str) {
    parent.textContent = str;
    return parent;
  }

  // ─── render ───────────────────────────────────────────────────────

  function render(parsed, formId) {
    // 降级：parser 报错
    if (parsed._error) {
      var block = el('div', 'form-block', { 'data-form-id': formId, 'data-state': 'stale' });
      var errP = el('p');
      errP.textContent = '⚠ 表单解析失败：' + parsed._error;
      errP.style.color = 'var(--color-error)';
      errP.style.fontSize = '13px';
      block.appendChild(errP);
      return block;
    }

    var block = el('div', 'form-block', { 'data-form-id': formId, 'data-state': 'unsubmitted' });

    // fields container
    var fieldsWrap = el('div', 'form-fields');
    var fields = parsed.fields || [];

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var fieldEl = renderField(f, formId);
      if (fieldEl) fieldsWrap.appendChild(fieldEl);
    }
    block.appendChild(fieldsWrap);

    // 附录字段（SDK 自动注入）
    var extraField = el('div', 'form-field form-field-extra');
    var extraLabel = el('label', 'form-label');
    extraLabel.textContent = '附加说明';
    var optSpan = el('span', 'form-optional');
    optSpan.textContent = '（选填，≤500字）';
    extraLabel.appendChild(optSpan);
    extraField.appendChild(extraLabel);
    var extraTa = el('textarea', 'form-extra-input', {
      placeholder: '有其他想补充的可以写在这里...',
      maxlength: '500',
      rows: '2'
    });
    extraField.appendChild(extraTa);
    var extraCount = el('div', 'form-extra-count');
    var extraCurrent = el('span', 'form-extra-current');
    extraCurrent.textContent = '0';
    extraCount.appendChild(extraCurrent);
    extraCount.appendChild(document.createTextNode('/500'));
    extraField.appendChild(extraCount);
    extraTa.addEventListener('input', function () {
      extraCurrent.textContent = String(extraTa.value.length);
    });
    block.appendChild(extraField);

    // actions
    var actions = el('div', 'form-actions');
    var submitBtn = el('button', 'form-submit-btn');
    submitBtn.setAttribute('type', 'button');
    submitBtn.textContent = parsed.submitLabel || '提交';
    actions.appendChild(submitBtn);

    var errorMsg = el('span', 'form-error-msg');
    actions.appendChild(errorMsg);
    block.appendChild(actions);

    // submitted tag
    var submittedTag = el('div', 'form-submitted-tag');
    var submittedIcon = el('span', 'form-submitted-icon');
    submittedIcon.textContent = '✓';
    submittedTag.appendChild(submittedIcon);
    var submittedText = el('span', 'form-submitted-text');
    submittedText.textContent = '';
    submittedTag.appendChild(submittedText);
    block.appendChild(submittedTag);

    return block;
  }

  function renderField(f, formId) {
    var type = f.type || 'text';

    if (type === 'select') {
      return renderSelect(f, formId);
    }
    if (type === 'textarea') {
      return renderTextarea(f, formId);
    }
    // text, number
    return renderInput(f, formId, type);
  }

  function renderSelect(f, formId) {
    var mode = f.mode || 'radio';
    var attrs = { 'data-type': 'select', 'data-mode': mode, 'data-field-id': f.id };
    if (mode === 'checkbox' && f.max) {
      attrs['data-max'] = String(f.max);
    }
    var fieldEl = el('div', 'form-field', attrs);

    // label
    var label = el('label', 'form-field-label');
    label.textContent = f.label || f.id;
    if (f.required) {
      var req = el('span', 'form-required');
      req.textContent = '*';
      label.appendChild(req);
    }
    if (mode === 'checkbox' && f.max) {
      var hint = el('span', 'form-hint');
      hint.textContent = '最多 ' + f.max + ' 项';
      label.appendChild(hint);
    }
    fieldEl.appendChild(label);

    // options
    var optionsWrap = el('div', 'form-options');
    var options = f.options || [];
    var inputType = mode === 'checkbox' ? 'checkbox' : 'radio';
    var inputName = formId + '_' + f.id;

    for (var i = 0; i < options.length; i++) {
      var optLabel = el('label', 'form-option');
      var input = el('input', null, {
        type: inputType,
        name: inputName,
        value: options[i]
      });
      optLabel.appendChild(input);
      var span = el('span');
      span.textContent = options[i];
      optLabel.appendChild(span);
      optionsWrap.appendChild(optLabel);
    }
    fieldEl.appendChild(optionsWrap);

    // checkbox max 限制
    if (mode === 'checkbox' && f.max) {
      setupCheckboxMax(optionsWrap, f.max);
    }

    return fieldEl;
  }

  function setupCheckboxMax(optionsWrap, max) {
    optionsWrap.addEventListener('change', function () {
      var checks = optionsWrap.querySelectorAll('input[type="checkbox"]');
      var checked = 0;
      for (var i = 0; i < checks.length; i++) {
        if (checks[i].checked) checked++;
      }
      for (var i = 0; i < checks.length; i++) {
        if (!checks[i].checked) {
          checks[i].disabled = checked >= max;
        }
      }
    });
  }

  function renderInput(f, formId, type) {
    var fieldEl = el('div', 'form-field', { 'data-type': type, 'data-field-id': f.id });

    var label = el('label', 'form-field-label');
    label.textContent = f.label || f.id;
    if (f.required) {
      var req = el('span', 'form-required');
      req.textContent = '*';
      label.appendChild(req);
    }
    fieldEl.appendChild(label);

    var inputAttrs = {
      type: type === 'number' ? 'number' : 'text',
      name: formId + '_' + f.id
    };
    if (f.placeholder) inputAttrs.placeholder = f.placeholder;
    var input = el('input', 'form-input', inputAttrs);
    fieldEl.appendChild(input);

    return fieldEl;
  }

  function renderTextarea(f, formId) {
    var fieldEl = el('div', 'form-field', { 'data-type': 'textarea', 'data-field-id': f.id });

    var label = el('label', 'form-field-label');
    label.textContent = f.label || f.id;
    if (f.required) {
      var req = el('span', 'form-required');
      req.textContent = '*';
      label.appendChild(req);
    }
    fieldEl.appendChild(label);

    var textareaAttrs = { name: formId + '_' + f.id, rows: '3' };
    if (f.placeholder) textareaAttrs.placeholder = f.placeholder;
    var textarea = el('textarea', 'form-textarea', textareaAttrs);
    fieldEl.appendChild(textarea);

    return fieldEl;
  }

  // ─── collect ──────────────────────────────────────────────────────

  function collect(formEl) {
    var values = {};
    var fields = [];
    var fieldEls = formEl.querySelectorAll('.form-field');

    for (var i = 0; i < fieldEls.length; i++) {
      var fe = fieldEls[i];
      var type = fe.getAttribute('data-type');
      var mode = fe.getAttribute('data-mode');
      var fieldId = fe.getAttribute('data-field-id');
      var labelEl = fe.querySelector('.form-field-label');
      var label = labelEl ? labelEl.textContent.replace(/\*$/, '').trim() : fieldId;

      var val = null;

      if (type === 'select' && mode === 'radio') {
        var checked = fe.querySelector('input[type="radio"]:checked');
        val = checked ? checked.value : null;
      } else if (type === 'select' && mode === 'checkbox') {
        var checkedBoxes = fe.querySelectorAll('input[type="checkbox"]:checked');
        val = [];
        for (var j = 0; j < checkedBoxes.length; j++) {
          val.push(checkedBoxes[j].value);
        }
      } else if (type === 'number') {
        var numInput = fe.querySelector('input');
        var raw = numInput ? numInput.value.trim() : '';
        val = raw === '' ? null : parseFloat(raw);
        if (val !== null && isNaN(val)) val = null;
      } else if (type === 'textarea') {
        var ta = fe.querySelector('textarea');
        val = ta ? ta.value : '';
      } else {
        // text and others
        var inp = fe.querySelector('input');
        val = inp ? inp.value : '';
      }

      values[fieldId] = val;
      fields.push({ id: fieldId, label: label, type: type, mode: mode || undefined });
    }

    return { values: values, fields: fields };
  }

  // ─── validate ─────────────────────────────────────────────────────

  function validate(formEl) {
    var errors = [];
    var fieldEls = formEl.querySelectorAll('.form-field');

    for (var i = 0; i < fieldEls.length; i++) {
      var fe = fieldEls[i];
      var type = fe.getAttribute('data-type');
      var mode = fe.getAttribute('data-mode');
      var fieldId = fe.getAttribute('data-field-id');
      var labelEl = fe.querySelector('.form-field-label');
      var label = labelEl ? labelEl.textContent.replace(/\*$/, '').trim() : fieldId;

      // check required: look for .form-required span
      var isRequired = !!fe.querySelector('.form-required');

      if (type === 'select' && mode === 'radio') {
        if (isRequired) {
          var checked = fe.querySelector('input[type="radio"]:checked');
          if (!checked) {
            errors.push({ fieldId: fieldId, label: label, message: '请选择' + label });
          }
        }
      } else if (type === 'select' && mode === 'checkbox') {
        var checkedBoxes = fe.querySelectorAll('input[type="checkbox"]:checked');
        if (isRequired && checkedBoxes.length === 0) {
          errors.push({ fieldId: fieldId, label: label, message: '请至少选择一项' });
        }
        var max = parseInt(fe.getAttribute('data-max'), 10);
        if (max && checkedBoxes.length > max) {
          errors.push({ fieldId: fieldId, label: label, message: '最多选择 ' + max + ' 项' });
        }
      } else if (type === 'number') {
        var numInput = fe.querySelector('input');
        var raw = numInput ? numInput.value.trim() : '';
        if (isRequired && raw === '') {
          errors.push({ fieldId: fieldId, label: label, message: '请填写' + label });
        }
      } else if (type === 'textarea') {
        var ta = fe.querySelector('textarea');
        var val = ta ? ta.value.trim() : '';
        if (isRequired && val === '') {
          errors.push({ fieldId: fieldId, label: label, message: '请填写' + label });
        }
      } else {
        // text
        var inp = fe.querySelector('input');
        var val = inp ? inp.value.trim() : '';
        if (isRequired && val === '') {
          errors.push({ fieldId: fieldId, label: label, message: '请填写' + label });
        }
      }
    }

    return errors;
  }

  // ─── markSubmitted ────────────────────────────────────────────────

  function markSubmitted(formEl, time) {
    formEl.setAttribute('data-state', 'submitted');

    // update time text
    var displayStr = '';
    if (time === null || time === undefined) {
      // 历史回放：不显示具体时间
      displayStr = '已提交';
    } else if (typeof time === 'string') {
      displayStr = '已提交于 ' + time;
    } else if (time instanceof Date) {
      var h = String(time.getHours()).padStart(2, '0');
      var m = String(time.getMinutes()).padStart(2, '0');
      displayStr = '已提交于 ' + h + ':' + m;
    } else {
      var d = new Date(time);
      var h = String(d.getHours()).padStart(2, '0');
      var m = String(d.getMinutes()).padStart(2, '0');
      displayStr = '已提交于 ' + h + ':' + m;
    }

    var submittedText = formEl.querySelector('.form-submitted-text');
    if (submittedText) {
      submittedText.textContent = displayStr;
    }

    // disable all inputs
    disableAll(formEl);
  }

  // ─── markStale ────────────────────────────────────────────────────

  function markStale(formEl) {
    formEl.setAttribute('data-state', 'stale');
    disableAll(formEl);
  }

  // ─── disableAll ───────────────────────────────────────────────────

  function disableAll(formEl) {
    var inputs = formEl.querySelectorAll('input, textarea, button');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].disabled = true;
    }
  }

  // ─── Export ────────────────────────────────────────────────────────

  var api = {
    render: render,
    collect: collect,
    validate: validate,
    markSubmitted: markSubmitted,
    markStale: markStale
  };

  if (typeof window !== 'undefined') {
    window._t2aFormRenderer = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

})(typeof window !== 'undefined' ? window : global);
