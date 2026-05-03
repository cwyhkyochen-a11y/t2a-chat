/**
 * Agent Chat CRUD + Admin Sessions
 */

let db = null;

function init(dbInstance) {
  db = dbInstance;
}

// ---- Conversations ----
function createConversation(userId, title) {
  const result = db.prepare("INSERT INTO conversations (user_id, title) VALUES (@userId, @title)").run({
    userId: Number(userId), title: title || null
  });
  return result.lastInsertRowid;
}

function getConversations(userId) {
  return db.prepare(`
    SELECT c.*,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM conversations c
    WHERE c.user_id = @userId
    ORDER BY c.updated_at DESC
  `).all({ userId: Number(userId) });
}

function getConversation(id) {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) || null;
}

function deleteConversation(id) {
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  return db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

// ---- Messages ----
function addMessage({ conversation_id, role, content, token_count, tool_calls, tool_call_id }) {
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, role, content, token_count, tool_calls, tool_call_id)
    VALUES (@conversation_id, @role, @content, @token_count, @tool_calls, @tool_call_id)
  `).run({
    conversation_id: Number(conversation_id), role, content,
    token_count: token_count || null, tool_calls: tool_calls || null, tool_call_id: tool_call_id || null
  });
  db.prepare("UPDATE conversations SET updated_at = datetime('now','localtime') WHERE id = ?").run(conversation_id);
  return result.lastInsertRowid;
}

function getMessages(conversationId) {
  return db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversationId);
}

function getConversationTokenCount(conversationId) {
  const row = db.prepare("SELECT COALESCE(SUM(token_count), 0) as total FROM messages WHERE conversation_id = ? AND token_count IS NOT NULL").get(conversationId);
  return row ? row.total : 0;
}

// ---- Admin Sessions ----
function getAdminSessions({ page = 1, pageSize = 20 } = {}) {
  const offset = (page - 1) * pageSize;
  const countRow = db.prepare('SELECT COUNT(*) as total FROM conversations').get();
  const rows = db.prepare(`
    SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
    FROM conversations c
    ORDER BY c.updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ limit: pageSize, offset });
  return { total: countRow.total, page, pageSize, data: rows.map(r => ({
    ...r,
    last_message_at: r.updated_at,
  })) };
}

function getAdminSessionDetail(id) {
  const conv = db.prepare(`
    SELECT * FROM conversations WHERE id = ?
  `).get(id);
  if (!conv) return null;
  const messages = db.prepare(`
    SELECT id, role, content, token_count, created_at
    FROM messages WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(id);
  return { ...conv, messages };
}

module.exports = {
  init,
  createConversation,
  getConversations,
  getConversation,
  deleteConversation,
  addMessage,
  getMessages,
  getConversationTokenCount,
  getAdminSessions,
  getAdminSessionDetail,
};
