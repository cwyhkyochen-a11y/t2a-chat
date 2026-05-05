// 业务系统接入 t2a-chat 示例配置
const { ToolRegistry } = require('@t2a/core');

module.exports = {
  auth: (password) => {
    return password === 'demo' ? { id: 1, name: 'demo' } : null;
  },
  adminAuth: (req) => {
    const auth = req.headers.authorization;
    return auth === 'Bearer admin-token';
  },
  tools: ({ userId, conversationId, baseUrl }) => {
    const registry = new ToolRegistry();
    return registry;
  },
  basePath: '/chat',
  adminBasePath: '/chat-admin',
};

/*
 * 上传配置（v0.5.0 附件功能）
 *
 * TCHAT_UPLOAD_API_URL=          # 业务系统覆盖；默认空 = 走内置 /api/chat/upload
 * TCHAT_UPLOAD_BASE_URL=         # url 前缀（CDN 等），默认空 = 相对路径
 * TCHAT_UPLOAD_MAX_MB=20         # 单文件上限
 * TCHAT_UPLOAD_DIR=./data/uploads # 内置存储目录
 *
 * 业务系统提供上传接口的契约（如果覆盖 TCHAT_UPLOAD_API_URL）：
 *   POST {TCHAT_UPLOAD_API_URL}
 *   multipart/form-data: file=<binary>, kind=image|video|excel
 *   → 200 { url, filename, size, kind }
 */
