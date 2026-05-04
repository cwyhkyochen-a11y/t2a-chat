// task-routes.js — Task 相关 REST endpoints
//
// POST   /api/{basePath}/tasks                — 创建 task
// GET    /api/{basePath}/tasks                — 列出 task（按 conversation_id/user_id 过滤）
// GET    /api/{basePath}/tasks/:id            — 单个 task 详情
// POST   /api/{basePath}/tasks/:id/cancel     — 取消 task
// GET    /api/{basePath}/models               — 列出所有 model（可按 taskType 过滤）
// GET    /api/{basePath}/config/ui            — UI 配置（sidebarLinks + branding）

const { readBody, jsonRes } = require('./utils');

/**
 * 路由分发
 * @param {object} ctx - 含 resolveUser/taskRegistry/sessionPool/branding/sidebarLinks
 * @param {string} basePath
 */
async function handle(req, res, ctx, basePath) {
  const url = req.url.split('?')[0];
  const method = req.method;
  const prefix = '/api/' + basePath.replace(/^\//, '');

  // GET /api/{basePath}/models
  if (url === prefix + '/models' && method === 'GET') {
    return handleListModels(req, res, ctx);
  }

  // GET /api/{basePath}/config/ui
  if (url === prefix + '/config/ui' && method === 'GET') {
    return handleGetUIConfig(req, res, ctx);
  }

  // POST /api/{basePath}/tasks
  if (url === prefix + '/tasks' && method === 'POST') {
    return handleCreateTask(req, res, ctx);
  }
  // GET /api/{basePath}/tasks
  if (url === prefix + '/tasks' && method === 'GET') {
    return handleListTasks(req, res, ctx);
  }

  // /api/{basePath}/tasks/:id 或 /tasks/:id/cancel
  const taskMatch = url.match(new RegExp('^' + escapeRegex(prefix) + '/tasks/([^/]+)(/cancel)?$'));
  if (taskMatch) {
    const taskId = taskMatch[1];
    const isCancel = !!taskMatch[2];
    if (isCancel && method === 'POST') return handleCancelTask(req, res, ctx, taskId);
    if (!isCancel && method === 'GET') return handleGetTask(req, res, ctx, taskId);
  }

  return false; // 不匹配
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- Handlers ----

async function handleCreateTask(req, res, ctx) {
  try {
    const user = await ctx.resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const body = JSON.parse((await readBody(req)).toString());
    const { type, params, conversation_id, model } = body;

    if (!type) return jsonRes(res, 400, { error: 'type is required' });
    if (!ctx.taskRegistry.hasType(type)) {
      return jsonRes(res, 400, { error: `unknown task type: ${type}` });
    }

    const typeDef = ctx.taskRegistry.getType(type);
    const usedModel = model || ctx.taskRegistry.getDefaultModel(type);

    // 创建 DB 记录
    const taskId = ctx.taskRegistry.createTask({
      conversationId: conversation_id ? Number(conversation_id) : null,
      userId: user.id,
      type,
      params: params || {},
      model: usedModel,
    });

    // 调宿主 create 回调（异步，不阻塞返回）
    const hostCtx = {
      taskId,
      user,
      conversationId: conversation_id ? Number(conversation_id) : null,
      model: usedModel,
      sessionPool: ctx.sessionPool,
      taskRegistry: ctx.taskRegistry,
    };

    if (typeof typeDef.create === 'function') {
      // 异步触发，不等待
      Promise.resolve()
        .then(() => typeDef.create(params || {}, hostCtx))
        .then(result => {
          // 宿主可以在 create 内部直接调用 updateTaskStatus
          // 这里如果返回了 result 且状态还是 pending，自动标 success
          if (result !== undefined) {
            const cur = ctx.taskRegistry.getTask(taskId);
            if (cur && cur.status === 'pending') {
              ctx.taskRegistry.updateTaskStatus(taskId, 'success', { result });
            }
          }
        })
        .catch(err => {
          console.error('[task-routes] create callback error:', err.message);
          ctx.taskRegistry.updateTaskStatus(taskId, 'failed', { error: err.message });
        });
    }

    const task = ctx.taskRegistry.getTask(taskId);
    return jsonRes(res, 200, { ok: true, task });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleListTasks(req, res, ctx) {
  try {
    const user = await ctx.resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    const conversationId = url.searchParams.get('conversation_id');
    const status = url.searchParams.get('status');
    const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const tasks = ctx.taskRegistry.listTasks({
      userId: user.id,
      conversationId: conversationId ? Number(conversationId) : undefined,
      status: status || undefined,
      limit,
      offset,
    });
    return jsonRes(res, 200, { data: tasks });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleGetTask(req, res, ctx, taskId) {
  try {
    const user = await ctx.resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const task = ctx.taskRegistry.getTask(taskId);
    if (!task) return jsonRes(res, 404, { error: 'task not found' });
    if (task.user_id != null && task.user_id !== user.id) {
      return jsonRes(res, 403, { error: '无权访问此任务' });
    }
    // 给宿主一个机会刷新状态（getStatus 回调）
    const typeDef = ctx.taskRegistry.getType(task.type);
    if (typeDef && typeof typeDef.getStatus === 'function' && (task.status === 'pending' || task.status === 'running')) {
      try {
        const fresh = await typeDef.getStatus(taskId, { user, taskRegistry: ctx.taskRegistry });
        if (fresh && fresh.status && fresh.status !== task.status) {
          ctx.taskRegistry.updateTaskStatus(taskId, fresh.status, {
            result: fresh.result,
            error: fresh.error,
          });
        }
      } catch (err) {
        console.error('[task-routes] getStatus callback error:', err.message);
      }
    }
    return jsonRes(res, 200, ctx.taskRegistry.getTask(taskId));
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleCancelTask(req, res, ctx, taskId) {
  try {
    const user = await ctx.resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const task = ctx.taskRegistry.getTask(taskId);
    if (!task) return jsonRes(res, 404, { error: 'task not found' });
    if (task.user_id != null && task.user_id !== user.id) {
      return jsonRes(res, 403, { error: '无权操作此任务' });
    }

    const result = await ctx.taskRegistry.cancelTask(taskId, {
      user,
      sessionPool: ctx.sessionPool,
    });
    if (!result.ok) return jsonRes(res, 400, { error: result.error });

    // 自动 push system_event 到对应会话（如果有）
    if (task.conversation_id != null) {
      try {
        const session = ctx.sessionPool.peek(String(task.conversation_id));
        if (session && typeof session.pushSystemEvent === 'function') {
          // 注意：放弃回参（不打断 LLM 生成），所以不写 trigger_agent
          await session.pushSystemEvent({
            source: 'task_cancelled',
            payload: {
              taskId,
              taskType: task.type,
              reason: 'user_cancelled',
            },
          });
        }
      } catch (err) {
        console.error('[task-routes] pushSystemEvent failed:', err.message);
      }
    }

    return jsonRes(res, 200, { ok: true, task: result.task });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleListModels(req, res, ctx) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const taskType = url.searchParams.get('taskType');
    const models = ctx.taskRegistry.getModels(taskType || undefined);
    return jsonRes(res, 200, {
      models,
      defaults: ctx.taskRegistry.getModelRouter().defaults,
    });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

function handleGetUIConfig(req, res, ctx) {
  return jsonRes(res, 200, {
    sidebarLinks: ctx.sidebarLinks || [],
    branding: ctx.branding || {},
  });
}

module.exports = { handle };
