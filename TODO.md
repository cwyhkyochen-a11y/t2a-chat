# t2a-chat TODO

## 批次 1（配合 t2a-core 0.6.2）

- [ ] **thinking 转发**：`ws-server.js` bindSessionEvents 加 `session.on('thinking', ...)` → push `{ type: 'thinking', delta }`
- [ ] **thinking 前端渲染**：流式 thinking 折叠展示（`<details>` 节点），stream 结束后默认收起
- [ ] **打断俚语前端**：ws-manager `onInterlude` 回调 → 在消息区渲染俚语气泡
- [ ] **token 用量接口**：`GET /api/chat/conversations/:id/context-usage` → `{ used, max, warning }`
- [ ] **token 用量 UI**：header 或消息区顶部显示进度条/数字

## 批次 2（性能 + system_event 升级）

- [ ] **历史加载优化**：减少串行 fetch，adapter history:loaded 里的 task 重建改批量或 lazy
- [ ] **system_event 一等公民头像**：升格为 `.message.system`，有独立 avatar（齿轮 icon）
- [ ] **system_event 气泡样式**：独立视觉层级，不用 axis-msg

## 批次 3 / v0.3.0（规划）

- [ ] **表单块（form block）**：system prompt 注入 + renderMd 识别 + form 渲染 + 提交回写
- [ ] **enableFormBlocks 配置开关**
- [ ] 历史回放 form 状态恢复
