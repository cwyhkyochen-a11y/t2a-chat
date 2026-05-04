# t2a-chat v0.2.0 Notes

## 完成内容 (P0)

### T1: Task Type Registry ✅
- 新增 `src/task-registry.js` — TaskRegistry 类，负责 type 注册、DB CRUD、model 聚合
- 新增 `src/task-routes.js` — REST endpoints（create/list/get/cancel/models/config-ui）
- 新增 SQL 表 `tasks`（id TEXT PK, conversation_id, user_id, type, status, params_json, result_json, error, model, created_at, updated_at, cancelled_at）
- `createChatApp` 接受 `taskTypes` 配置，5 类任务通过宿主注入
- REST endpoints:
  - `POST /api/{basePath}/tasks` — 创建 task
  - `GET /api/{basePath}/tasks` — 列表查询
  - `GET /api/{basePath}/tasks/:id` — 详情（支持 getStatus 回调刷新）
  - `POST /api/{basePath}/tasks/:id/cancel` — 取消

### T2: Task Cancel + System Event ✅
- cancel 先调宿主 `taskTypes[type].cancel(taskId, ctx)` 回调
- 更新 DB status='cancelled', cancelled_at=now
- 自动 pushSystemEvent 到关联会话：`{ source: 'task_cancelled', payload: { taskId, taskType, reason: 'user_cancelled' } }`
- 不中断 LLM 消息流

### T3: Model 枚举外提 ✅
- 删除所有硬编码 model name（t2a-chat 内部零硬编码）
- `GET /api/{basePath}/models` → 聚合所有 taskTypes.models
- `GET /api/{basePath}/models?taskType=image` → 按类型过滤
- Admin `PUT /config` 时 model 字段验证必须来自枚举
- `modelRouter` 配置: defaults 部分生效（按 task type 查默认模型），rules 接口预留

### T4: Auth 重构 ✅（破坏性变更）
- 删除旧 `auth: (password) => user` 签名
- 新签名：`auth: { resolveUser: async (req) => user|null, loginUrl?, resolveWsUser? }`
- 所有 HTTP 路由通过 `ctx.resolveUser(req)` 鉴权
- WebSocket 改为 `noServer` 模式，HTTP upgrade 时调 `resolveWsUser` 鉴权
- 移除客户端 `auth` 消息流程，连接建立即鉴权成功
- resolveWsUser 默认 fallback 到 resolveUser

### T5: Sidebar Links + UI Config ✅
- `createChatApp` 接受 `sidebarLinks: [{ url, label, icon }]` + `branding: {...}`
- `GET /api/{basePath}/config/ui` → `{ sidebarLinks, branding }`
- 默认 sidebarLinks=[]

## 踩坑记录
- cancel 测试 race condition: 宿主 `create` 如果瞬间返回，task 已 success 时 cancel 会报 "already success"。设计上正确（已完成的不能取消），但测试时需要模拟慢任务。
- WebSocket `noServer` 模式需要宿主调 `attachToServer` 前不能监听 upgrade，改为在 initWebSocket 内部绑定到传入的 server。

## 破坏性变更
- `auth` 参数格式完全变更，旧的 `(password) => user` 不再支持
- WebSocket 不再接受客户端 `auth` 消息（连接时即完成鉴权）
- chat-routes 的所有接口不再读 `user_password` 参数

## 文件变更清单
- **修改**: src/index.js, src/chat-handler.js, src/chat-routes.js, src/admin-routes.js, src/ws-server.js, scripts/init-schema.sql
- **新增**: src/task-registry.js, src/task-routes.js, versions/v0.2.0/artifacts/smoke-test.js

## 未完成项（P1/P2）
- T6-T8: 前端拆分 + 插槽系统（由前端 sub-agent 负责）
- T9: imagine 适配（由另一个 sub-agent 负责）
- T10: README 重写（等 P1 完成后统一更新）
- modelRouter.rules 匹配逻辑（留 v0.3.0）

---

## P1 完成 — 前端拆分 + 插槽系统

### T6: chat.js 拆分 ✅
原始 576 行的 chat.js 拆成 5 个文件（实际比规划多 1 个 dom-helpers.js，因为 DOM 渲染辅助单独成模块更清晰）：

| 文件 | 行数 | 职责 |
|------|------|------|
| `slots.js` | 206 | 插槽注册表 + 事件总线 + 4 类 slot 渲染（input-buttons / sidebar-links / welcome-suggestions / config-panels）+ /config/ui 加载 |
| `task-renderer.js` | 303 | task 渲染器注册表 + 5 种默认 renderer（image-card / video-card / form-short-card / form-file-card / text-card） |
| `dom-helpers.js` | 227 | DOM 渲染（消息气泡、工具卡片、历史渲染、markdown、toast、SVG icons） |
| `core.js` | 380 | 鉴权、WS 管理、会话 CRUD、发送、流式控制、设置、API 辅助（cancelTask/createTask/getTaskStatus） |
| `chat.js` | 75 | 入口，组装并暴露 `window.t2aChat` |

