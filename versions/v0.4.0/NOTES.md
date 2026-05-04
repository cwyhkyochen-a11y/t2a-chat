# v0.4.0 — Form Block 体系

**封版日期**: 2026-05-05
**Git tag**: v0.4.0
**commits**: 3a1ba9d → 01e4c10 (4 commits on master since v0.3.0)

## 完成内容

### P0-P2: 核心引擎 (3a1ba9d)
- `form-block-parser.js`: mini tokenizer + recursive parser，无 eval，24 单测全过
- `form-renderer.js`: render/collect/validate/markSubmitted/markStale 5 方法
- `form-submit.js`: 事件委托 + 校验 + 序列化 `[表单回复]` 格式 + onSubmit 回调
- `dom-helpers.js`: sentinel-token 方案抓 form fence + hydrate + inferFormStates 历史回放
- `chat.css`: form-block 三态样式 (unsubmitted/submitted/stale)
- `docs/form-block-spec.md`: 11 章节 374 行规格文档

### P3: 启用开关 + Prompt 注入 (e52a6a3)
- `enableFormBlocks` 配置项（宿主可按需开关）
- system prompt 注入 form block 语法教学（agent 按规格写表单围栏）

### Prompt 优化 (b06bd7c)
- select max 默认行为（不写 max 则无限多选）
- key 命名纪律
- number max 语义修正

### 加载顺序修复 + 附录字段 (01e4c10)
- **Bug fix**: form-submit.js 移到 core.js 之前（否则 onSubmit hook 注册失败）
- **附录字段（方案 B）**: SDK 自动给所有 form block 追加「附加说明（选填，≤500字）」textarea
  - agent 不用管，提交时自动拼到序列化输出末尾
  - 字数计数 + 顶部分隔线视觉分离

## 关键设计决策
1. **Parser**: 纯状态机，不用正则匹配整块，支持嵌套字段和 default 值
2. **历史回放推断**: inferFormStates 扫描消息链，user msg 出现在 form 后 → submitted，再有 assistant msg 后续 form → stale
3. **附录方案 B**: SDK 通用能力，不污染 agent prompt；如需关闭可加 form-level `extras: false`

## 踩坑
- 加载顺序 bug 在端到端测之前没发现（单元测不涉及 HTML script 顺序）
- form-submit.js 的 `window._t2aFormSubmit = { onSubmit: null }` 必须在 core.js IIFE 之前执行完
