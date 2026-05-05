// t2a-chat 主入口
// createChatApp(options) → { attachToServer, pushSystemEvent, getSessionPool, getTaskRegistry }
//
// v0.2.0: 接受 taskTypes / modelRouter / auth.resolveUser / sidebarLinks / branding

const { initWebSocket, pushToConversation } = require('./ws-server');
const { SessionPool } = require('./session-pool');
const { TaskRegistry, init: initTaskRegistry } = require('./task-registry');
const { jsonRes } = require('./utils');
const dbChat = require('./db-chat');
const dbChatLLM = require('./db-chat-llm');
const dbConfig = require('./db-config');
const storageModule = require('./storage');
const taskRoutes = require('./task-routes');

function checkAdminAuth(req, adminAuth) {
  if (!adminAuth) return false;
  return adminAuth(req);
}

function createChatApp(options) {
  const {
    db,                     // better-sqlite3 实例
    auth,                   // v0.2.0: { resolveUser, loginUrl?, resolveWsUser? }
    adminAuth,              // (req) => boolean
    tools,                  // ({ userId, conversationId, baseUrl }) => ToolRegistry
    systemEventTemplate,    // 可选
    basePath = '/chat',
    adminBasePath = '/chat-admin',
    // v0.2.0 新增
    taskTypes = {},         // 宿主注册的 task type 定义
    modelRouter = {},       // { defaults: {}, rules: [] }
    sidebarLinks = [],      // [{ url, label, icon }]
    branding = {},          // { name?, logo?, primaryColor? }
    enableFormBlocks = false, // 是否在 system prompt 注入 form 围栏使用说明
  } = options;

  // 验证 auth 格式
  if (!auth || typeof auth.resolveUser !== 'function') {
    throw new Error('[t2a-chat] auth.resolveUser is required (must be an async function returning { id, name } or null)');
  }
  const resolveUser = auth.resolveUser;
  const resolveWsUser = typeof auth.resolveWsUser === 'function' ? auth.resolveWsUser : auth.resolveUser;
  const loginUrl = auth.loginUrl || null;

  // 初始化数据层
  dbChat.init(db);
  dbChatLLM.init(db);
  dbConfig.init(db);
  storageModule.init(db);
  initTaskRegistry(db);

  // 初始化 schema（如果表不存在）
  const fs = require('fs');
  const path = require('path');
  const schemaPath = path.join(__dirname, '..', 'scripts', 'init-schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
  }

  // Task Registry
  const taskRegistry = new TaskRegistry(taskTypes, modelRouter);

  // Session Pool
  const sessionPool = new SessionPool({ db, dbConfig, dbChatLLM, tools, systemEventTemplate, enableFormBlocks });

  // 构建路由表
  const chatHandler = require('./chat-handler');
  const chatRoutes = require('./chat-routes');
  const adminRoutes = require('./admin-routes');

  let _attached = false;

  function attachToServer(server) {
    // WebSocket（用 resolveWsUser 鉴权）
    const wss = initWebSocket(server, {
      db, dbChat, dbConfig, dbChatLLM,
      resolveWsUser, sessionPool, basePath,
    });
    _attached = true;

    return {
      wss,
      handleRequest: createRequestHandler({
        resolveUser, adminAuth, basePath, adminBasePath,
        chatHandler, chatRoutes, adminRoutes,
        db, dbChat, dbConfig, dbChatLLM, sessionPool, tools,
        taskRegistry, sidebarLinks, branding, loginUrl,
      }),
      pushToConversation,
    };
  }

  function pushSystemEvent(conversationId, eventInput) {
    const session = sessionPool.peek(String(conversationId));
    if (!session) return Promise.resolve();
    return session.pushSystemEvent(eventInput);
  }

  function pushToConversationGuarded(conversationId, message) {
    if (!_attached) {
      throw new Error('[t2a-chat] pushToConversation called before attachToServer()');
    }
    return pushToConversation(conversationId, message);
  }

  return {
    attachToServer,
    pushSystemEvent,
    pushToConversation: pushToConversationGuarded,
    getSessionPool: () => sessionPool,
    getTaskRegistry: () => taskRegistry,
    // 暴露给宿主的数据层
    db: { chat: dbChat, llm: dbChatLLM, config: dbConfig },
  };
}

function createRequestHandler(deps) {
  const {
    resolveUser, adminAuth, basePath, adminBasePath,
    chatHandler, chatRoutes, adminRoutes,
    db, dbChat, dbConfig, dbChatLLM, sessionPool, tools,
    taskRegistry, sidebarLinks, branding, loginUrl,
  } = deps;

  // ctx 传递给各 route handler
  const ctx = {
    resolveUser, db, dbChat, dbConfig, dbChatLLM, sessionPool, tools,
    taskRegistry, sidebarLinks, branding, loginUrl,
  };

  return async function handleRequest(req, res) {
    const url = req.url.split('?')[0];

    // 静态上传文件
    if (url.startsWith('/uploads/') && req.method === 'GET') {
      const uploadRoutes = require('./upload-routes');
      return uploadRoutes.handleStaticUpload(req, res, url);
    }

    // Admin API
    const adminPrefix = '/api/' + adminBasePath.replace(/^\//, '');
    if (url.startsWith(adminPrefix + '/') || url === adminPrefix) {
      if (!checkAdminAuth(req, adminAuth)) {
        return jsonRes(res, 401, { error: 'Unauthorized' });
      }
      return adminRoutes.handle(req, res, ctx, adminBasePath);
    }

    // Task routes（与 basePath 绑定）
    const chatPrefix = '/api/' + basePath.replace(/^\//, '');
    // 匹配 tasks / models / config/ui 相关路由
    const taskPrefixes = [chatPrefix + '/tasks', chatPrefix + '/models', chatPrefix + '/config/ui'];
    const isTaskRoute = taskPrefixes.some(p => url === p || url.startsWith(p + '/') || url.startsWith(p + '?'));
    if (isTaskRoute) {
      const result = await taskRoutes.handle(req, res, ctx, basePath);
      if (result !== false) return result;
    }

    // Chat API（用动态 basePath）
    if (url.startsWith(chatPrefix + '/') || url === chatPrefix) {
      return chatRoutes.handle(req, res, ctx);
    }

    return false; // 不是 chat 路由
  };
}

module.exports = { createChatApp };