每个文件 ≤ 400 行，组件职责单一。模块依赖：
```
ws-manager → slots → task-renderer → dom-helpers → core → chat
```

### T7: 插槽系统 ✅
全局 `window.t2aChat` 公共 API：

```js
window.t2aChat = {
  // task 渲染器
  registerTaskRenderer(name, { render, onUpdate, onCancel? }),

  // 插槽（4 类）
  registerSlot(slotName, item),
  // input-buttons:    { id, icon?, label?, onClick(ctx) }
  // sidebar-links:    { id, url, label, icon? }
  // welcome-suggestions: { id, text, onClick? }
  // config-panels:    { id, label, fields, onLoad?, onSave? }

  registerConfigPanel(id, { label, fields, onLoad, onSave }),

  // 业务 API
  api: { sendMessage(text,attachments?), cancelTask(taskId), createTask(type,params), getTaskStatus(taskId) },

  // 事件总线
  on(event, handler), off(event, handler), emit(event, data),
  // 内置事件: 'task:created' | 'task:cancelled' | 'task:cancel-request' | 'message:sent' | 'system:event' | 'suggestion:clicked' | 'slot:registered'

  // 旧 inline-onclick 兼容
  _internal: { selectConversation, deleteConversation, ... }
};
```

### chat.html 调整 ✅
- 引入 5 个 js 文件（按依赖顺序）
- input-row 加 `<div id="slot-input-buttons">` 容器
- sidebar-footer 加 `<div id="slot-sidebar-links">` 容器
- welcome 容器内置 `<div id="slot-welcome-suggestions">`（在 showWelcome 时动态注入）
- 删除写死的 Image / Video sidebar links（改由后端 config/ui + sidebarLinks 注入）
- 保留登录 overlay（视觉未做大改，后续如需简化再迭代）

### chat.css 新增样式
- `.input-slot-buttons .slot-btn` — 输入区按钮
- `.sidebar-links` — 侧栏链接容器
- `.welcome-suggestions .suggestion` — 欢迎页建议气泡
- `.task-card` 系列 — 5 种默认 task 卡片样式（含 badge / 取消按钮 / 进度条 / 缩略图占位）

### 鉴权适配
- 前端密码登录走 localStorage（保持现状）
- `connectWebSocket(pw)` 直接走 WS 鉴权（依赖后端 P0 已切换的 resolveUser，密码作为 cookie 或 query 由宿主自定）
- 宿主可通过自定义 sub-agent 的 loginUrl 配置重定向到 SSO（前端目前未集成跳转，留 P2）

### Smoke Test ✅
`versions/v0.2.0/artifacts/frontend-smoke.html` — 浏览器打开可看见所有 24 项检查通过。
也用 jsdom 在 Node 里跑过：

```
ALL PASSED (24 checks)
```

覆盖：window.t2aChat 全部 API + 5 种默认 renderer + 自定义 renderer 覆盖 + 4 类 slot + 事件订阅 + 全局函数兼容。

### 踩坑记录
1. **核心文件拆 4 个还是 5 个**：原计划 4 个（slots/task-renderer/core/chat），但 core.js 整合后近 700 行违反 ≤400 行约束。把 DOM 渲染辅助（appendBubble/markdown/toast/icon）单独抽成 dom-helpers.js，是符合"组件职责单一"原则的，最终落地 5 个文件 + ws-manager.js（不动）。
2. **insertBefore 顺序**：dom-helpers 必须在 core 前面、slots/task-renderer 在 core 前面（因为 core init 时会立即用到它们的 `_t2aSlots.on` 等）。
3. **showWelcome 重渲染插槽**：每次 newConversation 会清空 messages，welcome 内的 `slot-welcome-suggestions` 容器也消失。在 showWelcome 里重新触发 slots 渲染（通过 registerSlot 最后一项重发）兜底。
4. **inline onclick 全局兼容**：原 chat.html 用 `onclick="newConversation()"` 调全局函数。chat.js 入口除了暴露 `window.t2aChat`，还把所有方法挂到 `window` 顶层兼容旧 HTML 的 inline 调用。这降低了破坏面，宿主接入时 chat.html 不用大改。

### 未完成项
- 登录 overlay 视觉简化（PLAN 提到，本轮没做）
- 配置面板的实际管理后台 UI（registerConfigPanel 注册 API 已 ready，admin 页面渲染留 P2）
- imagine adapter 文件（T8 留给下一个 sub-agent 或 P2）
