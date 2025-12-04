const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process"); // 用于创建子进程
const fs = require("fs"); // 文件系统模块
const net = require("net"); // 网络模块

// ============= 全局变量 =============
let mainWindow; // 主窗口实例
let javaProcess; // Java进程对象
let isJavaRunning = false; // Java进程运行状态
let tray = null; // 托盘图标对象
let appIsQuitting = false; // 应用退出标志（防止重复触发）
// 各种管理器
let windowStateManager = null; //窗口状态管理
let javaProcessManager = null; //Java进程管理
let trayManager = null; //托盘管理

// ============= 工具函数 =============
// 获取资源路径函数
const getResourcePath = (...paths) => {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...paths) // 生产环境：资源位于应用程序的resources目录下
    : path.join(process.cwd(), ...paths); // 开发环境：资源位于项目根目录下
};

// 根据当前平台获取Java可执行文件路径
const getJavaExecutable = () => {
  const platform = process.platform; // 获取操作系统平台
  const jreBase = getResourcePath("jre"); // JRE基础路径

  const platformPaths = {
    win32: path.join(jreBase, "bin", "java.exe"), // Windows路径
    darwin: path.join(jreBase, "Contents", "Home", "bin", "java"), // macOS路径
    linux: path.join(jreBase, "bin", "java"), // Linux路径
  };

  return platformPaths[platform] || platformPaths.linux;
};

// ============= 外部链接处理 =============
//检查URL是否为外部链接
const isExternalLink = (url) => {
  if (!url || typeof url !== "string") return false;

  // 定义内部链接的白名单
  const internalDomains = [
    "localhost",
    "127.0.0.1",
    "file://",
    "http://localhost:8010", // 后端服务地址
  ];

  // 检查URL是否在白名单内
  const isInternal = internalDomains.some((domain) => url.includes(domain));

  // 如果是http/https协议且不在白名单内，则认为是外部链接
  return (
    (url.startsWith("http://") || url.startsWith("https://")) && !isInternal
  );
};

//设置外部链接处理
const setupExternalLinkHandler = (window) => {
  if (!window) return;

  // 监听窗口内的导航事件
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    // 检查是否为外部链接
    if (isExternalLink(navigationUrl)) {
      event.preventDefault(); // 阻止在Electron中打开
      shell.openExternal(navigationUrl); // 使用系统浏览器打开
    }
  });

  // 监听新窗口创建事件（处理 target="_blank" 的链接）
  window.webContents.on("new-window", (event, navigationUrl) => {
    // 检查是否为外部链接
    if (isExternalLink(navigationUrl)) {
      event.preventDefault(); // 阻止在Electron中打开新窗口
      shell.openExternal(navigationUrl); // 使用系统浏览器打开
      return { action: "deny" }; // 阻止在Electron中创建新窗口
    }

    // 内部链接允许在Electron中打开
    return { action: "allow" };
  });
};

// ============= 窗口状态管理器 =============
class WindowStateManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.javaStarted = false;
    this.springBootStarted = false;
  }

  // 发送消息到渲染进程
  sendToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  // 发送详细状态信息到loading页面
  sendLoadingStatus(message) {
    this.sendToRenderer("loading-status", message);
  }

  // 标记Java已启动
  markJavaStarted() {
    this.javaStarted = true;
    this.sendLoadingStatus("Java启动成功，开始加载SpringBoot...");
  }

  // 标记SpringBoot已启动
  markSpringBootStarted() {
    this.springBootStarted = true;
    this.sendLoadingStatus("SpringBoot应用启动完成，准备连接服务...");
  }

  // 检查是否所有服务都已启动
  areAllServicesStarted() {
    return this.javaStarted && this.springBootStarted;
  }
}

// ============= Java 进程管理器 =============
class JavaProcessManager {
  constructor(windowStateManager) {
    this.process = null; // Java进程对象
    this.isRunning = false; // Java进程运行状态
    this.logStream = null; // 日志文件流
    this.windowStateManager = windowStateManager;
    this.springBootDetected = false;
    this.tomcatStarted = false;
    this.applicationStarted = false;
  }

