# Widget Mode — 嵌入式聊天集成指南

## 概述

Widget Mode 让你在任意网页右下角嵌入一个聊天气泡。用户点击气泡展开 iframe 聊天面板，与 t2a-chat 后端通信。iframe 隔离保证不污染宿主页面样式。

### 架构

```
┌─────────────────────────────────────────────┐
│  宿主页面（你的应用）                         │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  t2a-widget.js (SDK)                │    │
│  │  - 渲染气泡按钮                      │    │
│  │  - 创建/销毁 iframe                  │    │
│  └──────────────┬──────────────────────┘    │
└─────────────────┼───────────────────────────┘
                  │ iframe src
┌─────────────────┴───────────────────────────┐
│  /widget/index.html (Compact Chat)          │
│  - 精简聊天 UI（无侧边栏）                    │
│  - 通过 URL 参数获取 token                   │
│  - HTTP + WebSocket → t2a-chat 后端          │
└─────────────────────────────────────────────┘
```

## 前端接入（3 步）

### 1. 引入 SDK

```html
<script src="https://your-host.com/chat/widget/t2a-widget.js"></script>
```

SDK 文件由 t2a-chat 后端自动提供（`/widget/t2a-widget.js`）。

### 2. 初始化

```html
<script>
  T2AWidget.init({
    endpoint: 'https://your-host.com/chat',
    token: 'your-user-jwt-token',
    title: 'AI 助手',
    position: 'bottom-right',
    theme: {
      primaryColor: '#4F46E5',
      bubbleSize: 56,
    },
    fullscreenUrl: 'https://your-host.com/chat',
  });
</script>
```

### 3. 完成

页面右下角出现气泡按钮，点击展开 400×600 聊天面板。

## 后端接入

**无需额外配置。** 只要你的 Node 应用已经调用了 `createChatApp()`，`/widget/*` 路由自动可用：

- `/widget/index.html` — compact chat 页面
- `/widget/t2a-widget.js` — 前端 SDK
- `/widget/compact-chat.css` — 精简样式

```js
const chat = createChatApp({ db, auth, tools, basePath: '/chat' });
// /chat/widget/* 自动挂载，无需手动添加路由
```

## 配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `endpoint` | `string` | **必填** | t2a-chat 后端地址（含 basePath），如 `https://host.com/chat` |
| `token` | `string` | **必填** | 用户认证 token，通过 URL 参数传递给 iframe |
| `position` | `string` | `'bottom-right'` | 气泡位置：`'bottom-right'` 或 `'bottom-left'` |
| `theme` | `object` | `{}` | 主题配置，见下方「自定义主题」 |
| `title` | `string` | `'Chat'` | 面板顶栏标题 |
| `fullscreenUrl` | `string\|null` | `null` | 全屏按钮跳转地址；为 null 时隐藏全屏按钮 |

## 认证流程

```
宿主页面                    iframe (compact chat)              t2a-chat 后端
   │                              │                              │
   │ T2AWidget.init({token})      │                              │
   │──── 创建 iframe ────────────→│                              │
   │  src=".../widget/?token=xxx" │                              │
   │                              │── GET /api/chat (Bearer xxx)─→│
   │                              │← conversations ──────────────│
   │                              │── WS upgrade (token in URL) ─→│
   │                              │←─── streaming messages ──────│
```

1. 宿主页面调用 `T2AWidget.init({ token })` 时，token 被编码到 iframe URL 参数中
2. Compact chat 页面从 URL 解析 token，用作 `Authorization: Bearer <token>` 请求 HTTP API
3. WebSocket 连接时同样通过 URL 参数传递 token，后端 `auth.resolveWsUser(req)` 从 query 中提取验证

## 自定义主题

```js
T2AWidget.init({
  // ...
  theme: {
    primaryColor: '#4F46E5',  // 气泡颜色 + 面板主色
    bubbleSize: 56,           // 气泡直径（px）
  },
});
```

主题色会通过 CSS 变量注入 iframe，影响 compact chat 的按钮、链接、高亮等元素。

## API 方法

| 方法 | 说明 |
|------|------|
| `T2AWidget.init(config)` | 初始化 Widget，渲染气泡到页面 |
| `T2AWidget.open()` | 展开聊天面板 |
| `T2AWidget.close()` | 收起聊天面板 |
| `T2AWidget.toggle()` | 切换面板展开/收起 |
| `T2AWidget.destroy()` | 销毁 Widget 实例，移除所有 DOM |

## 已知限制

| 限制 | 说明 |
|------|------|
| WS 路径硬编码 | compact chat 内 WebSocket 连接路径为 `/chat/ws`；若 basePath 不是 `/chat` 需手动调整 |
| 不支持附件上传 | compact chat 精简模式下未集成文件上传 UI |
| 不支持 Form Block | iframe 内的精简页面暂未实现表单渲染 |
| 无 postMessage 通信 | 宿主与 iframe 之间暂无事件桥接 |

## 后续计划

- [ ] postMessage 双向通信（宿主监听 widget 事件：新消息、面板开关）
- [ ] Unread badge（未读消息角标）
- [ ] basePath 参数化（消除 WS 路径硬编码）
- [ ] 附件上传支持
- [ ] Form Block 渲染
