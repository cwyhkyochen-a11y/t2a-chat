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
- `ws://{host}/ws/chat` — 实时对话通道

## License

MIT
