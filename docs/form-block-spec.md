# Form Block 语法规范

## 1. 概述

Form Block 是 t2a-chat 的结构化信息收集机制。agent 在 assistant 消息中嵌入 ` ```form ` 围栏代码块，前端解析后渲染为交互式表单组件，用户填写提交后自动构造一条格式化的 user message 回传给 agent。

**为什么需要**：自然语言对话中，agent 经常需要同时收集多个维度的信息（偏好、参数、确认项）。逐个追问效率低、上下文消耗大。Form Block 让 agent 一次性收集结构化数据，用户填写体验也更好。

**什么时候用**：

- 需要同时收集 2 个以上字段
- 字段有明确的选项或类型约束
- 需要用户确认多个配置项

**什么时候不用**：

- 单个简单问题（直接问）
- 追问/澄清（对话即可）
- 输出结果给用户看（用普通 markdown）

---

## 2. 语法

Form Block 使用 markdown 围栏代码块，语言标记为 `form`，内部使用 JS-like object literal 逐行定义字段。

````
```form
fieldKey: { label: "显示名称", type: "类型", ...其他属性 }
fieldKey2: { label: "显示名称", type: "类型", ...其他属性 }
submit: "按钮文案"
```
````

**规则**：

- 每行一个字段，格式为 `key: { ... }`
- key 为英文标识符（camelCase），用于提交时的字段名
- value 是一个 JS object literal（不需要严格 JSON，允许省略 key 引号）
- `submit` 是特殊保留 key，值为按钮文案字符串
- 围栏外的文字正常渲染为 markdown

---

## 3. 字段类型

### 类型总表

| type | 用途 | 渲染组件 |
|------|------|----------|
| `select` | 选择题 | radio / checkbox（根据 max 和 options 数量决定） |
| `text` | 单行文本 | input[type=text] |
| `textarea` | 多行文本 | textarea |
| `number` | 数字 | input[type=number] |

### 通用属性

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `label` | string | ✅ | 字段显示名称 |
| `type` | string | ✅ | 字段类型 |
| `required` | boolean | ❌ | 是否必填，默认 false |
| `placeholder` | string | ❌ | 占位提示文字 |

### select 专属属性

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `options` | string[] | ✅ | 可选项列表 |
| `max` | number | ❌ | 最多可选数量，决定单选/多选模式 |

### text / textarea 专属属性

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `placeholder` | string | ❌ | 占位提示 |
| `required` | boolean | ❌ | 是否必填 |

### number 专属属性

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `placeholder` | string | ❌ | 占位提示 |
| `required` | boolean | ❌ | 是否必填 |
| `min` | number | ❌ | 最小值 |
| `max` | number | ❌ | 最大值（注意：number 的 max 是值上限，不是选择数量） |

---

## 4. select 子模式

select 的渲染模式由 `max` 属性和 `options` 数量共同决定：

### 显式指定 max

| max 值 | 渲染 | 行为 |
|--------|------|------|
| `max: 1` | radio 单选 | 只能选一个 |
| `max: N`（N > 1） | checkbox 多选 | 最多选 N 个 |

### max 省略时的隐式判断

| options 数量 | 默认模式 | 等价于 |
|-------------|----------|--------|
| ≤ 2 | 单选（radio） | `max: 1` |
| > 2 | 多选不限（checkbox） | `max: options.length` |

**示例**：

```form
confirm: { label: "是否继续", type: "select", options: ["是", "否"] }
```
→ 2 个选项，省略 max → 单选 radio

```form
features: { label: "功能模块", type: "select", options: ["登录", "支付", "搜索", "推荐", "通知"] }
```
→ 5 个选项，省略 max → 多选不限

```form
priority: { label: "优先级", type: "select", options: ["高", "中", "低"], max: 1 }
```
→ 显式 max: 1 → 单选 radio（覆盖隐式规则）

---

## 5. submit 特殊 key

`submit` 是保留字段名，不参与数据收集，仅定义提交按钮的文案。

```form
submit: "确认提交"
```

**规则**：

- 值为字符串，作为按钮文本
- 如果省略 submit，默认按钮文案为 `"提交"`
- submit 必须放在字段列表的最后一行
- 一个 form block 只能有一个 submit

---

## 6. 完整示例

### 示例 1：收集设计偏好（select 多选 + textarea）

````
我来帮你做设计方案，先确认几个偏好：

```form
style: { label: "风格偏好", type: "select", options: ["极简", "复古", "赛博朋克", "商务", "不确定"], max: 1 }
colors: { label: "配色倾向", type: "select", options: ["暗色系", "亮色系", "彩色活泼", "黑白灰"] }
reference: { label: "参考说明", type: "textarea", placeholder: "有喜欢的网站或 App 可以描述一下..." }
submit: "确认偏好"
```

填完我就出方案。
````

- `style`：显式 max: 1 → radio
- `colors`：4 个选项省略 max → checkbox 多选不限
- `reference`：textarea 自由输入

### 示例 2：收集预算 + 联系方式（number + text + required）

````
项目基本信息确认：

```form
budget: { label: "预算范围", type: "number", placeholder: "单位：元", required: true }
timeline: { label: "期望工期", type: "text", placeholder: "如：2周、1个月", required: true }
contact: { label: "联系方式", type: "text", placeholder: "微信号或手机", required: true }
note: { label: "补充说明", type: "textarea", placeholder: "其他需要说明的..." }
submit: "提交信息"
```
````

- `budget`：number 类型，必填
- `timeline` / `contact`：text 类型，必填
- `note`：textarea，选填

### 示例 3：简单二选一确认（select 2 项 → radio）

````
方案 A 偏性能，方案 B 偏可维护性。你选哪个？

```form
choice: { label: "方案选择", type: "select", options: ["方案 A：性能优先", "方案 B：可维护性优先"] }
submit: "确认选择"
```
````

- 2 个选项，省略 max → 隐式单选 radio
- 最简场景，一个字段 + submit

---

## 7. Agent 使用指南

> 给 agent 看

### 何时使用 form block

- 需要同时收集 **2 个以上** 结构化字段
- 字段有明确的选项范围或类型约束（数字、必填等）
- 需要用户做多维度确认或配置

### 何时不要用

- **单个简单问题**：直接用自然语言问，不要为一个 yes/no 开表单
- **追问/澄清**：对话上下文里追问，不需要表单
- **输出结果**：展示方案、代码、总结时用正常 markdown
- **工具调用结果里**：function call 的 content 里不要嵌 form block

### 使用纪律

- **一次对话最多一个 form block**：不要连续发多个表单，用户会烦
- **form block 前后要有引导文字**：告诉用户为什么要填、填完之后会做什么
- **字段不要太多**：3-6 个为宜，超过 6 个考虑分步
- **选项不要太长**：每个 option 控制在 10 字以内

### Few-shot 示范（注入 system prompt 用）

```
✅ 正确用法：需要同时了解多个维度
"我来帮你做方案，先确认几个点：[form block]"

