// Session Pool：conversationId → t2a-core Session 实例缓存
//
// LRU 淘汰（Map 的插入顺序即 LRU 顺序，命中后重新 set）
// 最大 200 条
// 同一 conversationId 重复进入用同一 Session 实例

const {
  Session,
  OpenAILLMClient,
  defaultSystemEventTemplate,
} = require('@t2a/core');

const { getStorage } = require('./storage');

const MAX_SESSIONS = 200;

class SessionPool {
  /**
   * @param {object} deps
   * @param {import('better-sqlite3').Database} deps.db
   * @param {object} deps.dbConfig - db-config 模块
   * @param {object} deps.dbChatLLM - db-chat-llm 模块
   * @param {function} [deps.tools] - ({ userId, conversationId, baseUrl }) => ToolRegistry
   * @param {function} [deps.systemEventTemplate] - (event) => content parts
   */
  constructor(deps) {
    this._deps = deps;
    /** @type {Map<string, import('@t2a/core').Session>} */
    this._map = new Map();
  }

  /** 只查不刷新 LRU 顺序 */
  peek(key) {
    return this._map.get(String(key)) || null;
  }

  get(key) {
    const k = String(key);
    const s = this._map.get(k);
    if (s) {
      // LRU：命中时移到末尾
      this._map.delete(k);
      this._map.set(k, s);
    }
    return s || null;
  }

  set(key, session) {
    const k = String(key);
    if (this._map.has(k)) this._map.delete(k);
    this._map.set(k, session);
    // 淘汰
    while (this._map.size > MAX_SESSIONS) {
      const oldestKey = this._map.keys().next().value;
      this._map.delete(oldestKey);
    }
  }

  getOrCreateSession(conversationId, userId, baseUrl) {
    const key = String(conversationId);
    const cached = this.get(key);
    if (cached) return cached;

    const { dbConfig, dbChatLLM, tools, systemEventTemplate } = this._deps;

    const agentConfig = dbConfig.getAgentConfig();
    if (!agentConfig) throw new Error('[session-pool] agent_config 未配置');

    // --- 多 LLM fallback：优先从 chat_llm_providers 读取 ---
    let llmClients;
    let modelNames;
    try {
      const allProviders = dbChatLLM.getChatLLMProviders(); // priority ASC, 已解密
      const providers = allProviders.filter(p => p.enabled === 1);
      if (providers && providers.length > 0) {
        llmClients = providers.map(p => {
          const baseUrlNorm = p.base_url.replace(/\/+$/, '');
          const llmBaseUrl = baseUrlNorm.endsWith('/v1') ? baseUrlNorm : baseUrlNorm + '/v1';
          return new OpenAILLMClient({
            baseUrl: llmBaseUrl,
            apiKey: p.api_key,
            model: p.model,
          });
        });
        modelNames = providers.map(p => p.model);
      }
    } catch (err) {
      console.error('[session-pool] 读取 chat_llm_providers 失败，fallback 到 agent_config:', err.message);
    }

    // fallback: 用 agent_config（向后兼容）
    if (!llmClients || llmClients.length === 0) {
      const baseUrlNorm = agentConfig.base_url.replace(/\/+$/, '');
      const llmBaseUrl = baseUrlNorm.endsWith('/v1') ? baseUrlNorm : baseUrlNorm + '/v1';
      llmClients = [new OpenAILLMClient({
        baseUrl: llmBaseUrl,
        apiKey: agentConfig.api_key,
        model: agentConfig.model,
      })];
      modelNames = [agentConfig.model];
    }

    // Tool registry（由宿主提供的工厂函数）
    let toolRegistry = undefined;
    if (typeof tools === 'function') {
      toolRegistry = tools({ userId, conversationId: key, baseUrl });
    }

    // --- overflow 配置 ---
    const overflowStrategy = agentConfig.overflow_strategy || 'truncate';
    const contextMaxTokens = agentConfig.context_max_tokens || 80000;
    const keepLastN = agentConfig.overflow_keep_last_n || 20;
    const warningRatio = agentConfig.overflow_warning_ratio || 0.85;
    const warningThreshold = Math.floor(contextMaxTokens * warningRatio);

    // --- systemEventInjection template ---
    const eventTemplate = typeof systemEventTemplate === 'function'
      ? systemEventTemplate
      : defaultSystemEventTemplate;

    const session = new Session({
      sessionId: key,
      storage: getStorage(),
      llm: llmClients,
      tools: toolRegistry,
      model: modelNames,
      systemPrompt: agentConfig.system_prompt || undefined,
      llmFallback: llmClients.length > 1 ? { timeoutMs: 30000, maxRetries: 1 } : undefined,
      config: {
        contextMaxTokens,
        warningThreshold,
        onOverflow: overflowStrategy,
        compact: { keepLastN },
        buildMessagesOptions: {
          degradeHistoryTools: true,
          timezoneOffsetMinutes: 480,
        },
        systemEventInjection: {
          template: eventTemplate,
        },
      },
    });

    this.set(key, session);
    return session;
  }
}

module.exports = { SessionPool };
