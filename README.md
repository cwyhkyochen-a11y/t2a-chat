# t2a-chat

> `@t2a/chat` · **Talk-to-Action Chat Runtime** — the official UI/runtime layer for [`@t2a/core`](https://github.com/cwyhkyochen-a11y/t2a-core)

<p align="left">
  <a href="https://github.com/cwyhkyochen-a11y/t2a-chat/releases"><img alt="version" src="https://img.shields.io/badge/version-v0.6.1-blue"></a>
  <a href="https://www.npmjs.com/package/@t2a/chat"><img alt="npm" src="https://img.shields.io/badge/npm-%40t2a%2Fchat-cb3837"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="kernel" src="https://img.shields.io/badge/built%20on-%40t2a%2Fcore-blueviolet">
</p>

---

## What is t2a-chat?

`@t2a/core` ships the **kernel** — a TypeScript SDK that models LLM conversations as a group chat between Human, AI, and Systems.

`@t2a/chat` ships the **runtime** — a drop-in WebSocket chat server + frontend that turns the kernel into something users can actually talk to.

```
@t2a/core  (kernel)        →  conversation engine
   ↓
@t2a/chat  (runtime)       →  WebSocket + HTTP + DB + frontend + admin
   ↓
your business app          →  write an adapter, get a chat product
```

You write an **adapter** (auth + tools + task types). The runtime gives you:

- WebSocket streaming with three-role messages (`user` / `assistant` / `system_event`)
- Multi-conversation persistence (SQLite, swappable)
- Tool call rendering, partial-output interruption, `/compact` command, multi-LLM fallback
- **Native interactive forms** — the LLM emits a `[form]` block, the user fills it, the answer flows back into the conversation
- Multi-modal attachments (images / files), drag-and-drop, paste-from-clipboard
- A Slot system to inject your own UI (sidebar links, input buttons, welcome suggestions, config panels)
- An admin backend for sessions, providers, overflow policy, and tool inspection

## Why a runtime, not just another chat UI?

Existing chat UIs (deep-chat, librechat, vercel/ai chat-ui) ship a **monolithic** experience: they own the whole stack and you bend their app to your business.

`t2a-chat` flips it: **you own the business, the runtime stays out of your way.**

| | t2a-chat | Typical chat UI libraries |
|---|---|---|
| **Mental model** | Adapter — host declares auth/tools/taskTypes, runtime wires the rest | Monolithic app — fork & customize |
| **Backend** | Embedded in your Node app (`createChatApp` factory) | Separate service or BYO backend |
| **Conversation engine** | `@t2a/core` (group chat with system_event role) | Plain user/assistant turns |
| **Async system events** | First-class — tools push `system_event` after the turn ends, AI reacts without user input | None — must poll or fake another user message |
| **Interactive forms** | **Native** — LLM emits `[form]` block, runtime renders/validates/serializes | DIY in app code |
| **Slot system** | Inject UI in 4 mount points without forking | Fork the repo |
| **DB** | Bring your own `better-sqlite3` instance | Hidden / proprietary |
| **LLM fallback** | Multi-provider via `@t2a/core` | Single provider |
| **Admin** | Built-in backend (sessions / providers / overflow / tools) | None |

## ✨ Hero feature: Native Interactive Forms

This is the killer.

The LLM doesn't need a special "form tool". It just emits a fenced block in plain text:

````
[form]
text(name, label="Your name", required=true)
select(plan, label="Plan", options=["Free","Pro","Team"])
number(seats, label="Seats", min=1, max=100)
[/form]
````

`@t2a/chat` parses, renders, validates, and tracks the three-state lifecycle:

- **unsubmitted** — interactive, user can fill
- **submitted** — answers persist as a `[表单回复]` user message; the form snapshots
- **stale** — when conversation context shifts, old forms grey out

No tool registration. No frontend code. No prompt gymnastics. The LLM just learned a new syntax and you got a structured-data round-trip for free.

This works because `@t2a/chat` injects a tiny grammar spec into the system prompt when `enableFormBlocks: true` is set, and the parser is a hand-written tokenizer (no `eval`).

> **Why this matters:** every framework has tool calling. Almost none let the *AI* hand the *user* a typed UI control. This is the cleanest path from "chat" to "actionable software" we've found.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser                               │
│   ┌───────────────────────────────────────────────────┐     │
│   │  Slot system     Task renderers    Form blocks    │     │
│   │  Multi-modal     /compact UI       Tool cards     │     │
│   └────────────────────┬──────────────────────────────┘     │
└────────────────────────┼────────────────────────────────────┘
                         │ WebSocket + HTTP
┌────────────────────────┴────────────────────────────────────┐
│                     @t2a/chat                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ HTTP routes  │  │ WS server    │  │ Session pool     │   │
│  │ chat-routes  │  │ ws-server    │  │ task-registry    │   │
│  │ admin-routes │  │ form-block   │  │ upload-routes    │   │
│  └──────────────┘  └──────┬───────┘  └──────────────────┘   │
└────────────────────────────┼────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                     @t2a/core (kernel)                      │
│  Session · EventBus · AgentLoop · Storage · LLMClient       │
│  Three-role messages · system_event · /compact · interrupt  │
└─────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│              Your business adapter (≈ 30 lines)             │
│  auth.resolveUser   tools(ctx)   taskTypes   sidebarLinks   │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npm install @t2a/core @t2a/chat better-sqlite3
```

```js
const http = require('http');
const Database = require('better-sqlite3');
const { ToolRegistry } = require('@t2a/core');
const { createChatApp } = require('@t2a/chat');

const db = new Database('./data/app.db');
db.pragma('journal_mode = WAL');

const chat = createChatApp({
  db,

  // Adapter: auth
  auth: {
    resolveUser: async (req) => {
      const pw = req.headers['x-password'];
      return pw === 'demo' ? { id: 1, name: 'demo' } : null;
    },
  },

  // Adapter: admin gate
  adminAuth: (req) => req.headers.authorization === 'Bearer admin-token',

  // Adapter: tools (per-conversation context)
  tools: ({ userId, conversationId, pushSystemEvent }) => {
    const t = new ToolRegistry();
    t.register({
      schema: { name: 'echo', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
      handler: async ({ text }) => ({ ok: true, echo: text }),
    });
    return t;
  },

  // Optional: interactive forms
  enableFormBlocks: true,

  // Optional: surface task panel for the host
  taskTypes: {
    image: { label: 'Image generation', description: 'Render images' },
  },

  basePath: '/chat',
  adminBasePath: '/chat-admin',
});

const server = http.createServer(chat.handleRequest);
chat.attachToServer(server);
server.listen(3000, () => console.log('http://localhost:3000/chat'));
```

That's the full integration. `examples/echo-bot/` is a runnable copy.

## Slot System

Inject UI without forking the runtime:

```js
window.t2aChat.registerSlot('input-buttons', (ctx) => `
  <button onclick="alert('hi')">My button</button>
`);

window.t2aChat.registerSlot('sidebar-links', () => [
  { url: '/admin', label: 'Admin', icon: '⚙️' },
]);

window.t2aChat.registerSlot('welcome-suggestions', () => [
  'Generate a logo', 'Summarize my notes',
]);

window.t2aChat.registerSlot('config-panels', () => /* JSX-like spec */);
```

Custom task card renderer:

```js
window.t2aChat.registerTaskRenderer('image', (task) => `
  <div class="task-card">
    <img src="${task.result_url}" />
    <span>${task.status}</span>
  </div>
`);
```

## Capabilities

- **WebSocket streaming** — token-by-token assistant output, tool start/end events, partial output preserved on interrupt
- **Three-role messages** — `user`, `assistant`, `system_event` rendered with distinct affordances; `system_event` gets its own SVG-avatar bubble
- **Form Block** — declarative interactive forms (text / number / select / checkbox / date) with three-state lifecycle and history replay
- **Multi-modal attachments** — drag/drop/paste images and files; absolute URLs forwarded to the LLM; chip UI with SVG icons
- **Slash commands** — `/compact`, `/clear`, host-extensible palette
- **Slot system** — `input-buttons` / `sidebar-links` / `welcome-suggestions` / `config-panels`
- **Task panel** — host-defined task types render as live status cards (cancellable; cancel emits a `system_event`)
- **Tools tab** — host's `toolsMeta` rendered as inspectable tool list
- **Admin backend** — sessions, LLM providers (encrypted at rest), overflow policy, `tools/*` inspection, per-user settings
- **User settings** — `default_${taskType}_model` dynamically enumerated from `taskRegistry`; new task type = automatic preference support
- **Multi-LLM fallback** — inherited from `@t2a/core` (timeout-based provider switching)
- **Context compression** — `/compact` (manual) or `onOverflow: 'summarize'` (automatic), powered by `@t2a/core`'s `session.compact()`

## Configuration reference

| Option | Type | Default | Description |
|---|---|---|---|
| `db` | `Database` | required | `better-sqlite3` instance |
| `auth.resolveUser` | `(req) ⇒ user \| null` | required | Resolve user from HTTP request |
| `auth.resolveWsUser` | `(req) ⇒ user \| null` | falls back to `resolveUser` | Resolve user from WS upgrade |
| `auth.loginUrl` | `string` | `null` | Where the frontend redirects on 401 |
| `adminAuth` | `(req) ⇒ boolean` | required for admin | Admin gate |
| `tools` | `(ctx) ⇒ ToolRegistry` | required | Per-conversation tools; `ctx` includes `userId`, `conversationId`, `baseUrl`, `pushSystemEvent` |
| `taskTypes` | `Record<string, TaskTypeDef>` | `{}` | Host-declared task types; drive the task panel and `default_${type}_model` settings |
| `modelRouter` | `{ defaults, rules }` | `{}` | Pick model per task type / context |
| `sidebarLinks` | `Array<{url,label,icon,target?}>` | `[]` | Top sidebar nav; `target=_blank` auto-adds `rel="noopener"` |
| `branding` | `{name?, logo?, primaryColor?}` | `{}` | Header/branding |
| `enableFormBlocks` | `boolean` | `false` | Inject Form Block grammar into the system prompt |
| `toolsMeta` | `ToolMetaEntry[]` | `[]` | Surface tool list in the Tools tab |
| `systemEventTemplate` | `(evt) ⇒ string` | built-in | Customize how `system_event` becomes a user-prefixed message at the LLM boundary |
| `basePath` | `string` | `/chat` | HTTP/WS base path |
| `adminBasePath` | `string` | `/chat-admin` | Admin base path |

## API Endpoints

### User
- `POST /api/{basePath}` — create / verify conversation
- `POST /api/{basePath}/:id/interrupt` — interrupt current generation
- `GET / POST / DELETE /api/{basePath}/conversations[/...]` — conversation CRUD
- `GET / PUT /api/{basePath}/settings` — session settings
- `GET / PUT /api/{basePath}/user-settings` — per-user `default_${taskType}_model` (dynamic)
- `GET /api/{basePath}/tools` — host tool metadata
- `POST /api/{basePath}/conversations/:id/compact` — trigger `/compact`
- `POST /api/{basePath}/upload` — multi-modal attachment upload

### Admin
- `GET / PUT /api/{adminBasePath}/config` — agent config
- `GET / PUT /api/{adminBasePath}/overflow` — overflow policy
- `GET / PUT /api/{adminBasePath}/settings` — global settings
- `GET /api/{adminBasePath}/tools` — registered tools
- `GET / DELETE /api/{adminBasePath}/sessions[/...]` — sessions inspection
- CRUD `/api/{adminBasePath}/llm-providers` — LLM provider management (encrypted at rest)

### WebSocket
- `ws://{host}/api/{basePath}/ws` — streaming channel; messages typed (`user_message` / `text` / `tool_start` / `tool_end` / `system_event` / `done` / ...)

## Database

`@t2a/chat` ships an `init-schema.sql` (`scripts/init-schema.sql`). On first `createChatApp(...)` it runs the schema if your DB is empty. You own the file/path/journal mode.

Tables created (prefix `t2a_`):

- `t2a_messages` — three-role timeline (`deleted_at` for soft-delete after `/compact`)
- `t2a_conversations` — user-scoped conversation list
- `t2a_sessions` — per-conversation Session state
- `t2a_tasks` — registered tasks (host-typed)
- `t2a_user_settings` — `default_${taskType}_model` etc.
- `t2a_settings` — admin-managed overflow / compact / agent config
- `t2a_llm_providers` — encrypted provider credentials

`SQLiteStorage` from `@t2a/core` is what backs the message timeline; everything else is t2a-chat owned.

## Recipes

### Push a system event from outside
```js
chat.pushSystemEvent(conversationId, {
  source: 'webhook',
  payload: { event: 'order.paid', orderId: '12345' },
  triggerAgent: true,
});
```

### Override the LLM-boundary system_event template
```js
createChatApp({
  systemEventTemplate: (evt) =>
    `[${evt.source}] ${JSON.stringify(evt.payload)}`,
});
```

### Cookie auth instead of header
```js
auth: {
  resolveUser: async (req) => {
    const token = parseCookie(req.headers.cookie)?.session;
    return tokens.verify(token); // your own
  },
},
```

## Widget Mode（嵌入式聊天气泡）

右下角浮动气泡，点击展开 iframe 聊天面板。适合嵌入现有系统，与宿主页面样式隔离。

详细集成指南见 [WIDGET.md](./WIDGET.md)。

### 快速接入

```html
<script src="https://your-host.com/chat/widget/t2a-widget.js"></script>
<script>
  T2AWidget.init({
    endpoint: 'https://your-host.com/chat',
    token: 'user-jwt-token',
    title: 'Support',
    theme: { primaryColor: '#4F46E5' },
  });
</script>
```

### 配置项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `endpoint` | `string` | 必填 | t2a-chat 后端地址（含 basePath） |
| `token` | `string` | 必填 | Bearer token，传入 iframe URL |
| `position` | `'bottom-right'\|'bottom-left'` | `'bottom-right'` | 气泡位置 |
| `theme` | `object` | `{}` | 主题配置（primaryColor, bubbleSize） |
| `title` | `string` | `'Chat'` | 面板标题 |
| `fullscreenUrl` | `string\|null` | `null` | 全屏按钮跳转地址 |

### API 方法

```js
T2AWidget.init(config)   // 初始化
T2AWidget.open()         // 展开面板
T2AWidget.close()        // 收起面板
T2AWidget.toggle()       // 切换
T2AWidget.destroy()      // 销毁实例
```

### 后端集成

无需额外配置。`createChatApp()` 自动挂载 `/widget/*` 静态路由，提供 compact chat 页面和 SDK 文件。

> ⚠️ WebSocket 路径当前硬编码为 `/chat/ws`。如果 `basePath` 不是 `/chat`，需在 compact chat 页面调整 WS 地址。

## Roadmap

- [ ] Tool call inspector (live tool args / results in admin)
- [ ] Voice input (Whisper / 火山 ASR adapter)
- [ ] Excel attachment client-side parsing (XLSX.js)
- [ ] WS reconnect hardening
- [ ] React component wrapper (instead of vanilla JS frontend)
- [ ] Widget: postMessage 通信、unread badge、basePath 参数化

## Versioning

Major-zero series; semver follows `@t2a/core`. See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT — see [LICENSE](./LICENSE).
