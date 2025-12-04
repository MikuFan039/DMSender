const { contextBridge, ipcRenderer } = require("electron");

// 在渲染进程的window对象上暴露安全的Electron API
contextBridge.exposeInMainWorld("electron", {
  /**
   * 封装后的ipcRenderer通信模块
   */
  ipcRenderer: {
    /**
     * 监听主进程发送的消息 - 修复参数传递问题
     */
    on: (channel, func) => {
      const validChannels = [
        "loading-status",
        "java-log",
        "java-error",
        "java-warning",
        "java-exit",
        "java-restarted",
      ];

      if (validChannels.includes(channel)) {
        console.log(`Preload: 注册监听器 ${channel}`);
        // 关键修复：确保参数正确传递
        ipcRenderer.on(channel, (event, ...args) => {
          console.log(`Preload: 收到 ${channel} 消息:`, args[0]);
          // 如果只有一个参数，直接传递该参数
          func(args.length === 1 ? args[0] : args);
        });
      }
    },

    /**
     * 移除监听器
     */
    removeListener: (channel, func) => {
      ipcRenderer.removeListener(channel, func);
    },

    /**
     * 移除所有监听器
     */
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel);
    },

    /**
     * 向主进程发送消息
     */
    send: (channel, data) => {
      const validChannels = [
        "restart-java-process",
        "window-minimize",
        "window-maximize",
        "window-close",
        "window-hide-to-tray",
      ];

      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
  },

  /**
   * 应用功能模块
   */
  app: {
    //获取应用特定路径
    getPath: (name) => ipcRenderer.invoke("get-app-path", name),
    //重启应用程序
    restart: () => ipcRenderer.send("restart-app"),
    //重启Java进程
    restartJava: () => ipcRenderer.send("restart-java-process"),
    // 关闭应用程序
    close: () => ipcRenderer.send("window-close"),
  },

  /**
   * 窗口控制功能模块
   */
  window: {
    // 最小化当前窗口
    minimize: () => ipcRenderer.send("window-minimize"),
    // 最大化/还原当前窗口
    maximize: () => ipcRenderer.send("window-maximize"),
    // 关闭当前窗口
    close: () => ipcRenderer.send("window-close"),
    // 隐藏窗口到系统托盘
    hideToTray: () => ipcRenderer.send("window-hide-to-tray"),
  },
});
