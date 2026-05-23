# t2a-chat v0.8.0 — 文件体系 + 原生 Tool 体系 + Excel 工具包

## 背景

t2a-chat 目前有两个能力缺口：

1. **文件体系缺失**
   - 用户发送消息带文件时，excel 只能被前端解析成 CSV 文本塞进 user message（`excel-text` 分支），大文件/多 sheet/合并单元格全跪
   - 文件没有独立生命周期，无法在多轮对话中复用、创建副本、做写操作
   - 前端没有文件卡片 UI，附件只在发送前的 input 区可见

2. **原生 Tool 体系不完整**
   - 现状：宿主通过 `createChatApp({ tools })` 注入 factory 函数，session 创建时调一次生成 `ToolRegistry`（`@t2a/core` 提供）
   - 缺 ①：`toolsMeta`（展示用元数据）和实际 `ToolRegistry` 是两套数据，没有自动同步
   - 缺 ②：工具无权限字段，所有已注册工具对所有登录用户平等暴露
   - 缺 ③：工具无 session 内动态过滤能力（无法做到"session 有 xlsx 文件才暴露 spreadsheet_* 工具"）
   - 缺 ④：无内置工具集。Excel 等通用工具需要每个宿主自己实现

本版把这三块补齐。

---

## 一、文件体系

### 1.1 数据模型

新增 `chat_files` 表：

```sql
CREATE TABLE chat_files (
  id TEXT PRIMARY KEY,                   -- 文件 ID（file_xxxx）
  user_id INTEGER NOT NULL,              -- 所属用户（权限隔离）
  conversation_id INTEGER,               -- 所属对话（null 表示刚上传未绑定）
  message_id INTEGER,                    -- 关联的 message 行（可选）
  parent_file_id TEXT,                   -- 副本来源文件（null 表示原始文件）
  file_name TEXT NOT NULL,               -- 用户看到的文件名
  mime_type TEXT,
  file_size INTEGER,
  storage_path TEXT NOT NULL,            -- 服务器磁盘路径，不暴露给 LLM
  download_url TEXT,                     -- 可下载的 URL（exported 后填充）
  status TEXT NOT NULL DEFAULT 'ready',
    -- uploaded / parsing / ready / editing / exporting / exported / error
  kind TEXT,                             -- excel / csv / pdf / ...（语义分类）
  metadata TEXT,                         -- JSON: { sheets, rows, cols, headers }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_chat_files_conv ON chat_files(conversation_id, created_at);
CREATE INDEX idx_chat_files_user ON chat_files(user_id, created_at);
```

状态机：

```
原始文件：  uploaded → parsing → ready
                              ↘ error
副本文件：  editing → exporting → exported
                              ↘ error
```

### 1.2 上传流程

**原则**：LLM 只拿 `file_id + 元数据`，不拿路径不拿内容。

变更：

1. 前端 `POST /api/chat/upload` 增加字段：
   - `conversation_id`（必填）
   - `kind`（沿用）
2. 后端流程：
   - 接收文件 → 存盘 → 写 `chat_files`（status=uploaded）
   - 同步解析一次元数据（excel：sheets/rows/cols/headers；csv：行列数） → status=ready
   - 返回 `{ file_id, file_name, mime_type, file_size, metadata }`
3. 前端收到 `file_id` 后 → WS 发 `attach_file` 消息触发 system_event 注入
4. 后端 ws 收到 `attach_file` → 校验 ownership → 调 `session.pushSystemEvent`：
   ```json
   {
     "type": "file_uploaded",
     "file_id": "file_abc123",
     "file_name": "乔薇尔4月对账.xlsx",
     "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
     "file_size": 240128,
     "kind": "excel",
     "metadata": { "sheets": ["Sheet1"], "rows": 2379, "cols": 18 }
   }
   ```
   LLM 读到这条事件，知道有文件，需要调工具才能读内容。

**为什么用 WS 消息而不是上传接口直接注入**：保持上传接口的幂等性（可重试、可去重），事件注入与消息发送同条通道避免竞态。

### 1.3 用户发消息时携带文件

前端 `attachments` 协议变更，从「附带内容」转为「附带引用」：

