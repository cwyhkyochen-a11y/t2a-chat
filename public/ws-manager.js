// WebSocket 连接管理器 — T2A Chat
class ChatWSManager {
  constructor(options = {}) {
    this.url = options.url || this._buildWsUrl();
    this.password = options.password || '';
    this.onAuth = options.onAuth || (() => {});
    this.onText = options.onText || (() => {});
    this.onToolCall = options.onToolCall || (() => {});
    this.onToolEnd = options.onToolEnd || (() => {});
    this.onTurnStart = options.onTurnStart || (() => {});
    this.onTurnEnd = options.onTurnEnd || (() => {});
    this.onError = options.onError || (() => {});
    this.onNotice = options.onNotice || (() => {});
    this.onSystemEvent = options.onSystemEvent || (() => {});
    this.onConversationCreated = options.onConversationCreated || (() => {});
    this.onConnectionState = options.onConnectionState || (() => {});
    this.onSync = options.onSync || (() => {});
    this.onInterrupt = options.onInterrupt || (() => {});
    this.onToolError = options.onToolError || (() => {});
    this.onInterlude = options.onInterlude || (() => {});
    this.onThinking = options.onThinking || (() => {});

    this.ws = null;
    this.authenticated = false;
    this.reconnectTimer = null;
    this.currentConvId = null;
    this.lastMessageId = null;
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 30000;
  }

  _buildWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // v0.2.0+: 后端 wsPath = basePath + '/ws'，basePath 默认 '/chat' → '/chat/ws'
    // 允许宿主通过 window.T2A_CHAT_CONFIG.wsPath 覆盖
    const cfg = (typeof window !== 'undefined' && window.T2A_CHAT_CONFIG) || {};
    const wsPath = cfg.wsPath || '/chat/ws';
    return proto + '//' + location.host + wsPath;
  }

  connect() {
    this._doConnect();
  }

  _doConnect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;

    this.onConnectionState({ state: 'connecting' });
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this._reconnectDelay = 1000;
      // v0.2.0 P2: 不再发 auth 消息。后端在 HTTP upgrade 阶段已通过 cookie 鉴权。
      // 兼容老后端：如果传入了 password，仍然发一遍（老后端会认；新后端忽略 default 分支）
      if (this.password) {
        this._send({ type: 'auth', password: this.password });
      }
    };

    this.ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      this._handleMessage(msg);
    };

    this.ws.onclose = (evt) => {
      const wasAuthed = this.authenticated;
      this.authenticated = false;
      // 4001 = 后端主动鉴权失败；1006 + 不曾鉴权过 = upgrade 401（新后端鉴权失败路径）
      if (evt.code === 4001 || (!wasAuthed && evt.code === 1006)) {
        this.onAuth({ success: false, error: 'Invalid password or session expired' });
        return;
      }
      this._reconnect();
    };

    this.ws.onerror = () => {};
  }

  _reconnect() {
    this.onConnectionState({ state: 'reconnecting' });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this._doConnect();
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'auth_ok':
        this.authenticated = true;
        this.onAuth({ success: true });
        this.onConnectionState({ state: 'connected' });
        // Re-subscribe on reconnect
        if (this.currentConvId) {
          this.subscribe(this.currentConvId, this.lastMessageId);
        }
        break;
      case 'auth_fail':
        this.authenticated = false;
        this.onAuth({ success: false, error: msg.error || 'Auth failed' });
        break;
      case 'ping':
        this._send({ type: 'pong' });
        break;
      case 'turn_start':
        this.onTurnStart(msg);
        break;
      case 'text':
        this.onText(msg);
        break;
      case 'tool_call':
        this.onToolCall(msg);
        break;
      case 'tool_end':
        this.onToolEnd(msg);
        break;
      case 'tool_error':
        this.onToolError(msg);
        break;
      case 'turn_end':
        this.onTurnEnd(msg);
        break;
      case 'error':
        this.onError(msg);
        break;
      case 'notice':
      case 'system_notice':
        this.onNotice(msg);
        break;
      case 'system_event':
        this.onSystemEvent(msg);
        break;
      case 'conversation_created':
        this.onConversationCreated(msg);
        break;
      case 'interrupt':
        this.onInterrupt(msg);
        break;
      case 'interlude':
        this.onInterlude(msg);
        break;
      case 'thinking':
        this.onThinking(msg);
        break;
      case 'sync':
        this.onSync(msg);
        break;
      default:
        break;
    }
  }

  subscribe(conversationId, lastMessageId) {
    this.currentConvId = conversationId;
    if (lastMessageId != null) this.lastMessageId = lastMessageId;
    if (this.authenticated) {
      this._send({
        type: 'subscribe',
        conversation_id: conversationId,
        last_message_id: lastMessageId || null,
      });
    }
  }

  unsubscribe() {
    this.currentConvId = null;
    this.lastMessageId = null;
    if (this.authenticated) {
      this._send({ type: 'unsubscribe' });
    }
  }

  send(conversationId, message, attachments) {
    this._send({
      type: 'send',
      conversation_id: conversationId,
      message: message || '',
      image_url: null,
      attachments: attachments || null,
    });
  }

  interrupt(conversationId) {
    this._send({
      type: 'interrupt',
      conversation_id: conversationId,
    });
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.authenticated = false;
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}
