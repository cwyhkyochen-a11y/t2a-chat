// routes-user-settings.js — 用户级 model 偏好（按 taskType 动态遍历）
//
// GET  /api/{basePath}/user-settings  → { default_image_model: '...', default_video_model: '...', ... }
// PUT  /api/{basePath}/user-settings  → 保存 default_${taskType}_model 字段
//
// 偏好键命名约定：default_${taskType}_model
// taskType 列表来自 taskRegistry（宿主在 createChatApp 时通过 taskTypes 声明）
// 工具调用时由宿主自己读 dbConfig.getSetting() 注入到 LLM tool args

const { jsonRes, readBody } = require('./utils');

function createUserSettingsRouter(basePath) {
  const prefix = '/api/' + String(basePath || '/chat').replace(/^\//, '');
  const targetUrl = prefix + '/user-settings';

  return async function handle(req, res, ctx) {
    const url = req.url.split('?')[0];
    if (url !== targetUrl) return false;

    // 鉴权
    const user = await ctx.resolveUser(req);
    if (!user) {
      jsonRes(res, 401, { error: 'Unauthorized' });
      return true;
    }

    // 收集所有已注册的 taskType
    const taskTypeKeys = ctx.taskRegistry && typeof ctx.taskRegistry.getTypeKeys === 'function'
      ? ctx.taskRegistry.getTypeKeys() : [];

    if (req.method === 'GET') {
      const out = {};
      for (const t of taskTypeKeys) {
        const k = 'default_' + t + '_model';
        out[k] = ctx.dbConfig.getSetting(k) || '';
      }
      jsonRes(res, 200, out);
      return true;
    }

    if (req.method === 'PUT') {
      let body = {};
      try { body = JSON.parse((await readBody(req)).toString() || '{}'); }
      catch (e) { jsonRes(res, 400, { error: 'invalid JSON' }); return true; }

      // 只接受 default_${taskType}_model 格式的字段，且 taskType 必须已注册
      const allowed = new Set(taskTypeKeys.map(t => 'default_' + t + '_model'));
      for (const [k, v] of Object.entries(body)) {
        if (allowed.has(k)) {
          ctx.dbConfig.setSetting(k, v == null ? '' : String(v));
        }
      }
      jsonRes(res, 200, { ok: true });
      return true;
    }

    jsonRes(res, 405, { error: 'method not allowed' });
    return true;
  };
}

module.exports = { createUserSettingsRouter };