- 旧（废弃）：`{ kind: 'excel-text', filename, csv: '<大段文本>' }`
- 新（推荐）：`{ kind: 'file_ref', file_id, file_name, mime_type }`

`buildContentFromAttachments` 里 `excel-text` 分支退役（保留兼容到 v1.0，期间不再产生新数据）。

用户发送带文件的消息时：
- `attach_file`（触发 system_event 注入）**先行**
- 再发 `send`（带文本 + `attachments: [{ kind: 'file_ref', ... }]`）
- user message 的 attachments 字段存 file_ref 数组，前端渲染气泡时展示文件卡片

### 1.4 前端 UI

- **输入区附件条**：xlsx/csv/pdf 类型文件显示为文件卡片（图标 + 文件名 + 大小 + 删除按钮）
- **消息气泡渲染**：user/assistant 气泡内识别 attachments 的 file_ref，渲染文件卡片（文件名 + 图标 + 状态标签）
- **副本文件卡片**：`editing` / `exporting` / `exported` 三态，exported 状态带下载按钮
- **system_event 渲染**：file_uploaded / file_exported 事件在对话流中显示为系统通知气泡（可折叠）

---

## 二、原生 Tool 体系

### 2.1 统一工具注册

保留现有 factory 模式：`createChatApp({ tools: ({ userId, conversationId, baseUrl }) => ToolRegistry })`。

新增增强：

1. **toolsMeta 自动派生**
   - 当前：宿主分别传 `tools` 和 `toolsMeta` 两套数据
   - 改为：`toolsMeta` 自动从 ToolRegistry 派生（工具注册时可带 `group/tags` 字段）
   - 宿主如仍显式传 `toolsMeta` 则覆盖派生结果（向后兼容）

2. **工具 permission 字段**

   ```js
   registry.register({
     schema: { ... },
     handler: async (args, ctx) => { ... },
     permission: 'auth_required',  // public | auth_required | admin_only
     group: 'generation',
     tags: ['image'],
   });
   ```

3. **checkToolPermission 钩子**

   ```js
   createChatApp({
     checkToolPermission: (toolDef, user) => boolean,
   })
   ```

   - `public`：不要求 user
   - `auth_required`：要求 `user && user.id`
   - `admin_only`：要求 `user.role === 'admin'`
   - 无权限时：该工具**不出现**在 LLM 的 tools 列表里（不是报错，是隐藏）

4. **Session 内动态过滤**
   - ToolRegistry 提供 `filter(ctx)` hook，`ctx` 包含 `{ files: chat_files 列表, hasFileOfKind(kind) }`
   - 每次构造 LLM function calling schema 时调 `registry.getSchemas({ user, sessionCtx })`，应用 permission + filter
   - Excel 工具注册时声明 `requires: { fileKind: 'excel' }`，session 无 xlsx 文件时自动隐藏

### 2.2 内置工具集

新增 `require('t2a-chat').builtinTools`：

```js
const { createChatApp, builtinTools } = require('t2a-chat');

createChatApp({
  tools: (ctx) => {
    const registry = new ToolRegistry();
    registry.merge(builtinTools.spreadsheet({ db, userId: ctx.userId, baseUrl: ctx.baseUrl }));
    // 宿主自己的工具...
    return registry;
  }
});
```

内置工具的文件访问权限走 `chat_files.user_id` 校验（所有读写操作先验 ownership）。

---

## 三、Excel 工具包

按 kyo 给定清单实现，放在 `t2a-chat/src/builtin-tools/spreadsheet.js`，技术选型：`xlsx` (SheetJS)。

### 3.1 读工具

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `spreadsheet_inspect` | 查看文件结构 | `file_id`, `sheet?`, `preview_rows?=20` → 返回 sheet 列表 + 表头 + 前 N 行原始内容 + 总行/列数 |
| `spreadsheet_row_count` | 查总行数/列数 | `file_id`, `sheet?` → `{ rows, cols }` |
| `spreadsheet_read_all` | 完整数据提取 | `file_id`, `sheet?` → 限 1MB 以下文件，超出报错提示改用分块工具 |
| `spreadsheet_read_columns` | 按列提取 | `file_id`, `columns: string[]`, `start_row?`, `limit?` |
| `spreadsheet_read_rows` | 按行提取 | `file_id`, `start_row`, `end_row`, `sheet?` |
| `spreadsheet_column_values` | 获取某列的筛选项 | `file_id`, `column` → `[{ value, count }]` |
| `spreadsheet_search` | 查询文本 | `file_id`, `query`, `columns?: string[]` → 匹配的行（含行号） |
| `spreadsheet_aggregate` | **聚合分析** | `file_id`, `sheet?`, `group_by: string[]`, `metrics: [{ column, op }]`, `filter?`, `order_by?`, `limit?` → 分组聚合结果 |

