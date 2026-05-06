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

## 批次 4 / v0.5.0（已完成 ✅）— 模式 + 交互增强

- [x] **弹窗型 SDK 模式**：v0.7.0 Widget 模式（T2AWidget.init() + iframe 隔离）
- [x] **Tool List 展示**：v0.6.0 Tools Tab
- [x] **Task 配置面板**：v0.6.0 Config Modal + user-settings
- [ ] **Session 快捷回复**：session 开始前（空会话）提供快捷回复按钮，便于用户快速开始
- [x] **多模态发送**：v0.5.0 附件系统（attachment-manager + upload-routes）
- [x] **输入区对齐修复**：v0.5.0 修复

## 批次 5 — 多 Session 编排（hub-spoke）

> 2026-05-06 kyo 设计讨论结论：chat 层负责 session 管理和任务编排，宿主只注册 tools + 提供 context

### 架构定位
- t2a-chat = core 的 runtime / 最佳实践
- 三层：core(LLM通信) → chat(session管理/任务编排/调度) → 宿主(注册 tools + 业务上下文)
- hub-spoke 先行：Main session 中心调度，子 session 不创建子 session

### 设计讨论记录（2026-05-06 kyo + yoyo）

**核心结论：**
1. chat 层负责 session 管理和任务编排（不是 core，不是宿主）
2. chat = core 的 runtime / 最佳实践，宿主只注册 tools + 提供 context
3. hub-spoke 先行，Main session 中心调度

**Agent Loop 机制：**
- 不存在独立的"loop prompt"，驱动力是 system prompt + tool 调用结构
- LLM 每轮二选一：输出 tool_calls（继续 loop）或纯文本（loop 结束）
- loop 结束信号 = 本轮 LLM 响应无 tool_calls
- Codex/Claude Code 是进程级隔离（进程退出=完成），OpenClaw 是会话级（依赖 LLM 行为）

**Sub Session 用 Task 状态机管理：**
```
PENDING → RUNNING → COMPLETED
                 → FAILED
                 → TIMEOUT（兜底）
```
- 状态变更 = 事件推送（EventEmitter）
- 复用 t2a-chat 现有 taskRegistry 模型，子 session = 新 task type
- 超时只做异常兜底（设宽松值），正常路径走 complete 事件
- 前端复用 task 卡片，状态实时更新

**超时的必要性：**
- 只防两件事：LLM 死循环 + 外部阻塞（API 挂/SSH 卡）
- 不应该承担"完成感知"的职责
- OpenClaw 当前问题：超时同时做异常兜底 + 正常完成感知，设短误杀、设长恢复慢

**对比其他 Agent：**
- Codex/Claude Code = fork 进程 → OS 退出信号 → 确定性完成
- t2a-chat 目标 = 应用层模拟进程级退出语义（loop end → emit complete）

### TODO
- [ ] **SessionManager**：创建子 session、跨 session 通信、完成回调（EventEmitter）
- [ ] **Task 状态机**：PENDING/RUNNING/COMPLETED/FAILED/TIMEOUT + 事件推送
- [ ] **TaskPlanner / 编排逻辑**：Main LLM 决定拆不拆、怎么拆、fan-out → 等待 → 合并
- [ ] **向后兼容**：现有单 session 模式不受影响
- [ ] **session 生命周期**：超时只兜底异常、清理、持久化
- [ ] **前端 task 卡片复用**：子 session 进度实时展示

## 批次 3 / v0.4.0（已完成 ✅）— 表单块 Form Block

### 设计原则
- agent 在 assistant 消息里用 ```form 块语法嵌入表单
- system prompt 注入语法说明 + few-shot
- 前端 renderMd 识别后渲染成真正的交互组件
- 用户填完提交 → 自动发 user message 给 agent

### 字段类型（两大类）

**1. 选择题（select）**：
- `type: "select"`
- `options: ["A", "B", "C"]` — 可选项列表
- `max: 1` — 单选（默认，max=1 渲染为 radio）
- `max: N` — 多选（渲染为 checkbox，最多选 N 个）
- `max` 省略：options ≤ 2 → 单选；options > 2 → 多选不限
- 也可以靠 options 数量隐式判断（kyo 提到的方案）：2 项默认 radio，多项默认 checkbox

**2. 问答题 / 填空题（text）**：
- `type: "text"` — 单行（短填空）
- `type: "textarea"` — 多行（问答 / 自由描述）
- `type: "number"` — 数字
- `placeholder` / `required` 可选

### 示例语法（agent 输出）
````
我需要确认几个点：

```form
style: { label: "风格偏好", type: "select", options: ["极简","复古","赛博","不确定"], max: 1 }
features: { label: "需要的功能", type: "select", options: ["登录","支付","搜索","推荐","通知"], max: 3 }
budget: { label: "预算范围", type: "number", placeholder: "单位：元" }
note: { label: "补充说明", type: "textarea", placeholder: "任何额外需求..." }
submit: "确认提交"
```

填完我就开始做方案。
````

### TODO
- [ ] system prompt 注入（语法说明 + few-shot + 使用时机指导）
- [ ] `enableFormBlocks: true` 配置开关
- [ ] renderMd 识别 ```form 块 → 解析字段定义
- [ ] 表单渲染器：select(radio/checkbox) + text/textarea/number
- [ ] 提交回写（序列化为 user message）
- [ ] 表单状态管理（未提交 / 已提交 / 已过期）
- [ ] 历史回放 form 状态恢复（已提交的显示为只读卡片）
- [ ] 边界处理：用户不填表单直接回消息 / agent 忘了用语法
