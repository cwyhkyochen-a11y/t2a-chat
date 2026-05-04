# t2a-chat v0.2.0 — Task 抽象 + 宿主契约

## 目标
把 t2a-chat 从 "imagine-specific chat" 变成 "任何业务系统可接入的通用 chat 服务"。
核心：所有硬编码外提到宿主注入。

---

## P0 — 后端契约重构

### T1: Task Type Registry ✅→□
宿主通过 `createChatApp({ taskTypes })` 注册 task 类型。

```js
taskTypes: {
  image: {
    label: '图片生成',
    category: 'media',         // media | data | file
    models: [                   // 宿主提供枚举，t2a-chat 不硬编码
      { id: 'gpt-5.4-image-2', name: 'GPT-5.4 Image', capabilities: ['photo','illustration'] },
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro', capabilities: ['photo'] },
    ],
    defaultModel: 'gpt-5.4-image-2',
    paramsSchema: {             // 参数定义
      prompt: { type: 'text', required: true },
      negative_prompt: { type: 'text' },
      size: { type: 'select', options: ['1024x1024','1536x1024','1024x1536'] },
      reference_image: { type: 'image' },
    },
    create: async (params, ctx) => { /* 宿主实现 */ },
    cancel: async (taskId, ctx) => { /* 宿主实现 */ },
    getStatus: async (taskId, ctx) => { /* 宿主实现, 返回 { status, result, error } */ },
    render: 'image-card',       // 前端 renderer 名
  },
  video: { category: 'media', ... },
  form_short: {                 // 短数据操作（调API）
    category: 'data',
    label: '数据操作',
    paramsSchema: { /* 动态，由 LLM 定义 */ },
    create: async (params, ctx) => { /* 调业务API */ },
    ...
  },
  form_file: {                  // 长 form / 文件操作（Python 脚本等）
    category: 'file',
    label: '文件处理',
    supportsPython: true,       // 允许脚本执行
    create: async (params, ctx) => { /* 启动异步任务 */ },
    cancel: async (taskId, ctx) => { /* 中断脚本 */ },
    ...
  },
  text: { category: 'data', ... },
}
```

**Model routing 扩展点**：
```js
modelRouter: {
  // 按 task type 基础路由
  defaults: { image: 'gpt-5.4-image-2', video: 'seedance-2-0' },
  // 高级路由规则（v0.2.0 留接口，v0.3.0 实现）
  rules: [
    { match: { taskType: 'image', capabilities: ['photo'] }, prefer: 'gpt-5.4-image-2' },
    { match: { taskType: 'image', capabilities: ['illustration'] }, prefer: 'gemini-3-pro' },
  ]
}
```

**关键文件**：
- `src/task-registry.js` — 新增，注册/查询/校验
- `src/task-routes.js` — 新增，REST endpoints (create/cancel/status/list)
- `src/index.js` — createChatApp 接受新参数

### T2: Task Cancel + System Event □
- `POST /api/{basePath}/tasks/:id/cancel`
- 调宿主 `taskTypes[type].cancel(taskId, ctx)`
- 中断原任务，放弃回参
- 不中断 LLM 消息流
- 自动 push system_event: `{ source: 'task_cancelled', taskId, taskType, reason: 'user_cancelled' }`
- 前端 task 卡片状态变 'cancelled'

### T3: Model 枚举外提 □
- 删除所有硬编码 model name（seedance、gpt-image 等）
- `GET /api/{basePath}/models` → 聚合所有 taskTypes 的 models 返回
- `GET /api/{basePath}/models?taskType=image` → 按类型过滤
- Admin 设置"默认模型"时从宿主枚举选，不自由填写
- tools 里的 model 参数改为 enum 约束

### T4: Auth 重构（一刀切）□
```js
auth: {
  resolveUser: async (req) => {
    // 宿主从 req 提取用户（cookie/JWT/session/SSO）
    // 返回 { id, name, avatar?, role? } 或 null
  },
  // 可选：自定义登录页
  loginUrl: null,              // 字符串 → 重定向到宿主登录页
  // 可选：WebSocket 鉴权
  resolveWsUser: async (req) => { /* 默认走 resolveUser */ },
}
```
- 删除旧的 `auth: (password) => user`
- imagine 后续单独迭代适配

### T5: Sidebar Links □
```js
sidebarLinks: [
  { url: './', label: 'Image', icon: '<svg.../>' },
  { url: './video', label: 'Video', icon: '<svg.../>' },
]
```
- `GET /api/{basePath}/config/ui` → 返回 sidebarLinks + branding
- 默认空数组

---

## P1 — 前端拆分 + 插槽

### T6: chat.js 拆分 □
当前 576 行 → 拆成：
- `core.js` — 消息流、WS 管理、conversation CRUD、登录
- `task-renderer.js` — task 卡片注册表 + 默认 renderer
- `slots.js` — button / sidebar / config 插槽管理
- `chat.js` — 入口，组装 core + renderer + slots

### T7: 插槽系统 □
```js
// 宿主在 adapter 文件中注册
t2aChat.registerSlot('input-buttons', {
  id: 'upload-ref-image',
  icon: '<svg.../>',
  label: '上传参考图',
  onClick: (ctx) => { /* 宿主逻辑 */ },
});

t2aChat.registerTaskRenderer('image-card', {
  render: (task, container) => { /* 渲染图片预览卡片 */ },
  onUpdate: (task, container) => { /* task 状态更新时 */ },
});

t2aChat.registerTaskRenderer('video-card', { ... });

t2aChat.registerConfigPanel('image-providers', {
  label: 'Image Providers',
  fields: [...],
  onSave: async (values) => { ... },
});
```

### T8: imagine adapter 文件 □
- `adapters/imagine.js` — imagine 专属渲染/button/config
- imagine 的 chat.html 改为引用 t2a-chat 通用前端 + adapter

---

## P2 — 集成验证

### T9: imagine 切换 □
- imagine chat.html/css/js 删除，改引用 t2a-chat/public/
- imagine server.js 适配新 createChatApp 接口（auth/taskTypes/sidebarLinks）
- 全量功能验证（chat / tool call / task create / cancel / admin / sidebar links）

### T10: 文档更新 □
- README.md 重写（新 API 接口、adapter 编写指南）
- NOTES.md 总结

---

## 验证标准（封版条件）
- [ ] imagine 前端完全切到 t2a-chat 通用前端 + adapter
- [ ] imagine task 卡片（image/video）通过 registerTaskRenderer 渲染
- [ ] 至少一个自定义 button（上传参考图）通过 registerSlot 注入
- [ ] task cancel 触发 system_event，LLM 下一轮能感知
- [ ] model 枚举 100% 来自宿主，t2a-chat 内部零硬编码
- [ ] sidebar links 通过配置注入
- [ ] auth 走 resolveUser，imagine 适配新接口
- [ ] 所有原有功能不退化

---

## 技术约束
- sub-agent 模型：routetokens/claude-opus-4-6
- 保持原生 JS（不引入 React/Vue/Web Components）
- imagine 通过 sibling 引用 ../t2a-chat（不是 npm dep）
- 两个 git 仓库分开 commit
- 改动前先在 imagine 验证不退化