#### spreadsheet_aggregate 详细说明

这是「数据分析」类需求的核心工具。把大表压缩成小结果集，避免 LLM 读全表心算。

**参数**：
```json
{
  "file_id": "file_xxx",
  "sheet": "Sheet1",
  "group_by": ["门店"],
  "metrics": [
    { "column": "毛利", "op": "sum" },
    { "column": "订单数", "op": "count" }
  ],
  "filter": [
    { "column": "月份", "op": "=", "value": "2026-04" }
  ],
  "order_by": { "column": "毛利_sum", "desc": true },
  "limit": 5
}
```

**支持的 op**：`sum` / `avg` / `count` / `count_distinct` / `min` / `max`
**支持的 filter op**：`=` / `!=` / `>` / `<` / `>=` / `<=` / `in` / `contains`

**返回**：
```json
{
  "groups": [
    { "门店": "A店", "毛利_sum": 12345, "订单数_count": 234 },
    ...
  ],
  "total_groups": 47,
  "truncated": false
}
```

**实现**：SheetJS 读全表 → JS 内存里 reduce（数据量 ≤ 10w 行内可接受）。超过阈值返回错误提示 LLM 加 filter 收窄范围。

### 3.2 写工具

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `spreadsheet_create_copy` | 创建文件副本 | `file_id` → `new_file_id`（chat_files 插入新行，status=editing，parent_file_id 指向原文件，storage 复制一份） |
| `spreadsheet_replace_values` | 覆盖某列筛选项文本（批量替换） | `file_id`, `column`, `replacements: [{ from, to }]` |
| `spreadsheet_update_column` | 修改某列内容 | `file_id`, `column`, `rows: [{ row_index, value }]` |
| `spreadsheet_update_row` | 修改某行内容 | `file_id`, `row_index`, `data: { [column]: value }` |
| `spreadsheet_update_cell` | 修改某个单元格 | `file_id`, `row_index`, `column`, `value` |
| `spreadsheet_dry_run_patch` | **预览写操作** | `file_id`, `patch_type`, `patch_params` → 不真写，返回影响行数 + 前后对比预览（前 20 行） |
| `spreadsheet_finish` | 完成编辑，触发导出 | `file_id` → 状态 `editing → exporting`，应用层脚本生成 xlsx → 状态 `exporting → exported` → 发 `file_exported` system_event |

#### spreadsheet_dry_run_patch 详细说明

用于 fuzzy 场景的预览（门店名统一、类别合并等），让用户/LLM 在 finish 前看到改动效果。

**参数**：
```json
{
  "file_id": "file_xxx",   // 必须是 editing 状态的副本
  "patch_type": "replace_values",
  "patch_params": {
    "column": "门店名称",
    "replacements": [
      { "from": "京世沙龙店", "to": "京世沙龙" },
      { "from": "京世美容店", "to": "京世沙龙" }
    ]
  }
}
```

**返回**：
```json
{
  "affected_rows": 38,
  "preview": [
    { "row_index": 12, "before": { "门店名称": "京世沙龙店" }, "after": { "门店名称": "京世沙龙" } },
    ...
  ],
  "preview_truncated": true
}
```

**特点**：
- 不写 `chat_file_patches`，纯计算
- 同 patch_type 共享底层实现（replace_values / update_column / update_row / update_cell 都支持）
- LLM 调完 dry_run → 决策是否真写 → 调对应的写工具

### 3.3 写入流程

