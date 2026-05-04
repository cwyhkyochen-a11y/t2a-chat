// task-registry.js — Task Type 注册表
// 宿主通过 createChatApp({ taskTypes }) 注册，此模块负责校验、查询、持久化

const crypto = require('crypto');

let db = null;

function init(dbInstance) {
  db = dbInstance;
}

/**
 * Task Type 注册表
 * 保存宿主注入的 taskTypes 配置，提供查询 + 创建 + 取消 + 状态更新能力
 */
class TaskRegistry {
  /**
   * @param {object} taskTypes - 宿主注入的 task type 定义
   * @param {object} modelRouter - 模型路由配置
   */
  constructor(taskTypes = {}, modelRouter = {}) {
    this._types = taskTypes;
    this._modelRouter = modelRouter;
  }

  /** 获取所有已注册的 task type key */
  getTypeKeys() {
    return Object.keys(this._types);
  }

  /** 获取某个 type 的完整定义 */
  getType(typeKey) {
    return this._types[typeKey] || null;
  }

  /** 验证 type 是否已注册 */
  hasType(typeKey) {
    return typeKey in this._types;
  }

  /** 获取所有 models（可按 taskType 过滤） */
  getModels(taskType) {
    if (taskType) {
      const t = this._types[taskType];
      if (!t) return [];
      return (t.models || []).map(m => ({ ...m, taskType }));
    }
    // 聚合所有
    const result = [];
    for (const [key, def] of Object.entries(this._types)) {
      if (def.models && Array.isArray(def.models)) {
        for (const m of def.models) {
          result.push({ ...m, taskType: key });
        }
      }
    }
    return result;
  }

  /** 获取某 task type 的默认模型 */
  getDefaultModel(taskType) {
    // 优先从 modelRouter.defaults 查
    if (this._modelRouter.defaults && this._modelRouter.defaults[taskType]) {
      return this._modelRouter.defaults[taskType];
    }
    // fallback: taskType 自身的 defaultModel
    const t = this._types[taskType];
    return t ? (t.defaultModel || null) : null;
  }

  /** 获取 modelRouter 配置（供前端/admin 使用） */
  getModelRouter() {
    return {
      defaults: this._modelRouter.defaults || {},
      rules: this._modelRouter.rules || [],
    };
  }

  // ---- 持久化操作 ----

  /** 创建 task 记录 */
  createTask({ conversationId, userId, type, params, model }) {
    const id = generateTaskId();
    const now = Date.now();
    db.prepare(`
      INSERT INTO tasks (id, conversation_id, user_id, type, status, params_json, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(id, conversationId || null, userId || null, type, JSON.stringify(params || {}), model || null, now, now);
    return id;
  }

  /** 获取单个 task */
  getTask(taskId) {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!row) return null;
    return parseTaskRow(row);
  }

  /** 列表查询（按 conversationId 或 userId） */
  listTasks({ conversationId, userId, status, limit = 50, offset = 0 }) {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    if (conversationId != null) { sql += ' AND conversation_id = ?'; params.push(conversationId); }
    if (userId != null) { sql += ' AND user_id = ?'; params.push(userId); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params).map(parseTaskRow);
  }

  /** 更新 task 状态 */
  updateTaskStatus(taskId, status, extra = {}) {
    const sets = ['status = ?', 'updated_at = ?'];
    const params = [status, Date.now()];
    if (extra.result !== undefined) { sets.push('result_json = ?'); params.push(JSON.stringify(extra.result)); }
    if (extra.error !== undefined) { sets.push('error = ?'); params.push(extra.error); }
    if (status === 'cancelled') { sets.push('cancelled_at = ?'); params.push(Date.now()); }
    params.push(taskId);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  /** 取消 task（调宿主 cancel + 更新 DB） */
  async cancelTask(taskId, ctx) {
    const task = this.getTask(taskId);
    if (!task) return { ok: false, error: 'task not found' };
    if (task.status === 'cancelled' || task.status === 'success' || task.status === 'failed') {
      return { ok: false, error: `task already ${task.status}` };
    }
    const typeDef = this._types[task.type];
    // 调宿主 cancel 回调
    if (typeDef && typeof typeDef.cancel === 'function') {
      try {
        await typeDef.cancel(taskId, ctx);
      } catch (err) {
        console.error('[task-registry] cancel callback error:', err.message);
      }
    }
    // 更新 DB
    this.updateTaskStatus(taskId, 'cancelled');
    return { ok: true, task: this.getTask(taskId) };
  }
}

// ---- 辅助 ----

function generateTaskId() {
  return 'tsk_' + crypto.randomBytes(12).toString('hex');
}

function parseTaskRow(row) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    user_id: row.user_id,
    type: row.type,
    status: row.status,
    params: safeJsonParse(row.params_json),
    result: safeJsonParse(row.result_json),
    error: row.error,
    model: row.model,
    created_at: row.created_at,
    updated_at: row.updated_at,
    cancelled_at: row.cancelled_at,
  };
}

function safeJsonParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

module.exports = { TaskRegistry, init };
