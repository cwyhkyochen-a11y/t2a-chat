// T2A Chat — 入口文件
// 职责：组装 slots / task-renderer / core 模块，暴露 window.t2aChat 公共 API
// 加载顺序：ws-manager.js → slots.js → task-renderer.js → core.js → chat.js（本文件）

(function () {
  'use strict';

  if (!window._t2aSlots || !window._t2aTaskRenderer || !window._t2aDom || !window._t2aCore) {
    console.error('[t2aChat] 模块未就绪，请检查 script 加载顺序');
    return;
  }

  const slots = window._t2aSlots;
  const taskRenderer = window._t2aTaskRenderer;
  const core = window._t2aCore;

  // ---- 公共 API ----
  window.t2aChat = {
    // task 渲染器注册
    registerTaskRenderer: taskRenderer.registerTaskRenderer,

    // 插槽注册
    registerSlot: slots.registerSlot,

    // config 面板注册
    registerConfigPanel: slots.registerConfigPanel,

    // 业务 API
    api: {
      sendMessage: core.sendMessage,
      cancelTask: core.cancelTask,
      createTask: core.createTask,
      getTaskStatus: core.getTaskStatus,
    },

    // 事件订阅
    on: slots.on,
    off: slots.off,
    emit: slots.emit,

    // Slash command 注册
    registerCommand: function (cmd) {
      if (window._t2aCommands) window._t2aCommands.registerCommand(cmd);
      else console.warn('[t2aChat] commands 模块未就绪');
    },
    listCommands: function () {
      return window._t2aCommands ? window._t2aCommands.listCommands() : [];
    },

    // 暴露给 inline onclick 用的内部方法（不走全局 onload）
    _internal: {
      selectConversation: core.selectConversation,
      deleteConversation: core.deleteConversation,
      doLogin: core.doLogin,
      newConversation: core.newConversation,
      sendMessage: core.sendMessage,
      stopStream: core.stopStream,
      showSettings: core.showSettings,
      hideSettings: core.hideSettings,
      saveSettings: core.saveSettings,
      logout: core.logout,
      toggleSidebar: core.toggleSidebar,
      handleKey: core.handleKey,
      autoResize: core.autoResize,
    },
  };

  // ---- 兼容 inline onclick 旧调用（chat.html 暂时仍用 doLogin() 等全局函数）----
  window.doLogin = core.doLogin;
  window.newConversation = core.newConversation;
  window.selectConversation = core.selectConversation;
  window.deleteConversation = core.deleteConversation;
  window.sendMessage = core.sendMessage;
  window.stopStream = core.stopStream;
  window.showSettings = core.showSettings;
  window.hideSettings = core.hideSettings;
  window.saveSettings = core.saveSettings;
  window.logout = core.logout;
  window.toggleSidebar = core.toggleSidebar;
  window.handleKey = core.handleKey;
  window.autoResize = core.autoResize;

  console.log('[t2aChat] 已就绪，window.t2aChat 可用');
})();
