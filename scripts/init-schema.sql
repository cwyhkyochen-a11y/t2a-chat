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

-- 通用 task 表（v0.2.0 新增）
-- 任意宿主注册的 task type 都通过此表持久化
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,                  -- task id（宿主可生成或由 t2a 自动生成）
  conversation_id INTEGER,              -- 关联会话（可空，用于全局任务）
  user_id INTEGER,                      -- 创建者
  type TEXT NOT NULL,                   -- task type key（image/video/form_short/form_file/text/...）
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | success | failed | cancelled
  params_json TEXT,                     -- 创建参数 JSON
  result_json TEXT,                     -- 结果 JSON（宿主回填）
  error TEXT,                           -- 失败原因
  model TEXT,                           -- 实际使用模型
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
