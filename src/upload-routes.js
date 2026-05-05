// upload-routes.js — 多模态附件上传
// - GET  /api/chat/upload-config  → 返回前端上传配置
// - POST /api/chat/upload         → 内置上传（multipart/form-data，手撕 boundary）
// - GET  /uploads/:filename       → 静态返回上传文件

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { jsonRes, readBody } = require('./utils');

const DEFAULT_MAX_MB = 20;
const DEFAULT_DIR = './data/uploads';

// 允许的 MIME 类型（按 kind）
const ACCEPT = {
  image: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'],
  excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel', 'text/csv'],
};

function getConfig() {
  return {
    apiUrl: process.env.TCHAT_UPLOAD_API_URL || '',
    baseUrl: process.env.TCHAT_UPLOAD_BASE_URL || '',
    maxMb: Number(process.env.TCHAT_UPLOAD_MAX_MB) || DEFAULT_MAX_MB,
    dir: process.env.TCHAT_UPLOAD_DIR || DEFAULT_DIR,
  };
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

// 接受 GET /api/chat/upload-config
function handleUploadConfig(req, res) {
  const cfg = getConfig();
  return jsonRes(res, 200, {
    uploadUrl: cfg.apiUrl || '/api/chat/upload',
    baseUrl: cfg.baseUrl || '',
    maxMb: cfg.maxMb,
    accept: ACCEPT,
  });
}

// POST /api/chat/upload — 处理 multipart 上传
async function handleUpload(req, res) {
  const cfg = getConfig();
  ensureDir(cfg.dir);

  const ctype = req.headers['content-type'] || '';
  if (!ctype.startsWith('multipart/form-data')) {
    return jsonRes(res, 400, { error: 'expected multipart/form-data' });
  }
  const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) return jsonRes(res, 400, { error: 'missing boundary' });
  const boundary = m[1] || m[2];

  // 限制总大小：cfg.maxMb + 1MB 富余
  const maxBytes = cfg.maxMb * 1024 * 1024 + 1024 * 1024;

  let buf;
  try {
    buf = await readRawBody(req, maxBytes);
  } catch (err) {
    return jsonRes(res, 413, { error: err.message });
  }

  let parts;
  try {
    parts = parseMultipart(buf, boundary);
  } catch (err) {
    return jsonRes(res, 400, { error: 'parse error: ' + err.message });
  }

  const filePart = parts.find(p => p.name === 'file');
  const kindPart = parts.find(p => p.name === 'kind');
  if (!filePart) return jsonRes(res, 400, { error: 'file field required' });
  if (!kindPart) return jsonRes(res, 400, { error: 'kind field required' });

  const kind = kindPart.data.toString('utf8').trim();
  if (!ACCEPT[kind]) return jsonRes(res, 400, { error: 'invalid kind: ' + kind });

  const filename = filePart.filename || 'upload';
  const mime = filePart.contentType || 'application/octet-stream';
  if (!ACCEPT[kind].includes(mime)) {
    return jsonRes(res, 415, { error: `mime ${mime} not allowed for kind ${kind}` });
  }

  const size = filePart.data.length;
  if (size > cfg.maxMb * 1024 * 1024) {
    return jsonRes(res, 413, { error: `file too large (max ${cfg.maxMb}MB)` });
  }

  // 生成唯一文件名（保留扩展名）
  const ext = path.extname(filename) || extFromMime(mime);
  const hash = crypto.randomBytes(8).toString('hex');
  const stamp = Date.now().toString(36);
  const stored = `${stamp}-${hash}${ext}`;
  const fullPath = path.join(cfg.dir, stored);

  try {
    fs.writeFileSync(fullPath, filePart.data);
  } catch (err) {
    return jsonRes(res, 500, { error: 'write failed: ' + err.message });
  }

  const url = (cfg.baseUrl || '') + '/uploads/' + stored;
  return jsonRes(res, 200, { url, filename, size, kind });
}

