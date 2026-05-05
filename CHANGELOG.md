# Changelog - t2a-chat

## 0.7.0 (2026-05-06)

### Features
- Widget Mode: 嵌入式聊天气泡 SDK（`T2AWidget.init()`）
  - 右下角浮动按钮，点击展开 400x600 聊天面板
  - iframe 隔离，不影响宿主页面样式
  - 支持全屏按钮（新标签页打开）
  - 主题定制（颜色、气泡大小）
- Widget Compact Chat：iframe 内精简聊天页
  - 无侧边栏，最大化对话空间
  - Session 切换下拉
  - Task List 侧滑面板
  - Settings 侧滑面板
- `/widget/*` 静态路由自动挂载
- echo-bot example 新增 widget demo 宿主页

## v0.6.1 (2026-05-05) — Open source release
**首版开源 — npm @t2a/chat + GitHub repo**

### Repo & npm
- 包名改为 `@t2a/chat`（scoped 公开包，配套 `@t2a/core`）
- LICENSE (MIT)、.npmignore、repository / homepage / keywords 字段
- `examples/echo-bot/` — 30 行 minimal host，演示 adapter / Form Block / system_event push
- README 重写：kernel + runtime 生态叙事、Form Block hero、分层架构图、配置/API/Slot 完整文档

### Tools Tab + 通用 user-settings + 新标签外链
### 通用 user-settings 路由（架构下沉）
- 新增 `src/routes-user-settings.js`：`GET/PUT /api/{basePath}/user-settings`
- 根据 `taskRegistry.getTypeKeys()` 动态枚举，宕主不需自己实现
- PUT 只接受已注册 taskType 的 `default_${type}_model` 键
- 新 task type（如 audio）只要在 `taskTypes` 声明，偏好自动支持

### Tools Tab
- 新增 `src/routes-tools.js`：`GET /api/{basePath}/tools` 返回 `toolsMeta`
- 新增 `public/tools-panel.js`：独立可挂载模块 `window._t2aToolsPanel`
- 按 group 分组渲染 + tag pill 展示
- toolsMeta 由宕主在 createChatApp 传入

### sidebar-links 支持 target
- `slots.js _renderSidebarLinks` 支持 `item.target`
- `target=_blank` 自动补 `rel="noopener noreferrer"`

## v0.5.0 (2026-05-05)
**多模态附件系统**
- attachment-manager + upload-routes + WS attachments 协议
- chip SVG 图标 + input 对齐修复 + streaming 状态重置
- absoluteUrl 修复（LLM 必须绝对 URL）

## v0.4.0 (2026-05-05)
**Form Block 体系 — 结构化表单交互**

### 核心引擎
- form-block-parser: mini tokenizer + recursive parser（无 eval）
- form-renderer: render/collect/validate/markSubmitted/markStale
- form-submit: 事件委托 + 校验 + 序列化 [表单回复] 格式
- dom-helpers: sentinel-token 方案 + inferFormStates 历史回放
- chat.css: 三态样式 (unsubmitted/submitted/stale)

### 启用开关 + Prompt
- enableFormBlocks 配置项（宿主按需开关）
- system prompt 自动注入 form block 语法规格
- prompt 优化: select max / key 命名 / number max 语义

### Bug 修复 + 附录字段
- **fix**: form-submit.js 加载顺序（移到 core.js 之前）
- **feat**: SDK 自动追加「附加说明」textarea（方案 B，agent 不感知）

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