```
LLM: spreadsheet_create_copy(file_id) → new_file_id (status: editing)
LLM: spreadsheet_replace_values(new_file_id, "门店名称", [{from: "京世沙龙店", to: "京世沙龙"}])
LLM: spreadsheet_update_cell(new_file_id, 10, "备注", "已对账")
LLM: spreadsheet_finish(new_file_id)
    → status: editing → exporting
    → 应用层导出器（hostExport）执行：读编辑日志 + 原文件 → 生成新 xlsx
    → status: exporting → exported
    → system_event: { type: "file_exported", file_id, download_url }
LLM: "文件已生成，可以下载了"
```

**编辑日志**：`editing` 期间的所有写操作不直接改文件，存到 `chat_file_patches` 表（patch JSON），`finish` 时按顺序回放生成最终 xlsx。

```sql
CREATE TABLE chat_file_patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL,
  patch_type TEXT NOT NULL,  -- replace_values / update_column / update_row / update_cell
  patch_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (file_id) REFERENCES chat_files(id)
);
```

### 3.4 文件副本状态语义

| 状态 | 可做 |
|------|------|
| `editing` | 可继续调写工具 |
| `exporting` | 只读（LLM 若调写工具返回"文件导出中，请稍后"） |
| `exported` | 只读，可下载 |

### 3.5 工具 schema 全量定义

以下是每个工具传给 LLM 的完整 function calling schema（含 description）。开发时直接照抄。

#### spreadsheet_inspect

```js
{
  name: 'spreadsheet_inspect',
  description: '查看 Excel/CSV 文件的结构。返回 sheet 列表、当前 sheet 的表头、前 N 行原始数据、总行列数。在对文件做任何操作前都应先调用此工具了解结构。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: '文件 ID（从 system_event 的 file_uploaded 事件中获取）' },
      sheet: { type: 'string', description: '指定 sheet 名称。不传则使用第一个 sheet' },
      preview_rows: { type: 'integer', description: '返回前 N 行预览数据，默认 20，最大 50', default: 20 }
    },
    required: ['file_id']
  }
}
```

#### spreadsheet_row_count

```js
{
  name: 'spreadsheet_row_count',
  description: '快速查询文件的总行数和总列数（不读取数据内容，仅元数据）。用于决定后续用哪个读工具：行数少走 read_all，行数多走 read_rows 分块。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: '文件 ID' },
      sheet: { type: 'string', description: 'sheet 名称。不传则第一个 sheet' }
    },
    required: ['file_id']
  }
}
```

#### spreadsheet_read_all

```js
{
  name: 'spreadsheet_read_all',
  description: '一次性读取整个 sheet 的所有数据。仅用于小文件（总单元格数 ≤ 2 万）。大文件会返回错误，此时应改用 spreadsheet_read_rows 分块读取，或用 spreadsheet_aggregate 做聚合分析。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: '文件 ID' },
      sheet: { type: 'string', description: 'sheet 名称。不传则第一个 sheet' }
    },
    required: ['file_id']
  }
}
```

#### spreadsheet_read_columns

```js
{
  name: 'spreadsheet_read_columns',
  description: '按列名提取指定列的数据。适用于只关心部分列的场景（如只要"门店、金额"两列），可大幅减少返回数据量。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: '文件 ID' },
      columns: { type: 'array', items: { type: 'string' }, description: '需要提取的列名数组，列名须与表头一致' },
      sheet: { type: 'string' },
      start_row: { type: 'integer', description: '起始行号（0-based，表头行除外），默认 0', default: 0 },
      limit: { type: 'integer', description: '最多返回多少行，默认 500，最大 2000', default: 500 }
    },
    required: ['file_id', 'columns']
  }
}
```

#### spreadsheet_read_rows

```js
{
  name: 'spreadsheet_read_rows',
  description: '按行号范围读取数据（所有列）。适用于分块阅读大文件。行号为 0-based 数据行（不含表头）。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: '文件 ID' },
      start_row: { type: 'integer', description: '起始行号（0-based，含）' },
      end_row: { type: 'integer', description: '结束行号（含），与 start_row 跨度不超过 500' },
      sheet: { type: 'string' }
    },
    required: ['file_id', 'start_row', 'end_row']
  }
}
```

#### spreadsheet_column_values

