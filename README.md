# Antigravity Remote Studio 📱✨
> **Google Antigravity 专属开源跨设备移动工作台与远程交互中心**  
> *Zero-Configuration · Non-Invasive · Real-time Thinking Stream · Multi-Model & Quota · Dual-Mode Network (VPS & Tunnel)*

<p align="center">
  <img src="https://img.shields.io/badge/Antigravity-Native-6366f1?style=for-the-badge&logo=google" alt="Antigravity">
  <img src="https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge" alt="MIT License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=for-the-badge" alt="Platforms">
  <img src="https://img.shields.io/badge/Mobile-iOS%20%7C%20Android%20Web-purple?style=for-the-badge" alt="Mobile">
</p>

---

## 🌟 核心特性 (Features)

不同于市面上常见的“侵入式 CDP 调试端口 DOM 爬虫”或重型云端转发器，**Antigravity Remote Studio** 是专为 **Google Antigravity** 深度定制的纯原生移动伴侣：

- ⚡ **零重启，即启即用 (Zero-Restart & Non-Invasive)**  
  无需任何 `--remote-debugging-port` 启动参数，无需强制重启正在工作的 IDE！后台自动感知当前运行的反重力会话。
- 💭 **全量实时思维链投影 (Full Thinking Stream)**  
  手机端原生渲染大模型内部推理过程（Thinking 链折叠面板），支持实时计时与展开折叠。
- 🔋 **实时模型额度与倒计时看板 (Quota & Model Switcher)**  
  直连反重力底层 RPC 接口，毫秒级读取 Gemini 3.8 / Claude Sonnet & Opus 的精准剩余额度百分比，动态计算今日额度重置倒计时。
- 🎛️ **模型与思考强度自由切换 (Effort Level Control)**  
  手机端轻触顶部胶囊，一键无缝切换：Gemini 3.8 Flash (High / Medium / Low)、Claude 4.6 (Thinking)、GPT-OSS 120B 等。
- 🕘 **历史会话完整抽屉 (History Drawer)**  
  直接读取本地 SQLite 历史库，手机端支持关键字秒级搜索，一键切换并继续对话。
- 🖼️ **生图资产画廊与纯黑影院大图 (ComfyUI Photo Gallery & Cinema Viewer)**  
  专为生图用户打造，自动聚合工作区与 `ComfyUI生图成果/` 资产（支持成品/草稿/参考图二级分级与防尴尬隐私折叠）。内置 **100% 纯黑沉浸式灯箱**，手机横屏 16:9 无缝铺满，支持双击缩放、双指 Pinch 无级平滑缩放、轻触隐藏 UI，以及 iOS 原生 Web Share 相册防跳出直存。
- 🌐 **双轨自适应网络 (Dual-Mode Network)**  
  - **云服务器中继 (SSH 反向隧道 / FRP)**：国内 2C2G 极速中转，延迟低至 15ms，拥有永久固定访问地址；
  - **免配置全球穿透 (Pinggy / Cloudflare)**：无服务器用户双击直接出二维码，扫码即用；
  - **局域网直连 (LAN)**：同 Wi-Fi 办公零外网依赖。
- 🔔 **离线“甩手监控”通知 (Push Notifications)**  
  任务执行完毕或需要人工确认时，自动推送微信（Server酱 / PushPlus）或 iOS Bark 弹窗通知。

---

## 🏗️ 架构原理解析 (Architecture)

```text
       ┌────────────────────────────────────────────────────────┐
       │                本地开发环境 (Host Computer)               │
       │                                                        │
       │  ┌──────────────────────┐    ┌──────────────────────┐  │
       │  │ Antigravity IDE 正常运行│    │ language_server.exe  │  │
       │  └──────────┬───────────┘    └──────────▲───────────┘  │
       │             │ 实时输出                   │ 原生 RPC 交互  │
       │             ▼                           │              │
       │  ┌──────────────────────┐    ┌──────────┴───────────┐  │
       │  │ transcript.jsonl     │───►│ Antigravity Remote   │  │
       │  │ summaries.db / Brain │    │ Studio (Gateway)     │  │
       │  └──────────────────────┘    └──────────┬───────────┘  │
       └─────────────────────────────────────────┼──────────────┘
                                                 │
                   ┌─────────────────────────────┴────────────────────────────┐
                   ▼                                                          ▼
      【方案 A: 自建云服务器中继】                                【方案 B: 免费免配置穿透】
      云服务器 VPS (FRP 服务端)                                  Pinggy / Cloudflare Tunnel
      延迟 15ms · 永久固定 IP / 域名                               无需服务器 · 终端直接出二维码
                   │                                                          │
                   └─────────────────────────────┬────────────────────────────┘
                                                 ▼
                                     ┌──────────────────────┐
                                     │  你的手机 / 平板设备  │
                                     │ (iOS / Android Web)  │
                                     └──────────────────────┘
```

