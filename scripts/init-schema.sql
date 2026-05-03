-- t2a-chat schema

CREATE TABLE IF NOT EXISTS agent_config (
  id INTEGER PRIMARY KEY,
  name TEXT DEFAULT 'default',
  base_url TEXT,
  api_key TEXT,
  model TEXT,
  system_prompt TEXT,
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 4096,
  is_active INTEGER DEFAULT 1,
  overflow_strategy TEXT DEFAULT 'truncate',
  context_max_tokens INTEGER DEFAULT 80000,
  overflow_keep_last_n INTEGER DEFAULT 20,
  overflow_warning_ratio REAL DEFAULT 0.85,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO agent_config (id, name) VALUES (1, 'default');

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  token_count INTEGER,
  tool_calls TEXT,
  tool_call_id TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS t2a_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS t2a_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system_event','notice')),
  content TEXT,
  content_type TEXT DEFAULT 'text',
  tool_calls TEXT,
  tool_call_id TEXT,
  event_source TEXT,
  event_payload TEXT,
  event_default_response TEXT,
  event_trigger_agent INTEGER DEFAULT 0,
  notice_type TEXT,
  ephemeral INTEGER DEFAULT 0,
  interrupted INTEGER DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (session_id) REFERENCES t2a_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_t2a_messages_session ON t2a_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS chat_llm_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  model TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
