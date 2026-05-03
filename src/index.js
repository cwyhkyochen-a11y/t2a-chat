// t2a-chat 主入口
// createChatApp(options) → { attachToServer, pushSystemEvent, getSessionPool }

const { initWebSocket, pushToConversation } = require('./ws-server');
const { SessionPool } = require('./session-pool');
const { readBody, jsonRes } = require('./utils');
const dbChat = require('./db-chat');
const dbChatLLM = require('./db-chat-llm');
const dbConfig = require('./db-config');
const storageModule = require('./storage');

function checkAdminAuth(req, adminAuth) {
  if (!adminAuth) return false;
  return adminAuth(req);
}

function createChatApp(options) {
  const {
    db,              // better-sqlite3 实例
    auth,            // (password) => { id, name } | null
    adminAuth,       // (req) => boolean
    tools,           // ({ userId, conversationId, baseUrl }) => ToolRegistry
    systemEventTemplate, // 可选
    basePath = '/chat',
    adminBasePath = '/chat-admin',
  } = options;

  // 初始化数据层
  dbChat.init(db);
  dbChatLLM.init(db);
  dbConfig.init(db);
  storageModule.init(db);

  // 初始化 schema（如果表不存在）
  const fs = require('fs');
  const path = require('path');
  const schemaPath = path.join(__dirname, '..', 'scripts', 'init-schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
  }

  // Session Pool
  const sessionPool = new SessionPool({ db, dbConfig, dbChatLLM, tools, systemEventTemplate });

  // 构建路由表
  const chatHandler = require('./chat-handler');
  const chatRoutes = require('./chat-routes');
  const adminRoutes = require('./admin-routes');

  function attachToServer(server) {
    // WebSocket
    const wss = initWebSocket(server, { db, dbChat, dbConfig, dbChatLLM, auth, sessionPool, basePath });

    return {
      wss,
      handleRequest: createRequestHandler({
        auth, adminAuth, basePath, adminBasePath,
        chatHandler, chatRoutes, adminRoutes,
        db, dbChat, dbConfig, dbChatLLM, sessionPool, tools,
      }),
    };
  }

  function pushSystemEvent(conversationId, eventInput) {
    const session = sessionPool.peek(String(conversationId));
    if (!session) return Promise.resolve();
    return session.pushSystemEvent(eventInput);
  }

  return {
    attachToServer,
    pushSystemEvent,
    getSessionPool: () => sessionPool,
    // 暴露给宿主的数据层
    db: { chat: dbChat, llm: dbChatLLM, config: dbConfig },
  };
}

function createRequestHandler(deps) {
  const { auth, adminAuth, basePath, adminBasePath, chatHandler, chatRoutes, adminRoutes, db, dbChat, dbConfig, dbChatLLM, sessionPool, tools } = deps;

  const ctx = { auth, db, dbChat, dbConfig, dbChatLLM, sessionPool, tools };

  return async function handleRequest(req, res) {
    const url = req.url.split('?')[0];

    // Admin API
    const adminPrefix = '/api/' + adminBasePath.replace(/^\//, '');
    if (url.startsWith(adminPrefix + '/') || url === adminPrefix) {
      if (!checkAdminAuth(req, adminAuth)) {
        return jsonRes(res, 401, { error: 'Unauthorized' });
      }
      return adminRoutes.handle(req, res, ctx, adminBasePath);
    }

    // Chat API
    if (url.startsWith('/api/chat/') || url === '/api/chat') {
      return chatRoutes.handle(req, res, ctx);
    }

    return false; // 不是 chat 路由
  };
}

module.exports = { createChatApp };