// GET /uploads/:filename — 静态文件
function handleStaticUpload(req, res, urlPath) {
  const cfg = getConfig();
  const name = urlPath.replace(/^\/uploads\//, '');
  // 防 path traversal
  if (!name || name.includes('/') || name.includes('..')) {
    res.statusCode = 400; res.end('bad path'); return;
  }
  const full = path.join(cfg.dir, name);
  if (!fs.existsSync(full)) {
    res.statusCode = 404; res.end('not found'); return;
  }
  const ext = path.extname(name).toLowerCase();
  res.setHeader('Content-Type', mimeFromExt(ext) || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(full).pipe(res);
}

// ---- helpers ----

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 简易 multipart 解析器：返回 [{ name, filename?, contentType?, data: Buffer }, ...]
function parseMultipart(buf, boundary) {
  const delim = Buffer.from('--' + boundary);
  const result = [];
  let pos = 0;

  // 找第一个 delim
  let start = buf.indexOf(delim, pos);
  if (start < 0) throw new Error('boundary not found');
  pos = start + delim.length;

  while (pos < buf.length) {
    // skip CRLF after boundary, or detect end '--'
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // '--' end
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;

    // parse headers until \r\n\r\n
    const headerEnd = buf.indexOf('\r\n\r\n', pos);
    if (headerEnd < 0) throw new Error('headers end not found');
    const headerStr = buf.slice(pos, headerEnd).toString('utf8');
    pos = headerEnd + 4;

    // next boundary
    const nextDelim = buf.indexOf(delim, pos);
    if (nextDelim < 0) throw new Error('next boundary not found');
    // data is up to nextDelim - 2 (strip trailing \r\n)
    let dataEnd = nextDelim;
    if (buf[dataEnd - 2] === 0x0d && buf[dataEnd - 1] === 0x0a) dataEnd -= 2;
    const data = buf.slice(pos, dataEnd);

    const headers = parseHeaders(headerStr);
    const cd = headers['content-disposition'] || '';
    const nameM = cd.match(/name="([^"]*)"/);
    const fnM = cd.match(/filename="([^"]*)"/);
    result.push({
      name: nameM ? nameM[1] : null,
      filename: fnM ? fnM[1] : null,
      contentType: (headers['content-type'] || '').split(';')[0].trim() || null,
      data,
    });

    pos = nextDelim + delim.length;
  }
  return result;
}

function parseHeaders(str) {
  const out = {};
  for (const line of str.split('\r\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    out[line.slice(0, i).toLowerCase().trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function extFromMime(mime) {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg': case 'image/jpg': return '.jpg';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'video/mp4': return '.mp4';
    case 'video/webm': return '.webm';
    case 'video/quicktime': return '.mov';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return '.xlsx';
    case 'application/vnd.ms-excel': return '.xls';
    case 'text/csv': return '.csv';
    default: return '';
  }
}

function mimeFromExt(ext) {
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mov': return 'video/quicktime';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls': return 'application/vnd.ms-excel';
    case '.csv': return 'text/csv';
    default: return null;
  }
}

// ---- 附件转 t2a-core message content（被 ws-server 调用） ----
// 输入：text + attachments[]，输出：t2a-core 可接受的 content（string 或 parts[]）
function buildContentFromAttachments(text, attachments, baseUrl) {
  const cfg = getConfig();
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return text || '';
  }

  let textParts = text || '';
  const imageParts = [];

  for (const att of attachments) {
    if (!att) continue;
    if (att.kind === 'image' && att.url) {
      imageParts.push({
        type: 'image_url',
        imageUrl: { url: absoluteUrl(att.url, cfg.baseUrl, baseUrl) },
      });
    } else if (att.kind === 'video' && att.url) {
      const abs = absoluteUrl(att.url, cfg.baseUrl, baseUrl);
      textParts += `\n\n[视频附件: ${att.filename || 'video'} @ ${abs}]`;
    } else if (att.kind === 'excel-text') {
      textParts += `\n\n[Excel附件: ${att.filename || 'sheet'}]\n${att.csv || ''}`;
    }
  }

  if (imageParts.length === 0) return textParts;
  const parts = [];
  if (textParts.trim()) parts.push({ type: 'text', text: textParts });
  parts.push(...imageParts);
  return parts;
}

function absoluteUrl(u, cfgBase, hostBase) {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  // 优先使用 hostBase（完整 http:// URL），保证返回绝对 URL（LLM 必需）
  // 注意：u 已经包含了存储时的路径前缀（如 /imagine/uploads/xxx），不要重复添加 cfgBase
  if (hostBase && /^https?:\/\//i.test(hostBase)) {
    return hostBase.replace(/\/+$/, '') + (u.startsWith('/') ? u : '/' + u);
  }
  if (cfgBase) return cfgBase.replace(/\/+$/, '') + (u.startsWith('/') ? u : '/' + u);
  if (hostBase) return hostBase.replace(/\/+$/, '') + (u.startsWith('/') ? u : '/' + u);
  return u;
}

module.exports = {
  handleUploadConfig,
  handleUpload,
  handleStaticUpload,
  buildContentFromAttachments,
  getConfig,
};
