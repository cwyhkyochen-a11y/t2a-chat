// agent_config + settings 读写

let db = null;

function init(dbInstance) { db = dbInstance; }

function getAgentConfig() {
  return db.prepare("SELECT * FROM agent_config WHERE is_active = 1 LIMIT 1").get() || null;
}

function updateAgentConfig(id, data) {
  const sets = [];
  const params = { id: Number(id) };
  const fields = ['name','base_url','api_key','model','system_prompt','temperature','max_tokens','is_active',
    'overflow_strategy','context_max_tokens','overflow_keep_last_n','overflow_warning_ratio'];
  for (const f of fields) {
    if (data[f] !== undefined) { sets.push(f + ' = @' + f); params[f] = data[f]; }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now','localtime')");
  return db.prepare('UPDATE agent_config SET ' + sets.join(', ') + ' WHERE id = @id').run(params);
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function getOverflowConfig() {
  const config = getAgentConfig();
  if (!config) return null;
  return {
    overflow_strategy: config.overflow_strategy || 'truncate',
    context_max_tokens: config.context_max_tokens || 80000,
    overflow_keep_last_n: config.overflow_keep_last_n || 20,
    overflow_warning_ratio: config.overflow_warning_ratio || 0.85,
  };
}

function updateOverflowConfig(data) {
  const sets = []; const vals = [];
  if (data.overflow_strategy !== undefined) { sets.push('overflow_strategy = ?'); vals.push(data.overflow_strategy); }
  if (data.context_max_tokens !== undefined) { sets.push('context_max_tokens = ?'); vals.push(Number(data.context_max_tokens)); }
  if (data.overflow_keep_last_n !== undefined) { sets.push('overflow_keep_last_n = ?'); vals.push(Number(data.overflow_keep_last_n)); }
  if (data.overflow_warning_ratio !== undefined) { sets.push('overflow_warning_ratio = ?'); vals.push(Number(data.overflow_warning_ratio)); }
  if (sets.length === 0) return;
  db.prepare('UPDATE agent_config SET ' + sets.join(', ') + ' WHERE id = 1').run(...vals);
}

module.exports = { init, getAgentConfig, updateAgentConfig, getSetting, setSetting, getAllSettings, getOverflowConfig, updateOverflowConfig };