  // 启动Java应用程序
  start() {
    try {
      const javaPath = getJavaExecutable(); // Java可执行文件路径
      const jarPath = getResourcePath("app.jar"); // JAR文件路径

      // 检查Java和JAR文件是否存在
      if (!this.checkFilesExist(javaPath, jarPath)) {
        return false;
      }

      // 创建日志目录和文件
      const logPath = this.setupLogging();

      // 启动Java进程
      this.process = spawn(javaPath, ["-jar", jarPath], {
        stdio: ["ignore", "pipe", "pipe"], // 忽略stdin，捕获stdout/stderr
        windowsHide: true, // 隐藏Windows子进程控制台窗口
        detached: false,
        env: {
          ...process.env,
          PATH: `${path.dirname(javaPath)}${path.delimiter}${process.env.PATH}`, // 确保Java在PATH中
        },
      });

      // 设置进程事件处理器
      this.setupProcessHandlers(logPath);
      this.isRunning = true;

      // 立即发送Java启动状态
      if (this.windowStateManager) {
        // 先发送Java已启动的消息
        this.windowStateManager.sendLoadingStatus("Java进程已启动...");
      }
      return true;
    } catch (error) {
      console.error("启动Java应用失败:", error);
      return false;
    }
  }

  // 检查Java和JAR文件是否存在
  checkFilesExist(javaPath, jarPath) {
    if (!fs.existsSync(javaPath)) {
      console.error(`Java可执行文件未找到: ${javaPath}`);
      return false;
    }
    if (!fs.existsSync(jarPath)) {
      console.error(`JAR文件未找到: ${jarPath}`);
      return false;
    }
    return true;
  }

  // 设置日志记录
  setupLogging() {
    // 创建日志目录
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // 创建日志文件流
    const logPath = path.join(logDir, "dmsender.log");
    this.logStream = fs.createWriteStream(logPath, { flags: "a" });
    return logPath;
  }

  // 设置进程事件处理器
  setupProcessHandlers(logPath) {
    // 统一的输出处理函数
    const handleOutput = (data, type) => {
      const message = data.toString();
      const prefix = type === "error" ? "[STDERR]" : "[STDOUT]";
      this.logStream.write(`${prefix} ${message}`);

      // 发送日志到渲染进程
      const channel = type === "error" ? "java-error" : "java-log";
      if (this.windowStateManager) {
        this.windowStateManager.sendToRenderer(channel, message);
      }

      // 根据实际日志内容检测启动状态
      this.detectStartupStatus(message);
    };

    // 处理标准输出
    this.process.stdout.on("data", (data) => handleOutput(data, "log"));

    // 处理标准错误
    this.process.stderr.on("data", (data) => handleOutput(data, "error"));

    // 处理进程退出
    this.process.on("close", (code) => {
      this.logStream.write(`[EXIT] Java进程退出，代码 ${code}`);
      this.logStream.end(); // 关闭日志流
      this.isRunning = false;

      // 如果Java进程意外退出，通知渲染进程并退出应用
      if (this.windowStateManager) {
        this.windowStateManager.sendToRenderer("java-exit", code);
        setTimeout(() => app.quit(), 1000);
      }
    });

    // 初始化检测状态
    this.springBootDetected = false;
    this.tomcatStarted = false;
    this.applicationStarted = false;
  }

