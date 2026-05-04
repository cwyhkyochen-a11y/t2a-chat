# 致下个 session 的 yoyo

你好。这封信是 2026-05-04 上午的我写给你的，kyo 转交。

## 上一阶段做了什么

t2a-chat **v0.1.0 封版完成**。从 imagine（img-gen-tool）提取的通用 chat 模块，第一次接入验证全通。

- imagine 已经切到 t2a-chat 后端（WebSocket + chat API + admin sessions）
- t2a-core v0.6.1 也推到 GitHub 了
- 两个仓库都 git tag 完成

具体见 `versions/v0.1.0/NOTES.md` 和 `README.md` 的 Compact 章节。

## 当前任务：t2a-chat 改造

kyo 给的方向（按优先级排）：

### 1. UI 封装 + 自定义 button

t2a-chat 的 `public/` 下有通用版前端（chat.html / chat.css / chat.js），但 imagine 现在还在用自己的前端（带任务卡片渲染、图片预览等业务逻辑），没切过去。

需要做的：
- 把 t2a-chat 前端组件化，UI 部分能被宿主"插槽"扩展
- 自定义 button：宿主能往输入框旁边塞自己的按钮（比如 imagine 的"上传参考图"）
- 卡片渲染器：tool result 的展示交给宿主（imagine 渲染图片预览，job-mdm 可能渲染岗位卡片）

### 2. Config 模块

admin 后台的 config 现在是 hardcode 的（agent_config / overflow / settings / llm-providers），需要：
- 让宿主能注册自定义配置项（比如 imagine 的图片 provider 绑定）
- config 面板支持动态字段定义

### 3. 第二个 adapter 验证

如果时间够，可以试试接 job-mdm 或 store-content-arch 的 chat 入口，验证抽象的合理性。

## 你需要读的文件

启动时按这个顺序：

1. `projects/t2a-chat/README.md` — 整体架构 + API + Compact 机制
2. `projects/t2a-chat/versions/v0.1.0/NOTES.md` — v0.1.0 完成内容和已知限制
3. `projects/t2a-chat/src/index.js` — 现有 createChatApp 接口
4. `projects/img-gen-tool/server.js` — 看 imagine 怎么接入的（参考 systemEventTemplate / tools 工厂的注入方式）
5. `projects/img-gen-tool/public/chat.html` + `chat.js` — 现有的业务前端（要抽象的对象）
6. `projects/t2a-chat/public/chat.html` — 通用版前端（要扩展的基线）

## 注意事项

- imagine 通过 sibling 引用 `../t2a-chat`（不是 npm dep），改 t2a-chat 时 imagine 自动生效
- imagine 和 t2a-chat 是两个 git 仓库，commit 时各自分开
- 部署：`projects/img-gen-tool/deploy.sh` 已经包含 t2a-chat 同步（rsync 到 `/opt/t2a-chat/`）
- 改动前先开新版本：`mkdir versions/v0.2.0 && touch versions/v0.2.0/{PLAN.md,NOTES.md}`，写明清单再动手
- **sub-agent 模型用 `routetokens/claude-opus-4-6`**

## 踩坑提醒

- t2a-chat 的 `messages` 表已废弃，所有消息在 `t2a_messages`（@t2a/core 的 SQLiteStorage）。任何统计/查询都要 `WHERE deleted_at IS NULL` 过滤软删消息
- imagine 自己的 `src/db-chat.js` 还有一份 admin sessions 查询逻辑（独立于 t2a-chat 的 admin-routes），改 t2a-chat 时记得 imagine 那边可能也要同步改
- WebSocket 路径是 `basePath + '/ws'`，改 basePath 时前端 `ws-manager.js` 要同步改

## 验证标准（封版 v0.2.0 时）

- imagine 前端切到 t2a-chat 通用前端 + 自定义插槽
- imagine 任务卡片通过插槽渲染
- 至少一个自定义 button 通过 props 注入
- 所有原有功能不退化（chat / 工具调用 / 任务回调 / admin）

祝顺利。

— yoyo (t2a-chat v0.1.0 封版 session, 2026-05-04 上午)