❌ 错误用法：只有一个问题
"你喜欢什么颜色？[form block with 1 field]"
→ 应该直接问：你喜欢什么颜色？暗色系还是亮色系？

❌ 错误用法：在输出结果里用
"这是你的方案：[form block]"
→ 应该用普通 markdown 展示

❌ 错误用法：连续多个 form
"先填这个：[form1] 再填这个：[form2]"
→ 应该合并为一个 form
```

---

## 8. 解析行为

### Parser 容错规则

| 情况 | 处理 |
|------|------|
| 字段 value 不是合法 object | 跳过该行，不渲染该字段 |
| 缺少 `label` | 使用 key 作为 label |
| 缺少 `type` | 默认为 `text` |
| select 缺少 `options` | 降级为 `text` 类型 |
| options 不是数组 | 降级为 `text` 类型 |
| 整个 form block 解析失败 | fallback 为普通代码块显示原文 |
| 流式传输中 form 未闭合 | 不渲染表单，等围栏闭合后再解析 |

### 半成品 form 的 fallback

streaming 过程中，` ```form ` 开始但 ` ``` ` 未闭合时：

1. 不提前渲染表单
2. 显示为 "正在生成表单..." 占位
3. 围栏闭合后一次性解析渲染

---

## 9. 提交语义

用户填写并点击 submit 后，前端构造一条 **user message** 自动发送，格式为：

```
[表单回复]
字段label: 用户填写的值
字段label: 用户填写的值
...
```

### 格式规则

| 字段类型 | 值格式 |
|----------|--------|
| select 单选 | 选中的选项文本 |
| select 多选 | 逗号分隔：`选项A, 选项B, 选项C` |
| text | 用户输入的文本 |
| textarea | 用户输入的文本（保留换行） |
| number | 数字字符串 |
| 未填写的非必填字段 | 不出现在回复中 |

### 示例

用户在示例 1 的表单中填写后，发送的 user message：

```
[表单回复]
风格偏好: 极简
配色倾向: 暗色系, 黑白灰
参考说明: 喜欢 Linear 和 Vercel 的设计风格
```

agent 收到后可直接从中提取结构化信息继续工作。

---

## 10. 状态机

每个 form block 实例有三种状态：

```
┌──────────┐    用户点提交    ┌──────────┐
│  未提交   │ ──────────────→ │  已提交   │
│ (active) │                 │(submitted)│
└──────────┘                 └──────────┘
      │                            │
      │  新 form 出现 / 新消息      │  （不可逆）
      ▼                            │
┌──────────┐                       │
│  已过期   │ ←────────────────────┘ （已提交不会过期）
│ (expired) │
└──────────┘
```

### 状态说明

| 状态 | 触发条件 | UI 表现 |
|------|----------|---------|
| 未提交（active） | form block 刚渲染 | 可交互，表单可填写 |
| 已提交（submitted） | 用户点击 submit | 只读卡片，显示已提交的值 |
| 已过期（expired） | 同一对话中出现新的 form block，或用户发了新消息 | 表单灰显，不可操作 |

### 历史回放

- 已提交的 form：渲染为只读卡片，显示提交值
- 已过期的 form：灰显不可操作
- 从 message history 恢复时，通过对应的 `[表单回复]` user message 判断是否已提交

---

## 11. 边界情况

### 用户不填表单直接回消息

- form 状态变为 **已过期**
- 用户的新消息正常发送
- agent 收到的是用户的自然语言消息（不是表单数据）
- agent 应该正常响应，不要追问"你还没填表单"

### agent 忘了用 form 语法

- 前端收到的就是普通文本
- 不做任何特殊处理，原样渲染 markdown
- 不会出现解析错误

### 多个 form block 在同一消息中

- 只渲染 **第一个** form block 为交互表单
- 后续 form block 降级为普通代码块显示
- agent 使用指南已约束"一次对话最多一个 form block"

### required 字段未填写时点击提交

- 前端校验拦截，高亮必填字段
- 不发送 user message
- 用户必须填完必填项才能提交

### 空表单（无有效字段）

- 如果 form block 解析后没有任何有效字段
- fallback 为普通代码块显示原文

### select 选项为空数组

- `options: []` → 降级为 text 输入框
- 等价于 parser 容错中的"options 不是有效数组"
