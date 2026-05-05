// T2A Chat — Attachment Manager
// 模块：window._t2aAttachments
// API: init(opts), getCurrent(), clear(), render()

(function () {
  'use strict';

  let _config = null; // { uploadUrl, baseUrl, maxMb, accept }
  let _attachments = []; // [{ url, filename, kind, size, csv?, status }]
  let _chipsContainer = null;
  let _fileInput = null;
  let _attachBtn = null;

  async function init(opts) {
    opts = opts || {};
    _chipsContainer = document.getElementById('attachmentChips');
    _fileInput = document.getElementById('attachFileInput');
    _attachBtn = document.getElementById('attachBtn');

    // Load upload config
    try {
      const apiBase = (window.T2A_CHAT_CONFIG && window.T2A_CHAT_CONFIG.apiBase) || '/api/chat';
      const res = await fetch(apiBase + '/upload-config', { credentials: 'include' });
      if (res.ok) _config = await res.json();
    } catch (e) {
      console.warn('[attachments] failed to load upload-config:', e);
    }
    if (!_config) {
      _config = { uploadUrl: '/api/chat/upload', baseUrl: '', maxMb: 20, accept: {} };
    }

    // Bind events
    if (_attachBtn) {
      _attachBtn.addEventListener('click', function () {
        if (_fileInput) _fileInput.click();
      });
    }
    if (_fileInput) {
      _fileInput.addEventListener('change', handleFileSelect);
    }
  }

  function handleFileSelect(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      processFile(files[i]);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  }

  function processFile(file) {
    const kind = inferKind(file);
    if (!kind) {
      showError('不支持的文件类型: ' + file.name);
      return;
    }
    if (file.size > _config.maxMb * 1024 * 1024) {
      showError('文件过大: ' + file.name + ' (最大' + _config.maxMb + 'MB)');
      return;
    }

    if (kind === 'excel') {
      // Excel: parse locally, no upload
      parseExcel(file);
    } else {
      // Image/Video: upload
      uploadFile(file, kind);
    }
  }

  function inferKind(file) {
    const type = file.type || '';
    const name = (file.name || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv') ||
        type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') {
      return 'excel';
    }
    return null;
  }

  function uploadFile(file, kind) {
    const idx = _attachments.length;
    _attachments.push({
      url: null, filename: file.name, kind: kind,
      size: file.size, csv: null, status: 'uploading', progress: 0,
    });
    render();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', kind);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', _config.uploadUrl, true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        var pct = Math.round((e.loaded / e.total) * 100);
        _attachments[idx].progress = pct;
        render();
      }
    };
    xhr.onload = function () {
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = { error: 'invalid response' }; }
      if (xhr.status < 200 || xhr.status >= 300 || data.error) {
        _attachments[idx].status = 'error';
        _attachments[idx].errorMsg = data.error || ('HTTP ' + xhr.status);
      } else {
        _attachments[idx].url = data.url;
        _attachments[idx].filename = data.filename || file.name;
        _attachments[idx].size = data.size || file.size;
        _attachments[idx].status = 'ready';
        _attachments[idx].progress = 100;
      }
      render();
    };
    xhr.onerror = function () {
      _attachments[idx].status = 'error';
      _attachments[idx].errorMsg = 'upload failed';
      render();
    };
    xhr.send(formData);
  }

  function parseExcel(file) {
    const idx = _attachments.length;
    _attachments.push({
      url: null, filename: file.name, kind: 'excel-text',
      size: file.size, csv: null, status: 'parsing',
    });
    render();

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        if (typeof XLSX === 'undefined') {
          _attachments[idx].status = 'error';
          _attachments[idx].errorMsg = 'XLSX library not loaded';
          render();
          return;
        }
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[firstSheet]);
        _attachments[idx].csv = csv;
        _attachments[idx].status = 'ready';
      } catch (err) {
        _attachments[idx].status = 'error';
        _attachments[idx].errorMsg = 'Excel 解析失败';
      }
      render();
    };
    reader.onerror = function () {
      _attachments[idx].status = 'error';
      _attachments[idx].errorMsg = '文件读取失败';
      render();
    };
    reader.readAsArrayBuffer(file);
  }

  function getCurrent() {
    return _attachments.filter(function (a) { return a.status === 'ready'; }).map(function (a) {
      return { url: a.url, filename: a.filename, kind: a.kind, size: a.size, csv: a.csv || undefined };
    });
  }

  function clear() {
    _attachments = [];
    render();
  }

  function remove(idx) {
    _attachments.splice(idx, 1);
    render();
  }

  function render() {
    if (!_chipsContainer) return;
    if (_attachments.length === 0) {
      _chipsContainer.innerHTML = '';
      _chipsContainer.style.display = 'none';
      return;
    }
    _chipsContainer.style.display = 'flex';
    var html = '';
    for (var i = 0; i < _attachments.length; i++) {
      var a = _attachments[i];
      var cls = 'attachment-chip';
      if (a.status === 'error') cls += ' error';
      if (a.status === 'uploading' || a.status === 'parsing') cls += ' loading';

      var icon = '';
      if (a.kind === 'image' && a.url) {
        icon = '<img class="chip-thumb" src="' + esc(a.url) + '" alt="">';
      } else if (a.kind === 'image') {
        icon = '<span class="chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>';
      } else if (a.kind === 'video') {
        icon = '<span class="chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></span>';
      } else if (a.kind === 'excel-text' || a.kind === 'excel') {
        icon = '<span class="chip-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg></span>';
      }

      var label = truncName(a.filename || 'file', 20);
      var statusTag = '';
      if (a.status === 'uploading') statusTag = '<span class="chip-status chip-spinner"></span>';
      if (a.status === 'parsing') statusTag = '<span class="chip-status chip-spinner"></span>';
      if (a.status === 'error') statusTag = '<span class="chip-status chip-error" title="' + esc(a.errorMsg || '') + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></span>';

      var progressBar = '';
      if (a.status === 'uploading') {
        var pct = typeof a.progress === 'number' ? a.progress : 0;
        progressBar = '<div class="attachment-chip-progress"><div class="attachment-chip-progress-fill" style="width:' + pct + '%"></div></div>';
      }
      html += '<div class="' + cls + '" data-idx="' + i + '">' +
        icon + '<span class="chip-name">' + esc(label) + '</span>' +
        statusTag +
        '<button class="attachment-chip-remove" data-idx="' + i + '" title="移除">×</button>' +
        progressBar +
        '</div>';
    }
    _chipsContainer.innerHTML = html;

    // Bind remove buttons
    var btns = _chipsContainer.querySelectorAll('.attachment-chip-remove');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        remove(idx);
      });
    }
  }

  function showError(msg) {
    if (window._t2aDom && window._t2aDom.toast) {
      window._t2aDom.toast(msg, 'error');
    } else {
      console.error('[attachments]', msg);
    }
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function truncName(s, max) {
    if (!s || s.length <= max) return s;
    var ext = s.lastIndexOf('.');
    if (ext > 0 && s.length - ext <= 6) {
      return s.slice(0, max - 4 - (s.length - ext)) + '...' + s.slice(ext);
    }
    return s.slice(0, max - 3) + '...';
  }

  window._t2aAttachments = {
    init: init,
    getCurrent: getCurrent,
    clear: clear,
    render: render,
  };
})();
