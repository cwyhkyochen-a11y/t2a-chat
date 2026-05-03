// 公共工具函数

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 10 * 1024 * 1024) { req.destroy(); return reject(new Error('Body too large')); } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonRes(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function checkAdminAuth(req, adminAuthFn) {
  if (!adminAuthFn) return false;
  return adminAuthFn(req);
}

module.exports = { readBody, jsonRes, checkAdminAuth };