  // 根据实际日志检测启动状态
  detectStartupStatus(message) {
    console.log(message); // 展示日志
    // 检测Spring Boot开始启动
    if (
      !this.springBootDetected &&
      message.includes("Starting DanmakuSenderApplication")
    ) {
      console.log("SpringBoot 开始启动");
      this.springBootDetected = true;
      if (this.windowStateManager) {
        this.windowStateManager.sendLoadingStatus("SpringBoot应用开始启动...");
        this.windowStateManager.markJavaStarted();
      }
    }

    // 检测Tomcat启动
    if (
      !this.tomcatStarted &&
      message.includes("Tomcat started on port(s): 8010")
    ) {
      console.log("Tomcat 启动成功");
      this.tomcatStarted = true;
      if (this.windowStateManager) {
        this.windowStateManager.sendLoadingStatus(
          "Tomcat服务器已启动 (端口:8010)"
        );
      }
    }

    // 检测应用完全启动
    if (
      !this.applicationStarted &&
      message.includes("Started DanmakuSenderApplication")
    ) {
      console.log("SpringBoot 启动完成");
      this.applicationStarted = true;
      if (this.windowStateManager) {
        this.windowStateManager.sendLoadingStatus("SpringBoot应用启动完成");
        this.windowStateManager.markSpringBootStarted();
      }
    }

    // 检测自定义启动成功消息
    if (message.includes("弹幕发射场启动成功")) {
      console.log("弹幕发射场启动成功");
      if (this.windowStateManager) {
        this.windowStateManager.sendLoadingStatus("弹幕发射场后端服务启动成功");
      }
    }

    // 检测警告信息
    if (message.includes("WARN")) {
      if (this.windowStateManager) {
        this.windowStateManager.sendToRenderer("java-warning", message);
      }
    }
  }

  // 重启Java进程
  restart() {
    if (this.process) {
      this.process.kill("SIGTERM");
    }
    // 重置状态
    this.springBootDetected = false;
    this.tomcatStarted = false;
    this.applicationStarted = false;

    setTimeout(() => {
      if (this.start()) {
        // 通知渲染进程Java已重启
        if (this.windowStateManager) {
          this.windowStateManager.sendToRenderer("java-restarted");
        }
      }
    }, 500);
  }

  // 停止Java进程
  stop() {
    if (this.process && this.isRunning) {
      this.process.kill("SIGTERM");
    }
  }
}

// ============= 托盘管理器 =============
class TrayManager {
  constructor() {
    this.tray = null; // 托盘图标对象
  }

  // 创建系统托盘图标和菜单
  create() {
    const iconPath = getResourcePath("icon.ico"); // 图标路径
    const trayIcon = nativeImage.createFromPath(iconPath); // 创建原生图标

    this.tray = new Tray(trayIcon); // 实例化托盘
    this.tray.setToolTip("弹幕发射场"); // 悬停提示文本

    // 创建上下文菜单
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "打开弹幕发射场",
        click: () => mainWindow?.show(),
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          appIsQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu); // 设置菜单

    // 点击托盘图标显示主窗口
    this.tray.on("click", () => mainWindow?.show());

    return this.tray;
  }

  // 显示托盘通知
  showNotification(title, content, isStartup = false) {
    if (!this.tray) return;

    const iconPath = getResourcePath("icon.ico");
    const notificationConfig = {
      title,
      content,
      icon: nativeImage.createFromPath(iconPath),
    };

    // Windows系统显示气球通知，其他平台在非启动时显示
    if (process.platform === "win32" || !isStartup) {
      this.tray.displayBalloon(notificationConfig);
    }
  }

  // 销毁托盘图标
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

// ============= 服务连接检查器 =============
// 检查后端服务是否就绪
const checkBackendReady = () => {
  return new Promise((resolve) => {
    const client = new net.Socket(); // 创建TCP客户端
    let resolved = false; // 防止多次解析

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        client.destroy(); // 销毁socket
      }
    };

    // 尝试连接
    client.connect({ port: 8010, host: "127.0.0.1" }, () => {
      client.end(); // 连接成功
      cleanup();
      resolve(true);
    });

    // 连接失败处理
    client.on("error", () => {
      cleanup();
      resolve(false);
    });

    // 10秒超时处理
    setTimeout(() => {
      cleanup();
      resolve(false);
    }, 10000);
  });
};

