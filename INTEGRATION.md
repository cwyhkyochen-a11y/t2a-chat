# t2a-chat Integration Guide

宿主应用接入 t2a-chat 的完整参考。

## 最小接入（Headless，无前端 UI）

```js
const http = require('http');
const Database = require('better-sqlite3');
const { ToolRegistry } = require('@t2a/core');
const { createChatApp } = require('t2a-chat/src/index');
// 或 require('@t2a/chat') 如果从 npm 安装

const db = new Database('./data/chat.db');
db.pragma('journal_mode = WAL');

function createTools({ userId, conversationId, pushSystemEvent }) {
  const tools = new ToolRegistry();
  tools.register({
    schema: {
      name: 'my_tool',
      description: '工具描述',
      parameters: {
        type: 'object',
        properties: { arg1: { type: 'string', description: '参数说明' } },
        required: ['arg1'],
      },
    },
    handler: async (args) => {
      // args.arg1 已经过 JSON Schema 校验
      return { result: 'done' }; // 返回值会作为 tool_call 结果传给 LLM
    },
  });
  return tools;
}

const chat = createChatApp({
  db,
  auth: { resolveUser: async (req) => ({ id: 'user1', name: 'User' }) },
  tools: createTools,
  basePath: '/chat',
});

const server = http.createServer();
const { handleRequest } = chat.attachToServer(server);

server.on('request', async (req, res) => {
  const handled = await handleRequest(req, res);
  if (handled === false) { res.writeHead(404); res.end(); }
});

server.listen(4000);
```

## `createChatApp(options)` 完整参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `db` | better-sqlite3 实例 | ✅ | — | Chat 数据库（会话/消息/配置） |
| `auth` | object | ✅ | — | 鉴权配置，见下方 |
| `tools` | function | ❌ | — | `({ userId, conversationId, pushSystemEvent }) => ToolRegistry` |
| `adminAuth` | function | ❌ | — | `(req) => boolean`，管理 API 鉴权 |
| `basePath` | string | ❌ | `'/chat'` | HTTP + WS 路由前缀 |
| `adminBasePath` | string | ❌ | `'/chat-admin'` | 管理 API 路由前缀 |
| `taskTypes` | object | ❌ | `{}` | 宿主注册的任务类型 `{ key: { label, description } }` |
| `modelRouter` | object | ❌ | `{}` | LLM 模型配置，见下方 |
| `sidebarLinks` | array | ❌ | `[]` | `[{ url, label, icon }]` 侧边栏链接 |
| `branding` | object | ❌ | `{}` | `{ name?, logo?, primaryColor? }` |
| `enableFormBlocks` | boolean | ❌ | `false` | 是否在 system prompt 注入 form block 使用说明 |
| `toolsMeta` | array | ❌ | `[]` | 工具元数据（用于前端 Tools Tab 展示） |

### `auth` 对象

```ts
{
  resolveUser: async (req: IncomingMessage) => { id: string, name: string } | null,
  // WS 鉴权（可选，默认复用 resolveUser）
  resolveWsUser?: async (req: IncomingMessage) => { id: string, name: string } | null,
  loginUrl?: string, // 未认证时的跳转 URL
}
```

- `resolveUser` 从 HTTP 请求中提取用户（通常从 cookie/header 解析 JWT）
- 返回 `null` 表示未认证，t2a-chat 会返回 401
- WS 鉴权在 upgrade 阶段调用 `resolveWsUser`（未提供则 fallback 到 `resolveUser`）

### `modelRouter` 对象

```ts
{
  defaults: {
    baseUrl: string,      // LLM API base URL
    apiKey: string,       // API key
    model: string,        // 模型名
    systemPrompt: string, // 系统提示词
  },
  rules?: [              // 可选：按条件路由到不同模型
    { match: { userId?: string }, override: { model: string } }
  ]
}
```

- `defaults` 中的配置会作为所有 session 的默认 LLM 参数
- 用户可通过前端 UI 切换模型（存入 SQLite config 表）
- `systemPrompt` 直接注入到 LLM 对话第一条消息

## `attachToServer(server)` 返回值

```ts
const { wss, handleRequest, pushToConversation } = chat.attachToServer(server);
```

| 返回值 | 类型 | 说明 |
|--------|------|------|
| `wss` | WebSocket.Server | WS 实例，监听 `basePath + '/ws'` |
| `handleRequest` | `async (req, res) => boolean` | HTTP 请求处理器，返回 `false` 表示未匹配 |
| `pushToConversation` | `(conversationId, message) => void` | 向指定会话推送消息 |

