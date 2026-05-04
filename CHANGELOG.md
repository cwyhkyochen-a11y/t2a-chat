# Changelog - t2a-chat

## v0.3.0 (2026-05-05)
**批次 2 — 视觉升级 + 性能优化 + 切换 session 体验**

### 视觉升级
- 俚语改 assistant 气泡 `.message.assistant.interlude`（斜体 + 浅米背景）
- system_event 升格一等公民：齿轮 SVG 头像 + `.message.system-msg` 浅蓝灰气泡
- imagine 任务卡片 badge 改 `.system-task-badge`

### 性能优化
- N+1 修复：getRequestsByIds 批量 IN 查询
- pollTasks 并行：Promise.all + per-task catch
- renderHistory 用 DocumentFragment（_renderBatchTarget 模块级游标）

### 切换 session 体验
- selectConversation 链路并行 + AbortController abort 旧 fetch
- conversation:switching 事件 + epoch token 竞态保护
- 加载动画：showMessagesLoading / task panel loading
- 选中态立即更新（不等 fetch 回来）
- tasksByConv Map 清理

### system_event 联动
- cancel task 触发 system_event，agent 主动感知
- contextUsage DOM 修复

## v0.2.0 (2026-05-04)
**Task 抽象 + 宿主契约 + 通用前端**

### P0 — 后端契约重构
- Task Type Registry：宿主通过 `createChatApp({ taskTypes })` 注册任务类型
- Task Cancel + System Event：取消任务自动推送 system_event
- Model 枚举外提：t2a-chat 内部零硬编码模型名
- Auth 重构：`auth.resolveUser` / `resolveWsUser` 宿主注入鉴权
- Sidebar Links + UI Config：`GET /api/chat/config/ui`

### P1 — 前端拆分 + 插槽系统
- chat.js 拆 5 文件：core.js / slots.js / task-renderer.js / dom-helpers.js / ws-manager.js
- 插槽系统：`registerSlot`（input-buttons / sidebar-links / welcome-suggestions / config-panels）
- `registerTaskRenderer` 覆盖默认 task 卡片
- `window.t2aChat` 公共 API 暴露

### P2 — imagine 集成验证
- Cookie-based auth（session token 替代密码 cookie）
- 前端事件钩子（tool:end / system:event / history:loaded / ready）

### 测试反馈修复
- 进入页面不再无条件连 WS（无 pw 直接显示登录浮层）
- Sidebar links 改横向 tab + active 高亮
- Settings modal 支持 config-panels 插槽渲染（loadConfigPanels / saveConfigPanels）
- Slash command palette：输入 `/` 弹命令面板，默认 `/compact` `/clear`
- `POST /api/chat/conversations/:id/compact` 接口
- WS + LLM 诊断日志（消息收发 / 调用耗时 / 30s 长等告警）

## v0.1.0 (2026-05-03)
- 核心 chat 服务：Session / EventBus / WebSocket / 流式 LLM
- /compact 上下文压缩
- Admin 后台 API
