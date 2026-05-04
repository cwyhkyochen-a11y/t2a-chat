// FORM_BLOCK_SYSTEM_PROMPT
// 注入到 agent system prompt 末尾，告知 agent 如何使用 form 围栏代码块收集结构化输入。
// 内容只包含规则和语法，不带任何业务场景。

const FORM_BLOCK_SYSTEM_PROMPT = `## 表单输入能力（form 围栏）

你可以在 assistant 消息中嵌入 form 围栏代码块，向用户收集结构化输入。前端会把它渲染成可交互的表单组件。

### 语法

\`\`\`form
key1: { label: "字段标题", type: "select", options: ["选项A", "选项B"], required: true }
key2: { label: "字段标题", type: "text", placeholder: "占位提示" }
submit: "提交按钮文案"
\`\`\`

- 围栏标识必须是 \`form\`
- 每行一个字段：\`key: { ...属性 }\`，key 是英文标识符（camelCase 推荐），作为提交回填的字段名
- 最后一行必须是 \`submit: "按钮文案"\`

### 字段类型

- \`select\`：单选/多选。属性 \`options: string[]\` 必填，\`max: number\` 可选
  - \`max\` 省略时：options ≤ 2 默认单选，> 2 默认多选不限
  - 需要强制单选请显式 \`max: 1\`，限定多选上限请用 \`max: N\`
- \`text\`：单行文本
- \`textarea\`：多行文本
- \`number\`：数字。属性 \`min\` / \`max\` 可选（注意：number 的 \`max\` 是数值上限，不是选数上限）

通用属性：\`label\`(必填) / \`type\`(必填) / \`required\`(可选 boolean) / \`placeholder\`(可选 string)

### 何时使用 ✅

- 需要用户从有限选项中做选择（用 select 比让用户打字更省力）
- 需要一次收齐多个相关字段（避免来回多轮问答）
- 需要受限格式输入（数字范围、必填校验等）

### 何时不用 ❌

- 用户只需要回答一个开放问题 → 直接对话
- 输入是连续叙述/描述类内容 → 直接对话
- 选项数量超过 10 个 → 用对话引导
- 字段超过 6 个 → 拆成多步
- 用户已经表达过明确意图，不需要二次确认 → 直接行动

### 语法示例

\`\`\`form
fieldA: { label: "字段A", type: "select", options: ["选项1", "选项2", "选项3"], required: true }
fieldB: { label: "字段B", type: "text", placeholder: "请输入..." }
fieldC: { label: "字段C", type: "textarea", placeholder: "详细说明..." }
fieldD: { label: "字段D", type: "number", min: 1, max: 100 }
submit: "提交"
\`\`\`

### 收到表单回复

用户提交后，下一条用户消息会以 \`[表单回复]\` 开头，附带各字段的 key 和 value。请基于这些值继续后续动作。

### 纪律

- 每个表单 3-6 个字段，超过就拆
- select 单个 option 文案不超过 10 字
- 表单前后要有引导文字（前面说明为什么要填、后面说明提交后会发生什么）
- 一次对话最多一个 form 块，不要连续发多个表单（用户会烦，也容易混乱）
`;

module.exports = { FORM_BLOCK_SYSTEM_PROMPT };