// ============= 连接流程管理 =============
// 尝试连接后端服务的流程
const startConnectionProcess = async (windowStateManager) => {
  // 等待SpringBoot完全启动完成
  const waitForSpringBoot = () => {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (windowStateManager.areAllServicesStarted()) {
          clearInterval(checkInterval);
          console.log("所有服务已启动");
          resolve(true);
        }
      }, 500);

      // 设置超时，防止无限等待
      setTimeout(() => {
        clearInterval(checkInterval);
        console.log("SpringBoot启动超时，尝试连接...");
        windowStateManager.sendLoadingStatus("正在尝试连接服务...");
        resolve(false);
      }, 500);
    });
  };

  // 等待SpringBoot启动
  windowStateManager.sendLoadingStatus("等待SpringBoot应用启动...");
  console.log("开始等待SpringBoot启动...");
  await waitForSpringBoot();

  // 开始连接后端服务
  windowStateManager.sendLoadingStatus("开始连接后端服务...");

  for (let attempt = 1; attempt <= 10; attempt++) {
    // 减少重试次数
    windowStateManager.sendLoadingStatus(`尝试连接后端服务... (${attempt}/10)`);

    console.log(`连接尝试 ${attempt}/10`);
    // 检查后端是否就绪
    const isReady = await checkBackendReady();
    if (isReady) {
      windowStateManager.sendLoadingStatus("连接成功");
      windowStateManager.sendLoadingStatus("正在进入主页面...");

      // 短暂延迟以显示成功消息
      setTimeout(() => {
        mainWindow.loadURL("http://localhost:8010");
      }, 500);
      return true;
    } else {
      if (attempt < 10) {
        windowStateManager.sendLoadingStatus(`连接失败，等待重试...`);
      } else {
        windowStateManager.sendLoadingStatus("连接失败");
      }
    }

    // 1秒后重试
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // 超过10次尝试则显示错误页面
  mainWindow.loadFile(path.join(__dirname, "error.html"));
  return false;
};

// ============= 窗口创建和管理 =============

// 创建Electron主窗口
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    autoHideMenuBar: true, // 自动隐藏菜单栏
    show: false, // 初始不显示
    icon: getResourcePath("icon.ico"), // 窗口图标
    title: "启动中", // 初始标题
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // 预加载脚本
      nodeIntegration: false, // 禁用Node集成
      contextIsolation: true, // 启用上下文隔离
      sandbox: true, // 启用沙箱
      additionalArguments: [`--user-data-dir=${app.getPath("userData")}`], // 传递用户数据目录
    },
  });

  // 初始化窗口状态管理器
  windowStateManager = new WindowStateManager(mainWindow);

  // 初始化Java进程管理器
  javaProcessManager = new JavaProcessManager(windowStateManager);

  // 设置窗口事件监听
  setupWindowEvents(mainWindow);

  // 设置外部链接处理
  setupExternalLinkHandler(mainWindow);

  // 加载初始页面（加载中）
  mainWindow.loadFile(path.join(__dirname, "loading.html"));

  // 窗口准备就绪后
  mainWindow.once("ready-to-show", () => {
    console.log("窗口准备就绪，显示窗口");
    mainWindow.show();

    // 立即发送初始状态
    if (windowStateManager) {
      console.log("发送初始状态消息");
      windowStateManager.sendLoadingStatus("应用程序初始化完成...");
    }

    // 短暂延迟后启动Java
    setTimeout(() => {
      console.log("开始启动Java进程");
      if (javaProcessManager && javaProcessManager.start()) {
        console.log("Java进程启动成功，开始连接流程");
        // 延迟开始连接
        setTimeout(() => startConnectionProcess(windowStateManager), 1000);
      } else {
        console.error("Java进程启动失败");
        showErrorWindow();
      }
    }, 500);
  });

  // 窗口关闭后清理引用
  mainWindow.on("closed", () => {
    mainWindow = null;
    windowStateManager = null;
    javaProcessManager = null;
  });
  return mainWindow; // 返回窗口实例
};