```js
{
  name: 'spreadsheet_column_values',
  description: '获取某一列的所有唯一值及其出现次数（类似 Excel 的筛选下拉框）。用于快速了解某列的取值分布，例如查有哪些门店、类目、状态等。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string' },
      column: { type: 'string', description: '列名' },
      sheet: { type: 'string' },
      limit: { type: 'integer', description: '最多返回多少个不同值，按频次降序，默认 100', default: 100 }
    },
    required: ['file_id', 'column']
  }
}
```

#### spreadsheet_search

```js
{
  name: 'spreadsheet_search',
  description: '在文件中搜索包含指定文本的行，返回命中行号和内容。可限定在部分列中搜索。用于查找特定记录（如某个订单号、客户名）。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string' },
      query: { type: 'string', description: '搜索文本，大小写不敏感，子串匹配' },
      columns: { type: 'array', items: { type: 'string' }, description: '限定搜索的列名。不传则搜所有列' },
      sheet: { type: 'string' },
      limit: { type: 'integer', description: '最多返回命中行数，默认 50', default: 50 }
    },
    required: ['file_id', 'query']
  }
}
```

#### spreadsheet_aggregate

```js
{
  name: 'spreadsheet_aggregate',
  description: '对数据做分组聚合（类似 SQL 的 GROUP BY）。核心数据分析工具——回答"按门店的总营收"、"月均订单数 Top 5"、"某客户的总消费"这类问题时必须用它，千万不要读全表自己心算。支持先筛选再聚合再排序。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string' },
      sheet: { type: 'string' },
      group_by: {
        type: 'array',
        items: { type: 'string' },
        description: '分组列名数组。可空数组表示全表聚合（只出一行总计）'
      },
      metrics: {
        type: 'array',
        description: '聚合指标定义。每项含 column（要聚合的列）+ op（聚合方式）',
        items: {
          type: 'object',
          properties: {
            column: { type: 'string' },
            op: { type: 'string', enum: ['sum', 'avg', 'count', 'count_distinct', 'min', 'max'] }
          },
          required: ['column', 'op']
        }
      },
      filter: {
        type: 'array',
        description: '聚合前的行级筛选。多个条件之间为 AND 关系',
        items: {
          type: 'object',
          properties: {
            column: { type: 'string' },
            op: { type: 'string', enum: ['=', '!=', '>', '<', '>=', '<=', 'in', 'contains'] },
            value: { description: '筛选值。op=in 时传数组' }
          },
          required: ['column', 'op', 'value']
        }
      },
      order_by: {
        type: 'object',
        description: '排序依据。column 写聚合后字段名（如 "毛利_sum"），desc 默认 false',
        properties: {
          column: { type: 'string' },
          desc: { type: 'boolean', default: false }
        },
        required: ['column']
      },
      limit: { type: 'integer', description: '返回前 N 组，默认 50' }
    },
    required: ['file_id', 'group_by', 'metrics']
  }
}
```

#### spreadsheet_create_copy

```js
{
  name: 'spreadsheet_create_copy',
  description: '创建原文件的副本，进入可编辑状态。所有写操作（update/replace）必须先创建副本再操作，不能直接改原文件。返回 new_file_id，后续写工具都用这个新 ID。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: '原文件 ID' },
      note: { type: 'string', description: '可选的副本备注，方便用户识别' }
    },
    required: ['file_id']
  }
}
```

#### spreadsheet_replace_values

```js
{
  name: 'spreadsheet_replace_values',
  description: '对某一列做批量文本替换（多个 from→to 映射）。适用于"把门店名统一"、"把旧编码换成新编码"这类场景。只对精确匹配的单元格替换，不做模糊匹配。必须先 create_copy 得到 editing 状态的副本文件。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'editing 状态的副本文件 ID' },
      column: { type: 'string', description: '要替换的列名' },
      replacements: {
        type: 'array',
        description: '替换规则数组，每项 { from: 原值, to: 新值 }',
        items: {
          type: 'object',
          properties: { from: {}, to: {} },
          required: ['from', 'to']
        }
      },
      sheet: { type: 'string' }
    },
    required: ['file_id', 'column', 'replacements']
  }
}
```

#### spreadsheet_update_column

