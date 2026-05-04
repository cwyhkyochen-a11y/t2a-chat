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

## 批次 3 / v0.3.0（规划）— 表单块 Form Block

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
