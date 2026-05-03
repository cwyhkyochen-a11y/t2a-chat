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
