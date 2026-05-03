// t2a-chat Storage：复用业务系统的 better-sqlite3 实例
// 用 @t2a/core 的 SQLiteStorage
//
// 表名：t2a_sessions / t2a_messages

const { SQLiteStorage } = require('@t2a/core');

let db = null;
let storage = null;

function init(dbInstance) {
  db = dbInstance;
  storage = new SQLiteStorage({
    db,
    tableNames: { sessions: 't2a_sessions', messages: 't2a_messages' },
  });

  // ---- base64 sanity check ----
  function _containsBase64(s) {
    return typeof s === 'string' && s.indexOf('data:image/') !== -1 && /data:image\/[^;]+;base64,/.test(s);
  }
  function assertNoBase64(message) {
    if (!message || message.content == null) return;
    const c = message.content;
    if (typeof c === 'string') {
      if (_containsBase64(c)) {
        console.error('[storage] 契约违反：message.content 含 data:image/ base64， role=' + message.role);
        throw new Error('[storage] message.content contains base64 data URI —— 上游必须先落盘转 URL。role=' + message.role);
      }
      return;
    }
    if (Array.isArray(c)) {
      for (const p of c) {
        if (!p) continue;
        if (typeof p === 'string' && _containsBase64(p)) { throw new Error('[storage] content array 含 base64'); }
        if (p.text && _containsBase64(p.text)) { throw new Error('[storage] content.text 含 base64'); }
        const url = p.image_url && (typeof p.image_url === 'string' ? p.image_url : p.image_url.url);
        const urlCamel = p.imageUrl && (typeof p.imageUrl === 'string' ? p.imageUrl : p.imageUrl.url);
        if (url && url.startsWith('data:')) { throw new Error('[storage] image_url must not be data: URI'); }
        if (urlCamel && urlCamel.startsWith('data:')) { throw new Error('[storage] imageUrl must not be data: URI'); }
      }
    }
  }

  // 包裹原方法
  const _origAppendMessage = storage.appendMessage.bind(storage);
  storage.appendMessage = function (sessionId, msg) {
    assertNoBase64(msg);
    return _origAppendMessage(sessionId, msg);
  };
}

function getStorage() { return storage; }
function getDb() { return db; }

module.exports = { init, getStorage, getDb };
