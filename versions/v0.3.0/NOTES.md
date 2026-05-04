# t2a-chat v0.3.0 封版 NOTES

封版日期: 2026-05-05
主题: 批次 2 — 视觉升级 + 性能优化 + 切换 session 体验

## 完成内容

### 1. 俚语气泡升级（assistant 消息形态）
- 旧：用 axis-msg notice 灰色样式
- 新：`.message.assistant.interlude` — 斜体 + opacity 0.78 + 浅米背景
- 流式打断时俚语作为 assistant 一等公民呈现

### 2. system_event 升格一等公民
- 独立头像：齿轮 SVG
- 独立气泡：`.message.system-msg`，浅蓝灰背景，自有视觉层级
- imagine 任务卡片增强 badge 跟着改成 `.system-task-badge`
- 跨项目联动：imagine 端 selectors 同步更新

### 3. 性能优化
- **N+1 修复**：chat-routes.js handleGetConversationDetail 改批量 IN 查询，db.js 加 `getRequestsByIds(ids[])`
- **pollTasks 并行**：imagine-adapter for-await → Promise.all + per-task catch
- **renderHistory DocumentFragment**：dom-helpers.js 加 `_renderBatchTarget` 模块级游标，ensureContainer 在 batch 模式下返回 fragment

### 4. 切换 session 体验
- **selectConversation 链路并行**：subscribe 提前不阻塞，Promise.all([loadMessages, loadContextUsage])
- **conversation:switching 事件 + 竞态保护**：`_selectEpoch` epoch token，loadMessages/loadContextUsage 接受 epoch 参数，await fetch 后立即校验
- **加载动画**：dom.showMessagesLoading/hideMessagesLoading 居中 spinner；imagine 端 task panel `_showTaskPanelLoading/_hideTaskPanelLoading`
- **tasksByConv 切换清理**：setCurrentConv + conversation:switching 双层清理，Map size ≤ 2
- **选中态立即更新**：点击 conv-item 不等 loadConversations，立即切 active class
- **AbortController**：selectConversation 入口 abort 上一次 in-flight fetch，解决浏览器 HTTP/1.1 同域 6 connection limit 排队问题

### 5. cancel task 触发 system_event
- imagine server.js 两个 cancel 函数加 `taskCallback.onTaskComplete` 调用
- pushSystemEvent 自然触发 agent 感知，agent 主动回应"任务取消"

### 6. contextUsage DOM 修复
- imagine chat.html 加上 `<span id="contextUsage">`，token 用量正常显示

## 踩坑记录

### conv 25 假"瘫痪"事件
- kyo 反馈 conv 25 卡死，深查发现日志里有 11 小时前的 `safety_violations=[sexual]` + `long_wait: no turn_end after 30s`
- 老事件，OpenAI safety 拒绝后 turn 没正确收尾
- 服务今天已 deploy 重启过 N 次，SessionPool 内存早清空，session 25 status 重置为 active/idle
- 后端实测 1.8ms 返回 22KB 完全正常
- kyo 看到的卡是浏览器旧 JS 缓存 + connection 排队的视觉错觉
- **教训：先核实后端是否真有问题，再下结论**

### AbortController 真正解决的问题
- 不是竞态（epoch token 已经做了"旧响应静默丢弃"的逻辑保证）
- 是浏览器 HTTP/1.1 同域 6 connection limit — 旧 fetch 占着 socket，新 fetch 排队等
- 看起来就是"上一个加载完才显示当前"
- AbortController 主动取消才能立刻释放 socket

### 跨项目联动改动不能漏
- t2a-chat 的 system_event DOM 类名从 `.axis-msg.event` 改成 `.message.system-msg` 后
- imagine `imagine-adapter-ui.js` 里的 selectors 必须同步改，否则任务图片增强失效

### imagine bcrypt verifyUser 不要传 username
- imagine 的 `db.verifyUser` 是迭代所有 user 比对密码，没有用户名概念
- 直接传 password

### imggen.db 不是 imagine.db
- imagine 项目有 5 个 db 文件，server.js 用的是 `imggen.db`
- sessions 在独立的 `sessions.db`，schema 是 token PK
- debug 鉴权问题先看清表结构

## 部署

- imagine commit: 633f101 (feature/t2a-core-integration)
- t2a-chat commit: f8dec40 (master)
- 都在线上，验证通过
- 部署用 `bash projects/img-gen-tool/deploy.sh`，自动同步 imagine + ../t2a-chat 两个 sibling

## 验证标准（已通过）

- 硬刷新后连续快速点 4-5 个 conv → 只显示最后一个的 loading + 内容，旧的不"挨个加载"
- 点 25 号 → 1 秒内出内容
- 俚语：流式时点停止 → 看到 assistant 头像 + 淡色斜体气泡
- system_event：图片生成完成 → 齿轮头像 + 浅蓝灰气泡 + source badge
- token 用量：header 右侧 xxx / 80.0k 显示，>60k 橙、>72k 红
- cancel task：取消任务后 → agent 主动发一句关于"任务被取消"的回复
- task panel loading：切换 session 时右侧也有 loading 占位
- thinking 折叠：reasoning 模型发消息 → 看到 💭 Thinking… 折叠块

## 下一步（v0.4.0）

批次 3 / form block — TODO.md 已有详细规格
- agent 在 assistant 消息里用 \`\`\`form 块语法嵌入表单
- 字段类型：select(radio/checkbox) / text / textarea / number
- system prompt 注入语法 + few-shot
- renderMd 识别 + 表单渲染器 + 提交回写

可选：URL 路径加 conv id（/imagine/chat/:convId），刷新保持当前对话 + 可分享