// ============= 窗口事件设置 =============
// 设置窗口事件监听器
const setupWindowEvents = (window) => {
  // 统一的窗口隐藏到托盘处理
  const hideWindowToTray = () => {
    window.hide(); // 隐藏窗口

    // 显示托盘通知
    if (trayManager) {
      trayManager.showNotification(
        "弹幕发射场",
        "应用程序已最小化到系统托盘",
        false
      );
    }
  };

  // 处理窗口关闭事件（最小化到托盘）
  window.on("close", (event) => {
    if (!appIsQuitting) {
      event.preventDefault(); // 阻止默认关闭行为
      hideWindowToTray();
    }
  });

  // 处理窗口最小化事件（隐藏到托盘）
  window.on("minimize", (event) => {
    event.preventDefault();
    hideWindowToTray();
  });
};

// ============= IPC通信处理 =============
// 设置IPC消息处理器
const setupIpcHandlers = () => {
  // 获取应用路径
  ipcMain.handle("get-app-path", (event, name) => app.getPath(name));

  // 重启应用
  ipcMain.handle("restart-app", () => {
    if (javaProcessManager) {
      javaProcessManager.restart();
    }
    setTimeout(() => {
      if (javaProcessManager && javaProcessManager.start()) {
        mainWindow?.loadFile(path.join(__dirname, "loading.html"));
      }
    }, 500);
  });

  // 重启Java进程
  ipcMain.on("restart-java-process", () => {
    if (javaProcessManager) {
      javaProcessManager.restart();
    }
  });

  // 窗口控制
  const windowControls = {
    "window-minimize": () => mainWindow?.minimize(),
    "window-maximize": () => {
      if (mainWindow) {
        mainWindow.isMaximized()
          ? mainWindow.unmaximize()
          : mainWindow.maximize();
      }
    },
    "window-close": () => mainWindow?.close(),
    "window-hide-to-tray": () => mainWindow?.hide(),
  };

  // 注册窗口控制IPC处理器
  Object.entries(windowControls).forEach(([channel, handler]) => {
    ipcMain.on(channel, handler);
  });
};

// ============= 应用初始化 =============

// Electron应用准备就绪
app
  .whenReady()
  .then(() => {
    Menu.setApplicationMenu(null); // 清除应用菜单

    // 监听所有窗口创建，自动设置外部链接处理
    app.on("browser-window-created", (event, window) => {
      setupExternalLinkHandler(window);
    });

    // 初始化托盘管理器
    trayManager = new TrayManager();

    // 创建主窗口
    createWindow();

    // 创建托盘图标
    tray = trayManager.create();

    // 设置IPC处理器
    setupIpcHandlers();

    // 显示启动通知
    trayManager.showNotification(
      "弹幕发射场",
      process.platform === "win32"
        ? "应用程序已启动，点击关闭按钮可最小化到托盘"
        : "应用程序已启动",
      true
    );

    // macOS激活事件处理
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
    });
  })
  // 错误捕获
  .catch((error) => {
    console.error("应用启动失败:", error);
    showErrorWindow();
  });

// ============= 错误窗口显示 =============
// 显示错误窗口
const showErrorWindow = () => {
  try {
    const errorWindow = new BrowserWindow({
      width: 800,
      height: 600,
      autoHideMenuBar: true, // 自动隐藏菜单栏
      icon: getResourcePath("icon.ico"), // 窗口图标
      title: "启动失败", // 标题
      webPreferences: {
        preload: path.join(__dirname, "preload.js"), // 添加预加载脚本
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false,
    });
    errorWindow.loadFile(path.join(__dirname, "error.html"));
    errorWindow.once("ready-to-show", () => {
      errorWindow.show();
    });
  } catch (error) {
    console.error("创建错误窗口失败:", error);
    // 如果连错误窗口都无法创建，显示一个简单的对话框
    dialog.showErrorBox("启动失败", "应用程序启动过程中遇到错误。");
  }
};

// ============= Electron生命周期管理 =============
// 所有窗口关闭时的处理（不退出应用）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // 在非macOS平台上保持应用运行
  }
});

// 应用退出前清理
app.on("before-quit", () => {
  if (!appIsQuitting) return;

  // 终止Java进程
  if (javaProcessManager) {
    javaProcessManager.stop();
  }

  // 销毁托盘图标
  if (trayManager) {
    trayManager.destroy();
  }
});
