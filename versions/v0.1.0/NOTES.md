# t2a-chat v0.1.0 Notes

## 完成内容
从 imagine 提取的通用 chat 模块，首次接入验证通过。

### 核心模块
- `src/index.js` — createChatApp 主入口，返回 { attachToServer, pushSystemEvent, getSessionPool, pushToConversation }
- `src/session-pool.js` — LRU Session 缓存（max 200），多 LLM fallback + overflow 配置
- `src/ws-server.js` — WebSocket 认证 + subscribe + send + interrupt + 事件绑定
- `src/chat-handler.js` — POST /api/chat 对话创建/验证
- `src/chat-routes.js` — 非流式 CRUD 接口（conversations / settings）
- `src/admin-routes.js` — 管理后台全接口（config / overflow / sessions / llm-providers）
- `src/db-chat.js` — conversations + messages CRUD
- `src/db-chat-llm.js` — LLM providers 管理（加密存储 API key）
- `src/db-config.js` — agent_config + settings 管理
- `src/storage.js` — @t2a/core SQLiteStorage 封装（t2a_sessions + t2a_messages）
- `scripts/init-schema.sql` — CREATE TABLE IF NOT EXISTS 建表

### 首个验证 adapter
- imagine (img-gen-tool) v2.7.2+ 接入
- WebSocket 认证 + 流式对话 + 工具调用 + task-callback pushSystemEvent 全通

### 关键设计决策
- basePath 可配置（默认 /chat），WS 路径 = basePath + '/ws'
- adminAuth 由宿主注入（Basic auth / JWT / 任意）
- tools 由宿主工厂函数提供，每个 session 独立构建
- systemEventTemplate 可选覆盖（imagine 用于自定义任务完成渲染）
- pushToConversation 通过 attachToServer 返回值暴露（不穿透内部模块）

### 已知限制
- 前端通用 UI（public/）未接入验证（imagine 暂时用自己的前端）
- 无 npm 发布（sibling 引用 `../t2a-chat`）
- 无单元测试

## 下个版本方向
- UI 组件化（自定义 button / 卡片插槽 / config 面板）
- npm 包化 or monorepo 整合
- 第二个 adapter（job-mdm 或 store-content-arch）
