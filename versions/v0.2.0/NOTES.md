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
