# t2a-chat

应用层 Chat 服务 — 基于 `@t2a/core` 的完整对话系统，可嵌入任何业务后台。

## 架构

```
@t2a/core (SDK) → t2a-chat (应用层) → 业务系统 (imagine/job-mdm/...)
```

## 快速开始

```bash
npm install
# 初始化数据库（在业务系统中执行 scripts/init-schema.sql）
npm run dev
```

## 接入方式

```js
const Database = require('better-sqlite3');
const http = require('http');
const { createChatApp } = require('t2a-chat');

const db = new Database('./data/app.db');
db.pragma('journal_mode = WAL');

// 执行建表
const fs = require('fs');
db.exec(fs.readFileSync('./node_modules/t2a-chat/scripts/init-schema.sql', 'utf8'));

const chat = createChatApp({
  db,
  auth: (password) => password === 'demo' ? { id: 1, name: 'demo' } : null,
  adminAuth: (req) => req.headers.authorization === 'Bearer admin-token',
  tools: ({ userId, conversationId, baseUrl }) => null,
  basePath: '/chat',
  adminBasePath: '/chat-admin',
});

const server = http.createServer(chat.handleRequest);
chat.attachToServer(server);
server.listen(3000, () => console.log('Chat running on :3000'));
```

## API 端点

### 用户侧
- `POST /api/{basePath}` — 创建/验证对话
- `POST /api/{basePath}/:id/interrupt` — 中断生成
- `GET /api/{basePath}/conversations` — 对话列表
- `POST /api/{basePath}/conversations` — 新建对话
- `GET /api/{basePath}/conversations/:id` — 对话详情
- `DELETE /api/{basePath}/conversations/:id` — 删除对话
- `GET /api/{basePath}/settings` — 读取设置
- `PUT /api/{basePath}/settings` — 更新设置

### 管理后台
- `GET/PUT /api/{adminBasePath}/config` — Agent 配置
- `GET/PUT /api/{adminBasePath}/overflow` — Overflow 配置
- `GET/PUT /api/{adminBasePath}/settings` — 通用设置
- `GET /api/{adminBasePath}/tools` — 工具列表
- `GET /api/{adminBasePath}/sessions` — 会话列表
- `GET /api/{adminBasePath}/sessions/:id` — 会话详情
- `DELETE /api/{adminBasePath}/sessions/:id` — 删除会话
- `CRUD /api/{adminBasePath}/llm-providers` — LLM Provider 管理

### WebSocket
- `ws://{host}/{basePath}/ws` — 实时对话通道

## Context Compression (Compact)

底层由 `@t2a/core` 的 `session.compact()` 驱动，t2a-chat 在以下时机触发：

1. **用户命令** — 发送 `/compact`（可配置 `compactCommand`），Session 拦截后立即执行
2. **自动触发** — 当 `onOverflow: 'summarize'` 配置下 context window 超限时自动压缩

### 机制

```
compact({ keepLastN: 20 })
│
├─ 1. 加载完整历史（t2a_messages WHERE deleted_at IS NULL）
├─ 2. 分割：前 N 条 → toCompact，后 keepLastN 条 → kept
├─ 3. 用 LLM 把 toCompact 总结为一段摘要文本
├─ 4. 原子操作（Storage.replaceRange）：
│      • 旧消息打 deleted_at = now（软删除，不物理删行）
│      • 插入 1 条 role=system_event, source='compact_summary' 摘要消息
└─ 5. 插入 notice 消息记录本次压缩事件
```

### 对 Admin / UI 的影响

- **Sessions 列表的 message_count** = `COUNT(*) FROM t2a_messages WHERE session_id = ? AND deleted_at IS NULL`，compact 后会减少
- **旧消息不丢失**：`deleted_at IS NOT NULL` 的行仍在数据库，可审计/恢复
- **Admin session detail** 默认只展示活跃消息（`deleted_at IS NULL`）

### 配置（通过 Admin /config 或 createChatApp options）

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `overflow_strategy` | `truncate` | `truncate` / `summarize` / `reject` |
| `context_max_tokens` | `80000` | 上下文最大 token 估算 |
| `overflow_keep_last_n` | `20` | compact 保留最近 N 条 |
| `overflow_warning_ratio` | `0.85` | 达到比例时 emit `overflow_warning` |

## License

MIT
