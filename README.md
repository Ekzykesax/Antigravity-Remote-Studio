# Antigravity Remote Studio

Antigravity Remote Studio 是一个专为 Google Antigravity 设计的轻量级移动端 Web 远程面板。通过本工具，你可以随时在手机或平板浏览器上查看电脑端 Antigravity 的实时思考状态、发送交互指令、监控模型额度并浏览生成的图片资产。

---

## 主要功能

- **实时思维链与交互**：手机端同步呈现模型的推理思考过程（可折叠查看与思考计时）与完整输出内容，支持随时追加发送指令。
- **本地状态读取**：直接读取 Antigravity 运行日志与底层 RPC 接口，无需为 IDE 添加额外调试参数或重启开发环境。
- **模型额度监控**：直观展示 Gemini、Claude 等模型当前窗口的剩余可用额度与重置时间。  
  > ⚠️ **说明**：当前移动端仅提供额度查看功能，**暂不支持在手机端切换模型或调整思考强度**（模型与思考强度请在电脑端 IDE 中配置）。
- **历史会话管理**：支持查看本地历史对话列表，点击即可切换到对应会话继续查看。
- **图片画廊与大图预览**：聚合展示本地生成的图片资产（如 ComfyUI 生图成果），提供全屏图片预览灯箱，支持双击缩放、手势平移缩放与长按保存。
- **自适应网络与安全验证**：
  - **局域网访问**：同一 Wi-Fi 或本机（`localhost` / `192.168.x.x`）访问直接免密通行；
  - **外网穿透访问**：通过云服务器 SSH/FRP 隧道或 Pinggy 访问时，自动启用密码验证与设备指纹绑定，保障公网访问安全。
- **任务完成通知**：支持配置 Bark、Server酱 或 PushPlus，在长任务执行结束或需要交互时向手机发送提醒。

---

## 运行架构

```text
       ┌────────────────────────────────────────────────────────┐
       │                本地开发环境 (Host Computer)               │
       │                                                        │
       │  ┌──────────────────────┐    ┌──────────────────────┐  │
       │  │ Antigravity IDE 正常运行│    │ language_server.exe  │  │
       │  └──────────┬───────────┘    └──────────▲───────────┘  │
       │             │ 日志流                     │ RPC 接口     │
       │             ▼                           │              │
       │  ┌──────────────────────┐    ┌──────────┴───────────┐  │
       │  │ transcript.jsonl     │───►│ Antigravity Remote   │  │
       │  │ summaries.db / Brain │    │ Studio (Gateway)     │  │
       │  └──────────────────────┘    └──────────┬───────────┘  │
       └─────────────────────────────────────────┼──────────────┘
                                                 │
                   ┌─────────────────────────────┴────────────────────────────┐
                   ▼                                                          ▼
        【公网中继 / 穿透】                                         【局域网直连】
        云服务器 VPS (SSH/FRP) 或 Pinggy 穿透                       同一局域网 Wi-Fi 直连
        (外网访问启用安全验证)                                      (免密直接使用)
                   │                                                          │
                   └─────────────────────────────┬────────────────────────────┘
                                                 ▼
                                     ┌──────────────────────┐
                                     │  移动设备浏览器 / PWA  │
                                     │ (iOS / Android Web)  │
                                     └──────────────────────┘
```

---

## 快速使用

### 1. 启动服务 (Windows)

在项目目录下运行：
```bat
start_remote.bat
```
*(Linux / macOS 用户运行 `./start_remote.sh`)*

启动后控制台会显示当前服务访问地址与二维码。

### 2. 访问方式

- **局域网直连**：手机与电脑连接同一 Wi-Fi，用手机浏览器打开控制台打印的局域网 IP（如 `http://192.168.x.x:8888`），无需输入密码即可直接使用。
- **外网远程访问**：
  - **云服务器中继**：在 `config.json` 中配置你的服务器公网 IP，脚本会自动通过 SSH 或 FRP 建立反向端口映射；
  - **临时隧道**：无服务器用户可将 `network.mode` 设为 `tunnel`（使用 Pinggy 等穿透服务）。  
  首次通过公网打开时，页面会提示设置主访问密码。设置后，同一浏览器与 IP 访问将自动保持免密，切换网络或更换浏览器时需输入密码验证。

---

## 配置文件说明 (`config.json`)

若目录下不存在 `config.json`，服务首次启动时会自动根据 `config.example.json` 生成一份默认配置文件：

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
      "token": "你的连接密钥"
    }
  },
  "notifications": {
    "enabled": false,
    "bark_key": "",
    "pushplus_token": "",
    "serverchan_sendkey": ""
  },
  "workspace": {
    "root_dir": "",
    "gallery_subdirs": [
      "ComfyUI生图成果",
      "outputs",
      "output"
    ]
  },
  "auth": {
    "initialized": false,
    "password_hash": "",
    "salt": "",
    "session_ttl_days": 30
  }
}
```

> 提示：`config.json` 已默认加入 `.gitignore`，不会被提交到远程仓库，可放心填入私有配置。

---

## 云服务器配置（可选）

如需通过固定公网 IP 访问，可在自己的云服务器上部署中继组件：

### Windows Server 中继
参考 [`server_deploy/windows/`](server_deploy/windows/) 目录中的部署脚本 `deploy.ps1`。

### Linux Server (Docker)
```bash
# 启动 FRP 服务端
docker run -d --name antigravity_frps --restart always --network host \
  -v $(pwd)/frps.toml:/etc/frp/frps.toml fatedier/frps:v0.61.1 -c /etc/frp/frps.toml
```

详细说明可参见 [`server_deploy/README.md`](server_deploy/README.md)。

---

## 开源协议

本项目采用 [MIT License](LICENSE) 许可协议。
