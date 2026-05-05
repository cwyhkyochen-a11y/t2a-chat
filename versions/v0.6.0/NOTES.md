# t2a-chat v0.6.0 — Tools Tab + 通用 user-settings + 新标签外链

## 完成内容

### 1. 通用 user-settings 路由（核心架构改进）
- 新增 `src/routes-user-settings.js`
  - `GET /api/{basePath}/user-settings` — 根据 taskRegistry.getTypeKeys() 动态返回所有 `default_${taskType}_model`
  - `PUT /api/{basePath}/user-settings` — 只接受已注册 taskType 的偏好键
- index.js 注册路由（在 toolsRouter 之后）
- **不再需要宿主自己实现 user-settings**，宿主只要在 `taskTypes` 声明 task type，偏好自动支持

### 2. Tools Tab 完整实现
- 新增 `src/routes-tools.js`
  - `GET /api/{basePath}/tools` — 返回 createChatApp({toolsMeta}) 注入的工具列表
  - 支持分组（group）+ 标签（tags）
- 新增 `public/tools-panel.js`
  - 独立可挂载模块：`window._t2aToolsPanel = { mount, refresh, setApiBase }`
  - 按 group 分组渲染 + tag pill 展示
  - CSS 内联注入，沿用项目 design token

### 3. sidebar-links 支持 target
- `slots.js _renderSidebarLinks` 支持 `item.target`
- target=_blank 自动加 `rel="noopener noreferrer"`

## 关键设计决策

### user-settings vs settings
- `/settings` 是 t2a-chat **全局**配置（admin 视角，含 api_key 过滤）
- `/user-settings` 是**用户**视角配置（按 taskType 命名约定 `default_${type}_model`）
- 两者都落到同一张 `settings` 表，但 user-settings 增加了 taskType allowlist（只允许已注册的 type 键写入，防止任意 key 注入）

### 宿主注入 vs t2a-chat 通用
- toolsMeta 是**宿主声明**（imagine 在 server.js 里写了 4 个工具）
- taskTypes 也是**宿主声明**（imagine: image / video）
- t2a-chat 提供通用 API，UI 自动渲染，不写死任何业务名字

## 文件清单
**新增**：
- src/routes-tools.js
- src/routes-user-settings.js
- public/tools-panel.js

**修改**：
- src/index.js（注册两个新路由）
- public/slots.js（sidebarLinks target 支持）

## 踩坑

### 1. settings 表共享
- imagine 把 `db._db` 传给 createChatApp，所以 imagine 的 `db.setting` 表和 t2a-chat 的 `dbConfig.setting` 表是**同一张表**
- 偏好键 `default_image_model` 一处写、多处读，工具调用时 imagine/tools.js 已经在用 `db.getSetting()`，自动生效，不用改 tool 代码

### 2. UTF-8 编辑陷阱（中转记录）
- 上一次 sub-agent 用 edit 工具改 chat.html 失败，是因为有全角括号 `（imagine 专属）`，多字节字符精确匹配出问题
- 解决：用 sed 行号替换避开

## 验证方式
- 本地：`grep "createUserSettingsRouter\|createToolsRouter" src/index.js`
- 线上：`curl https://kyochen.art/imagine/api/chat/tools` 应返回 4 个工具
- UI：Imagine chat 右侧 Task Panel 切到 Tools tab；左下角 Config 按钮打开 modal 改 model preference

## 后续版本规划
- v0.7.0: HEARTBEAT.md 记的 WS 重连加固（exponential backoff + ping-pong）+ Excel 前端解析
- v0.8.0: 抽象 `panelTabs` 配置项，让宿主声明任意 tab（不限于 Tasks/Tools）
