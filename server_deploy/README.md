# 云服务器部署指南 (Windows & Linux 双平台 FRP 中继)

如果你拥有一台国内或海外云服务器（无论是 **Windows Server** 还是 **Linux / Ubuntu / CentOS**，1C1G 或 2C2G 均可）：
通过自建 FRP 中继节点，能够获得 **超低延迟 (10~25ms)、永久固定公网 IP/域名、绝对私密** 的手机端远程访问体验。

> 💡 **核心概念明确**：  
> **Antigravity IDE、本地代码库、ComfyUI 均留在你当前的本地主力电脑上运行**。  
> 云服务器仅仅充当轻量级公网中继器（仅运行几兆内存的 `frps`），**无需在云服务器上安装任何大型 AI 环境**！

---

## 必备准备：在云厂商控制台放行安全组端口

无论使用 Windows 还是 Linux 云服务器，请先在云厂商管理控制台（阿里云、腾讯云、华为云等）的【安全组 / 防火墙】添加入方向规则（TCP 协议）：
- `7000`：FRP 客户端连接与握手端口（必须）
- `8888`：手机端远程访问 Web 控制台端口（必须）
- `7500`（可选）：FRP 网页仪表盘端口

---

## 方案 1：云服务器是 Windows (Windows Server 2016/2019/2022)

我们已在 `server_deploy/windows/` 目录准备好了全套自动化脚本：

### 方法 A：一键全自动部署（推荐）
1. 将 `server_deploy/windows/` 文件夹复制或上传到你的 Windows 云服务器上。
2. 在该文件夹内，右键以**管理员身份运行** `deploy.ps1`（或直接双击 `start_frps.bat`）。
3. 脚本会自动：
   - 自动在 Windows 本地高级安全防火墙中放行 `7000` 与 `8888` 端口；
   - 自动从 GitHub 下载官方适配 Windows 的 `frps.exe` 并解压；
   - 启动 FRP 服务端监听。

### 方法 B：手动 3 步启动
1. 访问 [FRP 官方 Releases](https://github.com/fatedier/frp/releases)，下载 Windows 版本的压缩包（如 `frp_0.61.1_windows_amd64.zip`）。
2. 解压后，将其中的 `frps.exe` 和本目录下的 `frps.toml` 放在同一目录下。
3. 双击 `start_frps.bat` 或在 CMD / PowerShell 中运行：
   ```cmd
   frps.exe -c frps.toml
   ```
4. 控制台显示 `frps started successfully` 即表示中继服务端启动成功！保持窗口最小化即可。

---

## 方案 2：云服务器是 Linux / Docker

如果你的云服务器安装了 Linux 或 Docker，可以直接一行命令启动：

```bash
mkdir -p /opt/antigravity_frps && cd /opt/antigravity_frps

# 1. 写入配置文件
cat > frps.toml << 'EOF'
bindPort = 7000
auth.token = "antigravity"

webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "admin8888"
EOF

# 2. 一键启动 Docker 容器 (随开机自启)
docker run -d \
  --name antigravity_frps \
  --restart always \
  --network host \
  -v $(pwd)/frps.toml:/etc/frp/frps.toml \
  fatedier/frps:v0.61.1 -c /etc/frp/frps.toml
```

---

## 最终步：在本地主力电脑上连接云服务器

当中继服务端在你的云服务器上运行后，回到你平时用 Antigravity 的**本地电脑**：

1. 打开本地项目的 `config.json`，修改 `network` 部分：
   ```json
   "network": {
     "mode": "cloud",
     "vps": {
       "host": "你的云服务器公网IP",
       "server_port": 7000,
       "remote_port": 8888,
       "token": "antigravity"
     }
   }
   ```
2. 在本地电脑双击运行 `start_remote.bat`。
3. 本地会自动调用轻量客户端连接你的云服务器。现在拿起手机，打开浏览器访问：
   ```text
   http://你的云服务器公网IP:8888?key=antigravity
   ```
   即可永久、超低延迟、随时随地远程操作你本地电脑上的 Antigravity！
