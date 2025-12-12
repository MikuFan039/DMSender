# 配置和编译前后端

### 配置前端

1. 安装`nvm`和`Node.js`

`nvm`下载链接

```
https://github.com/coreybutler/nvm-windows
```
使用`nvm`安装`Node.js`，这里我用的是`Node.js v18.20.8`
```bat
nvm install 18.20.8
nvm ls
nvm use 18.20.8
```

2. 配置前端代码依赖

```bat
set NODE_OPTIONS=--openssl-legacy-provider && npm install
```

3. 测试和编译前端源代码

​	测试
```bat
set NODE_OPTIONS=--openssl-legacy-provider && npm run dev
```

​	编译
```bat
set NODE_OPTIONS=--openssl-legacy-provider && npm run build
```

### 配置后端

1. 安装`JDK`，这里需要用到`JDK 11 LTS`

```
https://www.oracle.com/cn/java/technologies/javase/jdk11-archive-downloads.html
```

2. 安装`maven`并添加至系统环境变量

```
https://maven.apache.org/download.cgi
```

3. 准备`SpringBoot`并将后端代码打包成`jar`

```bat
cd danmaku-sender
mvn clean package -DskipTests
```

4. 测试运行生成的`jar`

```bat
java -jar danmakusender-1.3.0.jar
```


### 生成精简版`jre`

1. 分析使用到的库

```bat
jdeps danmakusender-1.3.0.jar
```

2. 生成精简版`jre`（该指令由`DeepSeek`生成和调优）

```shell
jlink --no-header-files --no-man-pages \
    --compress=2 \      # ZIP压缩
    --strip-debug \     # 移除调试信息
    --add-modules java.base,java.desktop,java.logging,java.management,java.naming,java.sql,java.net.http,java.xml,jdk.unsupported,java.instrument,jdk.crypto.ec \       # 添加依赖项
    --bind-services \   # 包含服务提供者
    --output jre        # 设置输出文件夹
```

----

# 编译和打包桌面应用

### 安装Electron

1. 使用`npm`安装`cnpm`

```bat
npm install -g cnpm
```

2. 安装`electron`和`electron-builder`

```bat
nvm use 18.20.8
cnpm install -g electron@22.3.27
cnpm install -g electron-builder@23.6.0
```

3. 验证安装和启动`electron`

```bat
npx electron -v
npx electron
```

**附链接：**

- electron对应的Chrome版本：[Electron 发行版 | Electron](https://www.electronjs.org/zh/docs/latest/tutorial/electron-timelines)

- electron的npm链接：[electron - npm](https://www.npmjs.com/package/electron?activeTab=versions)

- electron-builder的npm链接：[electron-builder - npm](https://www.npmjs.com/package/electron-builder?activeTab=versions)

### 配置项目

1. 配置项目结构

```text
DMSender/
├── src/
│   ├── main.js         # 主进程
│   ├── preload.json    # 预加载脚本
├── jre/                # JRE
├── app.jar        		# 主程序
├── package.json        # 配置文件
└── icon.ico            # 图标
```

2. 配置打包配置

<details>
<summary>以下是`package.json`的内容和注释</summary>
```json
{
    // 项目基本信息
    "name": "dmsender", // 项目名称
    "version": "1.2.0", // 版本号
    "description": "弹幕发射场本地版，由淡光开发，葱娘构建", // 项目描述
    "author": "淡い光", // 作者信息
    "main": "src/main.js", // Electron 应用的主进程入口文件
    "license": "ISC", // 开源许可证类型
    "keywords": [ // npm 搜索关键词
        "弹幕",
        "工具",
        "哔哩哔哩"
    ],
    // 脚本命令
    "scripts": {
        "start": "electron .", // 启动开发模式
        "pack": "electron-builder --dir", // 打包应用但不生成安装包
        "dist": "electron-builder" // 构建并生成分发安装包
    },
    // 开发依赖 (仅在开发时需要)
    "devDependencies": {
        "electron": "^22.3.27", // Electron 框架
        "electron-builder": "^23.6.0" // 打包工具
    },
    // 生产依赖 (目前为空)
    "dependencies": {},
    // Electron 构建配置
    "build": {
        "productName": "弹幕发射场", // 产品名称
        "appId": "com.hikari.danmakusender", // 应用唯一标识符
        "copyright": "弹幕Art研究社", // 版权信息
        "compression": "maximum", // 最大压缩以减小文件体积
        "asar": "true", // asar 打包
        // 输出目录配置
        "directories": {
            "output": "dist" // 构建输出目录
        },
        // 包含的文件
        "files": [
            "src/**/*", // 包含 src 目录下所有文件
            "package.json" // 包含 package.json
        ],
        // 额外资源文件
        "extraResources": [
            {
                "from": "jre", // Java 运行环境
                "to": "jre", // 输出到应用内的 jre 目录
                "filter": [
                    "**/*"
                ]
            },
            {
                "from": "app.jar", // Java 应用程序
                "to": "." // 输出到应用根目录
            }
        ],
        // Windows 平台配置
        "win": {
            "target": [ // 打包目标格式
                "nsis", // Windows 安装程序
                "portable", // 便携版
                "zip" // 压缩包
            ],
            "compression": "maximum", // 压缩等级
            "icon": "icon.ico" // 应用图标
        },
        // macOS 平台配置
        "mac": {
            "target": [
                "dmg", // macOS 磁盘映像
                "zip" // 压缩包
            ],
            "compression": "maximum", // 压缩等级
            "category": "public.app-category.utilities", // 应用分类
            "icon": "icon.icns" // macOS 图标
        },
        // Linux 平台配置
        "linux": {
            "target": [ // 多种 Linux 包格式
                "AppImage", // 便携式应用格式
                "deb", // Debian/Ubuntu 包
                "rpm", // Red Hat/CentOS 包
                "snap", // 通用 Linux 包
                "tar.gz" // 压缩包
            ],
            "compression": "maximum", // 压缩等级
            "icon": "icon.png" // Linux 图标
        },
        // NSIS (Windows 安装程序) 配置
        "nsis": {
            "oneClick": false, // 禁用一键安装
            "allowElevation": "true", // 允许权限提升
            "allowToChangeInstallationDirectory": true, // 允许选择安装目录
            "createDesktopShortcut": true, // 创建桌面快捷方式
            "createStartMenuShortcut": true, // 创建开始菜单快捷方式
            "shortcutName": "弹幕发射场", // 快捷方式名称
            "menuCategory": "弹幕工具" // 开始菜单分类
        }
    }
}
```
</details>

**附链接：**

- Electron的打包配置：[Electron打包配置 + package.json的常用配置项及其用法解析_electron package.json-CSDN博客](https://blog.csdn.net/qq_41980754/article/details/119902572)

### 打包项目

1. 安装依赖项

```bat
npm install
```

​	*注：在安装前请先设置`electron`镜像源
```bat
npm config set electron_mirror "https://npmmirror.com/mirrors/electron/"
npm config set electron_builder_binaries_mirror "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

2. 测试启动项目

```bat
npm start
```

3. 构建打包应用

```bat
npm run dist
```

----