### handleRequest 路由规则

以 `basePath = '/chat'` 为例：

| 路径 | 方法 | 说明 |
|------|------|------|
| `/chat/ws` | WS Upgrade | WebSocket 连接 |
| `/chat/widget/*` | GET | Widget 静态文件 |
| `/chat/uploads/*` | GET | 上传文件访问 |
| `/api/chat/tasks*` | GET/POST | 任务管理 |
| `/api/chat/models*` | GET | 模型列表 |
| `/api/chat/config/ui` | GET | UI 配置 |
| `/api/chat/conversations*` | GET/POST | 会话 CRUD |
| `/api/chat/messages*` | GET/POST | 消息读写 |
| `/api/chat/user-settings*` | GET/PUT | 用户设置 |

## Tools 注册格式

```ts
const { ToolRegistry } = require('@t2a/core');

function createTools({ userId, conversationId, pushSystemEvent }) {
  const tools = new ToolRegistry();

  tools.register({
    schema: {
      name: 'tool_name',           // 唯一标识
      description: '工具描述',      // LLM 看到的描述
      parameters: {                 // JSON Schema (OpenAI function calling 格式)
        type: 'object',
        properties: {
          arg1: { type: 'string', description: '参数描述' },
          arg2: { type: 'number' },
        },
        required: ['arg1'],
      },
    },
    handler: async (args) => {
      // args 是已解析的 JSON 对象
      // 返回值会 JSON.stringify 后作为 tool_call result 传给 LLM
      return { success: true, data: '...' };
    },
  });

  return tools;
}
```

### tools 工厂函数参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `userId` | string | 当前用户 ID（来自 `auth.resolveUser` 返回值） |
| `conversationId` | string | 当前会话 ID |
| `pushSystemEvent` | function | 推送系统事件到会话（异步通知/定时器等） |

### pushSystemEvent 用法

```ts
pushSystemEvent(conversationId, {
  source: 'my_system',          // 事件来源标识
  payload: { message: '...' },  // 事件数据
  triggerAgent: true,           // 是否触发 LLM 处理该事件
});
```

## WebSocket 协议

### 连接

```
ws://host:port/chat/ws
```

鉴权：通过 HTTP upgrade 请求的 cookie/header 鉴权（调用 `resolveWsUser`）

### 消息格式（客户端 → 服务端）

```json
{ "type": "join", "conversationId": "xxx" }
{ "type": "send", "conversationId": "xxx", "content": "hello", "attachments": [] }
{ "type": "cancel" }
```

### 消息格式（服务端 → 客户端）

```json
{ "type": "auth_ok", "user_id": "xxx" }
{ "type": "chunk", "content": "..." }
{ "type": "tool_call", "name": "xxx", "arguments": "..." }
{ "type": "tool_result", "name": "xxx", "result": "..." }
{ "type": "done", "messageId": "xxx" }
{ "type": "system_event", "source": "xxx", "payload": {} }
{ "type": "error", "message": "xxx" }
```

## 多 WS 共存

如果宿主已有其他 WebSocket 路径（如设备长连接），t2a-chat 的 WS handler 只处理 `basePath + '/ws'`，对其他路径 **不调用 socket.destroy()**，直接 return 让其他 handler 处理。

确保宿主的 upgrade handler 也只处理自己的路径：

```ts
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname === '/my-other-ws') {
    myWss.handleUpgrade(req, socket, head, (ws) => { ... });
    return;
  }
  // 不匹配的不要 destroy，让 t2a-chat handler 尝试
});
```

## 数据库

t2a-chat 使用独立的 better-sqlite3 数据库，**不影响宿主的主数据库**。

表结构由 t2a-chat 在首次运行时自动创建（`db-chat.js` / `db-config.js` / `db-chat-llm.js` 各有 init）。

存储内容：会话、消息、LLM 配置、用户设置。

## createChatApp 额外导出

```ts
const chat = createChatApp(options);

// 除 attachToServer 外的方法
chat.pushSystemEvent(conversationId, eventInput)  // 推送系统事件
chat.getSessionPool()                              // 获取 SessionPool 实例
chat.getTaskRegistry()                             // 获取 TaskRegistry 实例
chat.db.chat                                       // db-chat 模块
chat.db.llm                                        // db-chat-llm 模块
chat.db.config                                     // db-config 模块
```