```js
{
  name: 'spreadsheet_update_column',
  description: '按行号修改某一列的内容。适用于"把第 3/5/8 行的状态列改为完成"这类指定行的批量修改。row_index 为 0-based 数据行（不含表头）。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'editing 状态的副本文件 ID' },
      column: { type: 'string' },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            row_index: { type: 'integer' },
            value: {}
          },
          required: ['row_index', 'value']
        }
      },
      sheet: { type: 'string' }
    },
    required: ['file_id', 'column', 'rows']
  }
}
```

#### spreadsheet_update_row

```js
{
  name: 'spreadsheet_update_row',
  description: '修改某一行的多个列（一次性更新整行的若干字段）。data 是 { 列名: 新值 } 的对象。row_index 为 0-based 数据行。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'editing 状态的副本文件 ID' },
      row_index: { type: 'integer' },
      data: {
        type: 'object',
        description: '{ 列名: 新值 } 映射，只改涉及的列'
      },
      sheet: { type: 'string' }
    },
    required: ['file_id', 'row_index', 'data']
  }
}
```

#### spreadsheet_update_cell

```js
{
  name: 'spreadsheet_update_cell',
  description: '修改单个单元格（指定行+列）。用于精准单点修改。大部分场景应优先用 replace_values / update_column / update_row。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'editing 状态的副本文件 ID' },
      row_index: { type: 'integer' },
      column: { type: 'string' },
      value: {},
      sheet: { type: 'string' }
    },
    required: ['file_id', 'row_index', 'column', 'value']
  }
}
```

#### spreadsheet_dry_run_patch

```js
{
  name: 'spreadsheet_dry_run_patch',
  description: '预览写操作的效果——不真改文件，返回会影响多少行、以及前 20 行的 before/after 对比。fuzzy 场景（门店名统一、类目合并）强烈建议先 dry_run 再真写。支持所有 patch_type：replace_values / update_column / update_row / update_cell。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'editing 状态的副本文件 ID' },
      patch_type: {
        type: 'string',
        enum: ['replace_values', 'update_column', 'update_row', 'update_cell']
      },
      patch_params: {
        type: 'object',
        description: '对应写工具的参数（除 file_id 外的所有字段）'
      }
    },
    required: ['file_id', 'patch_type', 'patch_params']
  }
}
```

#### spreadsheet_finish

```js
{
  name: 'spreadsheet_finish',
  description: '完成编辑，触发导出生成最终 xlsx 文件。调用后状态 editing → exporting → exported，对话中会出现 file_exported 事件，用户可下载。一旦 finish，此副本不可再改。',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'editing 状态的副本文件 ID' }
    },
    required: ['file_id']
  }
}
```

---

## 四、文件导出钩子

`createChatApp({ exportFile })` 接受宿主自定义导出器：

```js
createChatApp({
  exportFile: async ({ file, patches, baseUrl }) => {
    // 返回 { storage_path, download_url }
  }
});
```

默认内置导出器：读原文件 + 按顺序应用 patches → 写新 xlsx → 返回 `/uploads/xxx` 的相对 URL。

宿主可覆盖（比如要走 OSS/CDN）。

---

## 五、不做的事

- 不做 PDF/PPT 工具（本版只做 Excel）
- 不做前端 Excel 编辑器（所有操作通过 LLM + 工具完成）
- 不做跨 session 文件共享（文件严格属于 user_id）
- 不做合并单元格的高级处理（SheetJS 默认行为：值放左上，其余 null）

---

## 六、开发计划

分 5 个阶段，预估总工作量 ~5-7 天（一个 coding session 推一个 Phase）。

### Phase 1：@t2a/core 前置支撑（0.5-1 天）

**产物**：@t2a/core v0.7.0

**任务**：
- [ ] `ToolRegistry.register` 接受新字段：`permission` / `group` / `tags` / `requires`
- [ ] `ToolRegistry.merge(otherRegistry)` 支持两个 registry 合并
- [ ] `ToolRegistry.getSchemas({ user, sessionCtx })` 输出过滤后的 schema 列表（内部按 permission + requires + filter 过滤）
- [ ] `ToolRegistry.listDefs()` 返回所有工具定义（含元数据，供 toolsMeta 派生）
- [ ] 单测覆盖 permission 过滤、merge、requires
- [ ] npm publish @t2a/core@0.7.0

**验收**：t2a-chat 能升级到 core 0.7.0 并跑通现有单测

---

### Phase 2：文件体系基建（1-1.5 天）

