# LAN Drop (内网投送)

> **轻量级、无中心、极速局域网点对点（P2P）文件投送与即时通讯工具**  
> 基于 **Tauri v2 + Rust + React 19 + TypeScript + Vite + Tailwind CSS** 打造，全生命周期支持 **pnpm** 依赖管理。纯本地局域网传输，无需连接外部云端服务器，保障隐私与安全。

---

## 目录

- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [系统环境要求](#系统环境要求)
  - [1. Node.js 与 pnpm 环境](#1-nodejs-与-pnpm-环境)
  - [2. Rust 编译环境](#2-rust-编译环境)
  - [3. 操作系统前置构建依赖](#3-操作系统前置构建依赖)
- [依赖安装 (pnpm)](#依赖安装-pnpm)
- [本地开发与调试](#本地开发与调试)
  - [模式 A：桌面端原生开发（完整功能，推荐）](#模式-a桌面端原生开发完整功能推荐)
  - [模式 B：纯 Web 界面预览（前端调试）](#模式-b纯-web-界面预览前端调试)
- [编译与打包（导出安装包）](#编译与打包导出安装包)
  - [一键构建命令](#一键构建命令)
  - [导出安装包路径与格式说明](#导出安装包路径与格式说明)
- [常见问题与编译排错](#常见问题与编译排错)
- [局域网通信协议与端口说明](#局域网通信协议与端口说明)

---

## 核心特性

- **去中心化与零配置**：采用 UDP 组播（Multicast）技术，设备接入局域网后自动发现彼此，无需任何第三方中央服务器或账号注册。
- **极速磁盘直推传输**：底层基于 Rust Tokio 异步运行时、Axum 高性能 HTTP 接收端与 Reqwest 磁盘流式推送，大文件直接流式写入磁盘，内存占用极低，跑满内网带宽。
- **安全手动接收机制**：对端发送文件后先在会话中呈现传输卡片，接收方主动点击“接收”才开始传输；发送前检测对端设备在线状态，杜绝隐式自动下载。
- **丰富媒体即时预览**：传输的图片支持点击原图灯箱查看，音视频文件可在会话内直接播放。
- **VS Code 2026 Dark Modern 设计**：沉浸式深色现代主题，布局紧凑精致，支持按文件名、消息全文、联系人秒级检索并高亮定位。
- **双运行模式**：在 Tauri 桌面运行时调用系统底层硬件与原生文件系统；在纯浏览器环境运行时自动切换为沙盒模拟模式。

---

## 技术栈

| 模块 | 核心技术 | 说明 |
| :--- | :--- | :--- |
| **包管理器** | **pnpm (v9+)** | 快速、节省磁盘空间的现代包管理器 |
| **前端界面** | React 19 + TypeScript | 最新 React 19 函数式组件架构 |
| **样式与图标** | Tailwind CSS v4 + Lucide React | 现代原子化 CSS，内置 VS Code 2026 Dark 调色 |
| **构建脚手架** | Vite 6 | 极速前端热重载构建工具 |
| **桌面运行时** | Tauri v2 | 内存占用远低于 Electron，安全隔离的跨平台容器 |
| **底层核心 (Rust)** | Tokio + Axum + Reqwest + Rusqlite | 异步运行时、高并发文件传输服务与本地 SQLite 持久化 |

---

## 系统环境要求

在本地打包前，请确保您的开发机已安装以下环境：

### 1. Node.js 与 pnpm 环境

- **Node.js**：版本 `>= 18.0.0`（推荐 **v20 LTS** 或 **v22 LTS**）
- **pnpm**：版本 `>= 9.0.0`

如果尚未安装 `pnpm`，可通过以下方式之一安装：

```bash
# 方式 1：通过 Node.js 自带的 corepack 启用（推荐）
corepack enable
corepack prepare pnpm@latest --activate

# 方式 2：全局 npm 安装
npm install -g pnpm

# 方式 3：官方独立脚本安装（macOS / Linux）
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

验证安装：
```bash
node -v
pnpm -v
```

### 2. Rust 编译环境

Tauri v2 桌面端运行与构建依赖 Rust 编译器（Stable 稳定版通道）：

- **通用安装（macOS / Linux）**：
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source $HOME/.cargo/env
  ```
- **Windows 安装**：
  访问 [https://rustup.rs](https://rustup.rs/) 下载并运行 `rustup-init.exe`，按提示选择默认安装即可。

验证安装：
```bash
rustc --version
cargo --version
```

### 3. 操作系统前置构建依赖

根据您本地的操作系统，安装 Tauri 所需的底层 C/C++ 编译器库与系统 Web 运行时：

#### Windows
1. 安装 **Visual Studio C++ Build Tools**（或安装 Visual Studio 2022 并勾选 “使用 C++ 的桌面开发” 工作负载）。
2. 安装 **WebView2 运行时**（Windows 10/11 绝大多数已内置；如无，请从微软官网下载 Evergreen Bootstrapper）。

#### macOS
安装苹果官方 Xcode 命令行工具：
```bash
xcode-select --install
```

#### Linux (Ubuntu / Debian)
安装系统编译套件及 WebKitGTK 运行依赖：
```bash
sudo apt update
sudo apt install -y \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

#### Linux (Arch Linux / Manjaro)
```bash
sudo pacman -S --needed \
  base-devel \
  curl \
  wget \
  openssl \
  webkit2gtk-4.1 \
  gtk3 \
  libappindicator-gtk3 \
  librsvg
```

---

## 依赖安装 (pnpm)

在项目根目录下克隆或解压代码后，打开终端使用 **pnpm** 安装前端与构建依赖：

```bash
pnpm install
```

> 💡 **提示**：Rust 依赖（`src-tauri/Cargo.toml` 中定义的 crates）会在首次执行编译或调试命令时由 Cargo 自动联网下载并缓存，无需手动拉取。

### 生成程序的图标

```bash
pnpm tauri icon
```

### Error Found version mismatched Tauri packages.

```bash
cd src-tauri
cargo update -p tauri
```

> 该命令只需运行一次

---

## 本地开发与调试

### 模式 A：纯 Web 界面预览（前端调试）

如果您只需要调试 UI 布局与前端交互，可直接启动纯前端开发服务器：

```bash
pnpm dev
```

启动后在浏览器打开 `http://localhost:3000` 即可预览界面，Web 环境下会自动激活内置的沙盒模拟数据。

### 模式 B：桌面端原生开发（完整功能，推荐）

该模式会同时启动 Vite 前端热重载服务和 Tauri 桌面原生窗口，享有完整的局域网真实 UDP 设备发现与文件流式传输服务：

```bash
pnpm tauri dev
```

> 首次运行会自动下载并编译 Rust 依赖，耗时通常为 1~3 分钟；后续热重载通常为毫秒到秒级。

---

## 编译与打包（导出安装包）

当您需要生成可直接分发给其他计算机的免安装程序或正式安装包时，使用以下命令完成构建。

### 一键构建命令

在项目根目录下执行：

```bash
pnpm tauri build
```

或者使用 pnpm dlx 直接调用：
```bash
pnpm dlx @tauri-apps/cli build
```

该命令会自动按序执行：
1. 调用 `pnpm run build`，由 Vite 执行 TypeScript 类型检查与前端静态资源编译优化（输出至 `dist/`）；
2. 触发 Rust Cargo 执行 `--release` 模式的高优化级别编译（开启链接时优化 LTO 与死代码剔除）；
3. 自动打包平台专属的安装包文件。

### 导出安装包路径与格式说明

打包完成后，输出的文件位于项目根目录的：
`src-tauri/target/release/bundle/`

各操作系统的产物位置如下：

| 目标平台 | 安装包格式 | 导出生成路径 |
| :--- | :--- | :--- |
| **Windows** | **`.exe`** (NSIS 现代化安装引导)<br>**`.msi`** (Windows Installer) | `src-tauri/target/release/bundle/nsis/LAN Drop_2.0.0_x64-setup.exe`<br>`src-tauri/target/release/bundle/msi/LAN Drop_2.0.0_x64_en-US.msi` |
| **macOS** | **`.dmg`** (苹果磁盘镜像文件)<br>**`.app`** (应用软件替身包) | `src-tauri/target/release/bundle/dmg/LAN Drop_2.0.0_aarch64.dmg` (Apple Silicon)<br>`src-tauri/target/release/bundle/dmg/LAN Drop_2.0.0_x64.dmg` (Intel) |
| **Linux** | **`.deb`** (Debian / Ubuntu 安装包)<br>**`.AppImage`** (全发行版即点即用) | `src-tauri/target/release/bundle/deb/lan-drop_2.0.0_amd64.deb`<br>`src-tauri/target/release/bundle/appimage/lan-drop_2.0.0_amd64.AppImage` |

> 📌 **单文件免安装运行**：在 `src-tauri/target/release/` 根目录下，还会直接生成一个独立的二进制执行文件（Windows 下为 `lan-drop.exe`，macOS / Linux 下为 `lan-drop`），无需安装双击即可直接运行。

---

## 常见问题与编译排错

### 1. 国内网络下拉取 Cargo Crates 速度慢
如果在初次构建拉取 Rust crates 时遇到超时，可在用户主目录创建或修改 `~/.cargo/config.toml`（Windows 路径为 `C:\Users\<用户名>\.cargo\config.toml`），配置国内稀疏索引镜像（如字节跳动或中科大源）：

```toml
[source.crates-io]
replace-with = 'rsproxy'

[source.rsproxy]
registry = "https://rsproxy.cn/crates.io-index"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
git-fetch-with-cli = true
```

### 2. Linux 环境提示缺少 `webkit2gtk-4.1`
Tauri v2 默认基于 `webkit2gtk-4.1` 运行时。若编译报错，请确认已执行依赖安装命令安装 `libwebkit2gtk-4.1-dev`。

### 3. Windows 提示缺少 C++ 生成工具
请确保通过 Visual Studio Installer 安装了 “使用 C++ 的桌面开发”，包含 MSVC v143 生成工具和最新的 Windows SDK。

### 4. 局域网无法发现对端设备
- 确保两台设备处于同一个 Wi-Fi 或交换机内网网段；
- 检查系统防火墙是否允许应用通过 UDP `43211` 和 TCP `34567` 端口通信。

---

## 局域网通信协议与端口说明

本工具无任何外部服务器中转，通信全程基于本地局域网 Socket 传输：

| 通信类型 | 协议 | 端口 | 功能说明 |
| :--- | :--- | :--- | :--- |
| **设备自动发现** | UDP Multicast（组播） | `43211`（组播组 `224.0.0.167`） | 周期性心跳广播与解析局域网活跃节点 |
| **文件流传输与消息** | TCP (HTTP/1.1 & Stream) | `34567` | 流式传输与即时投送服务 |

文件默认保存路径：`系统下载目录/lan-drop/`
