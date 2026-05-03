/**
 * Chat LLM Providers CRUD
 */
const { encrypt, decrypt, maskKey } = require('./crypto');

let db = null;

function init(dbInstance) {
  db = dbInstance;
}

function getChatLLMProviders() {
  const rows = db.prepare('SELECT * FROM chat_llm_providers ORDER BY priority ASC, id ASC').all();
  return rows.map(r => ({
    ...r,
    api_key: decrypt(r.api_key_encrypted) || '',
    api_key_masked: maskKey(decrypt(r.api_key_encrypted)),
  }));
}

function getChatLLMProvidersMasked() {
  const rows = db.prepare('SELECT * FROM chat_llm_providers ORDER BY priority ASC, id ASC').all();
  return rows.map(r => ({
    id: r.id, name: r.name, base_url: r.base_url, model: r.model,
    priority: r.priority, enabled: r.enabled, created_at: r.created_at,
    api_key_masked: maskKey(decrypt(r.api_key_encrypted)),
  }));
}

function getChatLLMProvider(id) {
  const r = db.prepare('SELECT * FROM chat_llm_providers WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, api_key: decrypt(r.api_key_encrypted) || '', api_key_masked: maskKey(decrypt(r.api_key_encrypted)) };
}

function createChatLLMProvider({ name, base_url, api_key, model, priority = 0 }) {
  const encrypted = encrypt(api_key);
  const result = db.prepare(
    'INSERT INTO chat_llm_providers (name, base_url, api_key_encrypted, model, priority) VALUES (?, ?, ?, ?, ?)'
  ).run(name, base_url, encrypted, model, priority);
  return result.lastInsertRowid;
}

function updateChatLLMProvider(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'api_key' && v) {
      sets.push('api_key_encrypted = ?');
      vals.push(encrypt(v));
    } else if (['name', 'base_url', 'model'].includes(k)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    } else if (k === 'priority') {
      sets.push('priority = ?');
      vals.push(Number(v));
    } else if (k === 'enabled') {
      sets.push('enabled = ?');
      vals.push(v ? 1 : 0);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE chat_llm_providers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function deleteChatLLMProvider(id) {
  db.prepare('DELETE FROM chat_llm_providers WHERE id = ?').run(id);
}

module.exports = {
  init,
  getChatLLMProviders,
  getChatLLMProvidersMasked,
  getChatLLMProvider,
  createChatLLMProvider,
  updateChatLLMProvider,
  deleteChatLLMProvider,
};
