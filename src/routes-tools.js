// routes-tools.js — Tools 元数据 REST endpoint
//
// GET /api/{basePath}/tools  → { tools: [...] }
//
// Tools 数据来源于宿主在 createChatApp({ toolsMeta: [...] }) 时传入的数组。
// 如果未传入则返回空数组。

const { jsonRes } = require('./utils');

/**
 * 创建 tools 路由处理器
 * @param {Array} toolsMeta - 工具元数据数组（引用，宿主可后续修改）
 * @param {string} basePath - chat 基础路径
 * @returns {function} (req, res) => boolean | undefined  匹配则处理并返回 true，否则返回 false
 */
function createToolsRouter(toolsMeta, basePath) {
  const prefix = '/api/' + String(basePath || '/chat').replace(/^\//, '');
  const targetUrl = prefix + '/tools';

  return function handle(req, res) {
    const url = req.url.split('?')[0];
    if (url !== targetUrl) return false;
    if (req.method !== 'GET') {
      jsonRes(res, 405, { error: 'method not allowed' });
      return true;
    }
    const list = Array.isArray(toolsMeta) ? toolsMeta : [];
    // 标准化每一项，避免脏数据
    const tools = list.map(function (t) {
      return {
        name: String(t && t.name || ''),
        description: String(t && t.description || ''),
        group: t && t.group ? String(t.group) : '',
        tags: Array.isArray(t && t.tags) ? t.tags.map(String) : [],
      };
    }).filter(function (t) { return t.name; });
    jsonRes(res, 200, { tools: tools });
    return true;
  };
}

module.exports = { createToolsRouter };