**产物**：上传带 conversation_id → chat_files 落库 → WS 触发 system_event

**任务**：
- [ ] `scripts/init-schema.sql` 新增 `chat_files` 和 `chat_file_patches` 表
- [ ] `src/db-chat-files.js` 新模块：createFile / getFile / listByConversation / updateStatus / createCopy / appendPatch / listPatches
- [ ] `src/upload-routes.js` 改造：
  - [ ] 增加 `conversation_id` 字段校验
  - [ ] 上传成功后写 chat_files（status=uploaded）
  - [ ] 同步解析 metadata（excel 用 SheetJS 读 header + rows/cols/sheets）→ status=ready
  - [ ] 返回 `{ file_id, metadata }`
- [ ] `src/ws-server.js` 新增 `attach_file` 消息类型：校验 ownership → 调 `session.pushSystemEvent({ type: 'file_uploaded', ... })`
- [ ] `.excel-text` 兼容保留（buildContentFromAttachments 不删，加 `file_ref` 分支）
- [ ] 单测：上传 xlsx → 查表 → 模拟 attach_file → 验证 system_event 进入 t2a_messages

**验收**：curl 上传 xlsx → DB 里看到 chat_files 行 → WS 发 attach_file → 对话历史里有 system_event

---

### Phase 3：前端文件协议 + UI（1 天）

**产物**：前端输入区文件卡片 + 消息气泡 file_ref 渲染 + system_event 通知气泡

**任务**：
- [ ] `public/attachment-manager.js`：
  - [ ] Excel/CSV 上传后存 `{ kind: 'file_ref', file_id, file_name, mime_type, file_size }`
  - [ ] 删除 SheetJS 前端解析路径（改为纯上传）
  - [ ] 上传成功后自动发 WS `attach_file` 消息
- [ ] `public/chat.js` / `public/chat.css`：
  - [ ] 输入区文件 chip 样式（Excel 图标 + 文件名 + × 删除）
  - [ ] 用户气泡识别 `file_ref` → 渲染文件卡片（附件图标 + 文件名 + 大小）
  - [ ] system_event 通知气泡样式（`file_uploaded` → "📎 已上传 XX.xlsx"，可折叠）
- [ ] 手动测试：上传 xlsx → 气泡正确展示 → 发送消息后 user 气泡带文件卡片

**验收**：UI 录屏——上传、发送、气泡、通知 4 个状态都正常

---

### Phase 4：Tool 体系增强 + Excel 读工具（1.5 天）

**产物**：t2a-chat 支持 permission + filter + 内置 Excel 读工具可用

**任务**：
- [ ] `src/index.js` createChatApp 增加 `checkToolPermission` 参数
- [ ] `src/session-pool.js`：构造 LLM tools 时调 `registry.getSchemas({ user, sessionCtx })`，sessionCtx 含 `files` + `hasFileOfKind`
- [ ] `src/routes-tools.js` toolsMeta 自动从 `registry.listDefs()` 派生（宿主显式传则覆盖）
- [ ] `src/builtin-tools/spreadsheet.js` 新文件，暴露 `spreadsheet(deps)` 工厂
- [ ] `src/builtin-tools/xlsx-helper.js`：封装 SheetJS 读文件、校验 ownership、缓存已解析数据
- [ ] 实现 8 个读工具（按 3.5 节 schema）：
  - [ ] spreadsheet_inspect
  - [ ] spreadsheet_row_count
  - [ ] spreadsheet_read_all（单元格数 ≤ 2w）
  - [ ] spreadsheet_read_columns
  - [ ] spreadsheet_read_rows
  - [ ] spreadsheet_column_values
  - [ ] spreadsheet_search
  - [ ] spreadsheet_aggregate（SheetJS 读全表 + JS reduce；filter → group_by → metrics → order_by → limit）
- [ ] 所有工具注册时声明 `requires: { fileKind: 'excel' }`
- [ ] 单测：每个读工具用一个固定 xlsx fixture 跑一遍

**验收**：
- session 无 xlsx 文件时 LLM tools 列表不含 spreadsheet_*
- 有文件时能跑通 inspect / aggregate 的代表性 case
- 未登录用户工具列表为空（permission 生效）

---

