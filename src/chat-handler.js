// chat-handler.js — 简化入口
// POST /api/chat 只负责创建/验证对话，返回 JSON
// 实际流式推送走 ws-server.js
//
// v0.2.0: auth 改为 ctx.resolveUser(req)，不再传 user_password

const { readBody, jsonRes } = require('./utils');

// POST /api/chat — 创建/验证对话
async function handleChat(req, res, ctx) {
  const { resolveUser, dbChat, dbConfig } = ctx;
  try {
    const user = await resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const body = JSON.parse((await readBody(req)).toString());
    const { conversation_id, message, image_url } = body;
    if (!message && !image_url) return jsonRes(res, 400, { error: 'message or image_url is required' });
    if (!dbConfig.getAgentConfig()) return jsonRes(res, 500, { error: 'Agent 未配置，请在管理后台配置' });

    let convId = conversation_id;
    if (convId) {
      const conv = dbChat.getConversation(convId);
      if (!conv) return jsonRes(res, 404, { error: '对话不存在' });
      if (conv.user_id !== user.id) return jsonRes(res, 403, { error: '无权访问此对话' });
    } else {
      const title = (message || '图片对话').slice(0, 20) + ((message || '').length > 20 ? '...' : '');
      convId = dbChat.createConversation(user.id, title);
    }
    return jsonRes(res, 200, { ok: true, conversation_id: convId });
  } catch (err) {
    console.error('[chat] Error:', err);
    return jsonRes(res, 500, { error: err.message });
  }
}

// POST /api/chat/:id/interrupt
async function handleInterrupt(req, res, ctx, conversationId) {
  const { resolveUser, dbChat, sessionPool } = ctx;
  try {
    const user = await resolveUser(req);
    if (!user) return jsonRes(res, 401, { error: 'Unauthorized' });
    const conv = dbChat.getConversation(conversationId);
    if (!conv) return jsonRes(res, 404, { error: '对话不存在' });
    if (conv.user_id !== user.id) return jsonRes(res, 403, { error: '无权操作此对话' });
    const session = sessionPool.peek(String(conversationId));
    if (!session) return jsonRes(res, 200, { ok: true, note: 'session not active' });
    session.interrupt('user');
    return jsonRes(res, 200, { ok: true });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

module.exports = { handleChat, handleInterrupt };
