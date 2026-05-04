const { readBody, jsonRes } = require('./utils');

function maskApiKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (/api_key/i.test(key) && typeof result[key] === 'string' && result[key].length > 8) {
      result[key] = result[key].slice(0, 4) + '****' + result[key].slice(-4);
    }
  }
  return result;
}

async function handle(req, res, ctx, adminBasePath) {
  const fullUrl = req.url || '';
  const [pathname, queryString] = fullUrl.split('?');
  const prefix = '/api/' + adminBasePath.replace(/^\//, '') + '/';
  const subPath = pathname.slice(prefix.length - 1); // keeps leading /
  const method = req.method;
  const params = new URLSearchParams(queryString || '');

  try {
    // --- Config ---
    if (subPath === '/config' && method === 'GET') {
      const config = await ctx.dbConfig.getAgentConfig();
      return jsonRes(res, 200, maskApiKeys(config));
    }
    if (subPath === '/config' && method === 'PUT') {
      const body = await readBody(req);
      const data = typeof body === 'string' || Buffer.isBuffer(body) ? JSON.parse(body.toString()) : body;
      // T3: 默认模型仅可从宿主注入的枚举中选
      if (data.model && ctx.taskRegistry) {
        const allModels = ctx.taskRegistry.getModels();
        if (allModels.length > 0 && !allModels.find(m => m.id === data.model)) {
          return jsonRes(res, 400, { error: `model "${data.model}" 不在已注册的枚举中` });
        }
      }
      const cur = ctx.dbConfig.getAgentConfig();
      if (cur) ctx.dbConfig.updateAgentConfig(cur.id, data);
      return jsonRes(res, 200, { ok: true });
    }

    // --- Models (枚举查询，供 admin 选择默认模型) ---
    if (subPath === '/models' && method === 'GET') {
      if (!ctx.taskRegistry) return jsonRes(res, 200, { models: [], defaults: {} });
      const taskType = params.get('taskType');
      return jsonRes(res, 200, {
        models: ctx.taskRegistry.getModels(taskType || undefined),
        defaults: ctx.taskRegistry.getModelRouter().defaults,
      });
    }

    // --- Overflow ---
    if (subPath === '/overflow' && method === 'GET') {
      const overflow = await ctx.dbConfig.getOverflowConfig();
      return jsonRes(res, 200, overflow);
    }
    if (subPath === '/overflow' && method === 'PUT') {
      const body = await readBody(req);
      await ctx.dbConfig.updateOverflowConfig(body);
      return jsonRes(res, 200, { ok: true });
    }

    // --- Settings ---
    if (subPath === '/settings' && method === 'GET') {
      const settings = await ctx.dbConfig.getAllSettings();
      const masked = settings.map(s => {
        if (/api_key/i.test(s.key) && typeof s.value === 'string' && s.value.length > 8) {
          return { ...s, value: s.value.slice(0, 4) + '****' + s.value.slice(-4) };
        }
        return s;
      });
      return jsonRes(res, 200, masked);
    }
    if (subPath === '/settings' && method === 'PUT') {
      const body = await readBody(req);
      const entries = Array.isArray(body) ? body : Object.entries(body).map(([k, v]) => ({ key: k, value: v }));
      for (const { key, value } of entries) {
        await ctx.dbConfig.setSetting(key, value);
      }
      return jsonRes(res, 200, { ok: true });
    }

    // --- Tools ---
    if (subPath === '/tools' && method === 'GET') {
      const registry = ctx.tools({ userId: 'admin', conversationId: null, baseUrl: '' });
      const tools = registry.toOpenAITools();
      return jsonRes(res, 200, tools);
    }

    // --- Tasks (admin 查看所有 task) ---
    if (subPath === '/tasks' && method === 'GET') {
      if (!ctx.taskRegistry) return jsonRes(res, 200, { data: [], total: 0 });
      const limit = Math.min(200, parseInt(params.get('limit') || '50', 10));
      const offset = parseInt(params.get('offset') || '0', 10);
      const status = params.get('status') || undefined;
      const data = ctx.taskRegistry.listTasks({ status, limit, offset });
      return jsonRes(res, 200, { data });
    }

    // --- Sessions ---
    if (subPath === '/sessions' && method === 'GET') {
      const page = Math.max(1, parseInt(params.get('page') || '1', 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(params.get('pageSize') || '20', 10)));
      const offset = (page - 1) * pageSize;

      const rows = ctx.db.prepare(`
        SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at,
          (SELECT COUNT(*) FROM t2a_messages WHERE session_id = CAST(c.id AS TEXT) AND deleted_at IS NULL) as message_count
        FROM conversations c ORDER BY c.updated_at DESC LIMIT ? OFFSET ?
      `).all(pageSize, offset);

      const total = ctx.db.prepare('SELECT COUNT(*) as cnt FROM conversations').get().cnt;
      return jsonRes(res, 200, { data: rows, total, page, pageSize });
    }

    const sessMatch = subPath.match(/^\/sessions\/([^/]+)$/);
    if (sessMatch && method === 'GET') {
      const id = sessMatch[1];
      const messages = ctx.db.prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      ).all(id);
      const conv = ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
      if (!conv) return jsonRes(res, 404, { error: 'not found' });
      return jsonRes(res, 200, { conversation: conv, messages });
    }
    if (sessMatch && method === 'DELETE') {
      const id = sessMatch[1];
      ctx.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
      ctx.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
      // clean up t2a tables if they exist
      try { ctx.db.prepare('DELETE FROM t2a_messages WHERE conversation_id = ?').run(id); } catch (_) {}
      try { ctx.db.prepare('DELETE FROM t2a_sessions WHERE conversation_id = ?').run(id); } catch (_) {}
      return jsonRes(res, 200, { ok: true });
    }

    // --- LLM Providers ---
    if (subPath === '/llm-providers' && method === 'GET') {
      const providers = await ctx.dbChatLLM.getChatLLMProvidersMasked();
      return jsonRes(res, 200, providers);
    }
    if (subPath === '/llm-providers' && method === 'POST') {
      const body = await readBody(req);
      const result = await ctx.dbChatLLM.createChatLLMProvider(body);
      return jsonRes(res, 201, result);
    }

    const llmMatch = subPath.match(/^\/llm-providers\/([^/]+)$/);
    if (llmMatch && method === 'PUT') {
      const body = await readBody(req);
      const result = await ctx.dbChatLLM.updateChatLLMProvider(llmMatch[1], body);
      return jsonRes(res, 200, result);
    }
    if (llmMatch && method === 'DELETE') {
      await ctx.dbChatLLM.deleteChatLLMProvider(llmMatch[1]);
      return jsonRes(res, 200, { ok: true });
    }

    // --- 404 ---
    return jsonRes(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[admin-routes]', err);
    return jsonRes(res, 500, { error: err.message || 'internal error' });
  }
}

module.exports = { handle };