---

## 🚀 快速上手 (Quick Start)

### 1. 启动服务 (Windows 用户)

进入项目目录，直接双击运行：
```bat
start_remote.bat
```
终端会自动自检 Python 环境、安装微量依赖并输出 **访问链接与扫码二维码**。

*(Linux / macOS 用户请运行 `./start_remote.sh`)*

### 2. 手机端连接

- **局域网同 Wi-Fi**：手机相机直接扫描终端内的二维码即可自动登录；
- **公网外出访问**：
  - 如果使用**免费穿透**：将 `config.json` 中的 `network.mode` 设为 `"tunnel"`；
  - 如果使用**云服务器**：将 `network.mode` 设为 `"cloud"`，并填入你的云服务器 IP 与 Token（见下方配置）。

---

## ⚙️ 配置文件说明 (`config.json` / `config.example.json`)

项目首次运行时若未发现 `config.json`，会自动从 `config.example.json` 生成一份默认配置。你也可以直接修改 `config.json`（该文件已加入 `.gitignore`，安全不泄露）：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8888,
    "auth_token": "antigravity"
  },
  "network": {
    "mode": "tunnel",
    "tunnel_provider": "pinggy",
    "vps": {
      "host": "你的云服务器IP",
      "server_port": 7000,
      "remote_port": 8888,
      "token": "你的自定义连接密钥"
    }
  },
  "notifications": {
    "enabled": false,
    "bark_key": "",
    "pushplus_token": "",
    "serverchan_sendkey": ""
  }
}
```

---

## ☁️ 云服务器部署 (可选，国内 2C2G 最佳实践)

如果你有一台云服务器（如阿里云、腾讯云、华为云等），无论系统是 **Windows Server** 还是 **Linux**，都可 1 分钟启动专属中继：

### 🖥️ Windows 云服务器
进入 [`server_deploy/windows/`](server_deploy/windows/) 目录：
1. 复制该目录到你的 Windows 云服务器；
2. 右键以管理员身份运行 `deploy.ps1`（或双击 `start_frps.bat`），脚本会自动放行防火墙并拉取 `frps.exe` 启动中继。

### 🐧 Linux / Docker 云服务器
```bash
# 1. 登录云服务器，创建配置
cat > frps.toml << 'EOF'
bindPort = 7000
auth.token = "antigravity"
EOF

# 2. 一键运行 Docker 容器
docker run -d --name antigravity_frps --restart always --network host \
  -v $(pwd)/frps.toml:/etc/frp/frps.toml fatedier/frps:v0.61.1 -c /etc/frp/frps.toml
```

> 无论哪个平台，只需在云厂商安全组放行 `7000` 和 `8888` 端口，在本地电脑 `config.json` 中填入你的云服务器 IP 即可！详细说明见 [`server_deploy/README.md`](server_deploy/README.md)。

---

## 🛡️ 安全与合规说明 (Compliance & Privacy)

1. **零篡改、零破解**：本工具不修改任何二进制文件，不注入内存，完全使用 Antigravity 本地预留的官方 Sidecar 通信机制；
2. **绝对私密**：使用云服务器中继时，所有对话、思考过程与文件仅在你的电脑与你的云服务器之间流转，绝不经过任何第三方平台；
3. **开箱即用脱敏**：配置文件已完全从代码中抽离，提交至 GitHub 仓库时不会泄露任何个人 IP 或密钥。

---

## 📄 开源许可证 (License)

本项目采用 [MIT License](LICENSE) 开源协议。