### Phase 5：Excel 写工具 + finish 流程（1 天）

**产物**：副本三态完整流转，finish 后生成可下载的新 xlsx

**任务**：
- [ ] 5 个写工具（按 3.5 节 schema）：
  - [ ] spreadsheet_create_copy（复制 chat_files 行 + storage 复制）
  - [ ] spreadsheet_replace_values
  - [ ] spreadsheet_update_column
  - [ ] spreadsheet_update_row
  - [ ] spreadsheet_update_cell
- [ ] 写工具统一通过 `appendPatch(file_id, patch_type, patch_params)` 写 `chat_file_patches`，不直接改 storage
- [ ] spreadsheet_dry_run_patch：复用写工具的底层计算函数但不持久化，返回 affected_rows + before/after 前 20 行
- [ ] spreadsheet_finish：
  - [ ] 状态 editing → exporting
  - [ ] 调 `deps.exportFile`（若宿主传入）或默认导出器
  - [ ] 默认导出器：读原文件 + 顺序应用 patches → 写新 xlsx → 填 download_url → 状态 exporting → exported
  - [ ] 发 `file_exported` system_event（含 download_url）
- [ ] 前端：`file_exported` 事件渲染下载按钮
- [ ] 单测：create_copy → replace_values → dry_run_patch → finish → 下载产物对比预期

**验收**：完整跑一遍「乔薇尔对账表门店名统一」流程产出新 xlsx

---

### Phase 6：Imagine v2.11.0 联调（0.5 天）

**产物**：Imagine 升级并跑通端到端流程

- 见 `projects/img-gen-tool/versions/v2.11.0/PLAN.md` 第六节开发顺序
- t2a-chat 这边只需：
  - [ ] npm publish @t2a/chat@0.8.0
  - [ ] 配合 Imagine 调试文件上传目录环境变量
  - [ ] 联调未登录/登录两种场景

---

### 工作量估算

| Phase | 估时 | 依赖 |
|-------|------|------|
| 1. @t2a/core 升级 | 0.5-1d | 无 |
| 2. 文件体系基建 | 1-1.5d | Phase 1 |
| 3. 前端文件 UI | 1d | Phase 2 |
| 4. Tool 增强 + 读工具 | 1.5d | Phase 1, 2 |
| 5. 写工具 + finish | 1d | Phase 4 |
| 6. Imagine 联调 | 0.5d | Phase 5 + Imagine v2.11.0 |
| **合计** | **5.5-7d** | |

Phase 3 可与 Phase 2 并行（不同 session），其余串行。

---

## 七、验证标准

- ✅ 用户在 Imagine chat 上传 xlsx → LLM 收到 `file_uploaded` system_event → 调 `spreadsheet_inspect` 正确返回表结构
- ✅ LLM 调 `spreadsheet_read_rows(start=0, end=100)` 返回前 100 行，不炸 token
- ✅ LLM 调 `spreadsheet_column_values` 返回筛选项 + 每个值的 count
- ✅ LLM 调 `spreadsheet_aggregate({ group_by: ['门店'], metrics: [{ column: '毛利', op: 'sum' }], order_by: { column: '毛利_sum', desc: true }, limit: 5 })` 返回 Top 5 门店
- ✅ LLM 调 `spreadsheet_dry_run_patch` 返回 affected_rows + before/after 预览，不实际改文件
- ✅ LLM 调 `create_copy → replace_values → finish` → 收到 `file_exported` 事件 → 前端可下载新 xlsx
- ✅ Imagine 的 Excel 文件不会被前端解析成 CSV 塞进 user message
- ✅ 未登录用户看不到 `auth_required` 工具
- ✅ Session 无 xlsx 文件时，LLM tools 列表里没有 spreadsheet_* 工具

---

## 八、配套 @t2a/core 依赖

需要 t2a-core 配合补：

- `ToolRegistry.getSchemas({ user, sessionCtx })`：应用 permission + filter 输出过滤后的 schema 列表
- `ToolRegistry.merge(otherRegistry)`：合并两个 registry（用于内置工具合并宿主工具）
- 工具定义新增可选字段：`permission`, `group`, `tags`, `requires`

若 t2a-core 当前版本不支持，本版需先发 t2a-core 0.7.0。
