import os
import sys
import socket
import subprocess
import time
import zipfile
import threading
import urllib.request
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, Callable

class NetworkManager:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.server_cfg = config.get("server", {})
        self.net_cfg = config.get("network", {})
        self.port = self.server_cfg.get("port", 8888)
        self.mode = self.net_cfg.get("mode", "lan").lower()
        self.tunnel_process = None
        self.frpc_process = None
        self.ssh_process = None
        self._stop_requested = False
        self.current_url: Optional[str] = None
        self.on_url_change_cb: Optional[Callable[[str], None]] = None

    def set_on_url_change(self, callback: Callable[[str], None]):
        """Register a callback for when public URL changes or reconnects."""
        self.on_url_change_cb = callback

    @staticmethod
    def get_local_ip() -> str:
        """Get machine's primary local IP address."""
        s = None
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
        except Exception:
            ip = "127.0.0.1"
        finally:
            if s:
                s.close()
        return ip

    def start_network(self) -> Tuple[str, str]:
        """Start network routing based on mode and return (url, mode_description)."""
        local_ip = self.get_local_ip()
        lan_url = f"http://{local_ip}:{self.port}"

        if self.mode == "cloud":
            vps_cfg = self.net_cfg.get("vps", {})
            vps_host = vps_cfg.get("host", "").strip()
            vps_remote_port = vps_cfg.get("remote_port", self.port)
            method = vps_cfg.get("method", "ssh").lower()

            if not vps_host:
                print("⚠️  [Network] VPS host not configured in config.json. Falling back to LAN mode.")
                self.current_url = lan_url
                return lan_url, "局域网直连模式 (LAN)"

            success = False
            if method == "ssh":
                success = self._start_ssh_tunnel()
                if not success:
                    print("⚠️  [Network] SSH tunnel failed, falling back to FRP...")
                    success = self._start_frpc()
            else:
                success = self._start_frpc()

            if success:
                cloud_url = f"http://{vps_host}:{vps_remote_port}"
                self.current_url = cloud_url
                desc = f"自建云服务器中继模式 ({'SSH' if method == 'ssh' else 'FRP'}: {vps_host})"
                return cloud_url, desc
            else:
                print("⚠️  [Network] Cloud relay start failed. Falling back to LAN mode.")
                self.current_url = lan_url
                return lan_url, "局域网直连模式 (LAN)"

        elif self.mode == "tunnel":
            tunnel_url = self._start_pinggy_tunnel()
            if tunnel_url:
                self.current_url = tunnel_url
                return tunnel_url, "免配置全球公网穿透模式 (Pinggy)"
            else:
                print("⚠️  [Network] Tunnel failed. Falling back to LAN mode.")
                self.current_url = lan_url
                return lan_url, "局域网直连模式 (LAN)"

        self.current_url = lan_url
        return lan_url, "局域网直连模式 (LAN)"

    def _handle_url_updated(self, new_url: str):
        """Called whenever the tunnel establishes or re-establishes with a URL."""
        if new_url and new_url != self.current_url:
            self.current_url = new_url
            print(f"\n🔄 [Network] Pinggy 公网隧道连接已更新！")
            print(f"🔗 新直连地址: {new_url}")
            if self.on_url_change_cb:
                try:
                    self.on_url_change_cb(new_url)
                except Exception as e:
                    print(f"[Network] on_url_change callback error: {e}")

    def _start_ssh_tunnel(self) -> bool:
        """Establish secure SSH reverse tunnel mapping VPS port to local gateway."""
        vps_cfg = self.net_cfg.get("vps", {})
        vps_host = vps_cfg.get("host")
        vps_user = vps_cfg.get("user", "root")
        remote_port = vps_cfg.get("remote_port", self.port)

        ssh_cmd = [
            "ssh.exe",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "BatchMode=yes",
            "-N",
            "-R", f"0.0.0.0:{remote_port}:127.0.0.1:{self.port}",
            f"{vps_user}@{vps_host}"
        ]

        # Pre-clean orphan ssh/frpc processes
        if sys.platform == "win32":
            try:
                subprocess.run(["taskkill", "/F", "/IM", "ssh.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass
        time.sleep(0.5)

        try:
            print(f"⏳ [Network] 正在建立 SSH 极速专用中继通道至 {vps_host}:{remote_port} ...")
            self.ssh_process = subprocess.Popen(
                ssh_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            time.sleep(2.0)
            if self.ssh_process.poll() is None:
                print(f"✅ [Network] 云服务器 SSH 反向穿透握手成功！(端口 {remote_port})")
                threading.Thread(target=self._ssh_watchdog, daemon=True).start()
                return True
            else:
                print("❌ [Network] SSH 穿透进程退出，可能未配置免密密钥或端口被占用。")
                return False
        except Exception as e:
            print(f"[Network] SSH tunnel start failed: {e}")
            return False

    def _ssh_watchdog(self):
        """Watchdog to automatically recover SSH tunnel if connection drops."""
        while not self._stop_requested:
            time.sleep(5)
            if self.ssh_process and self.ssh_process.poll() is not None and not self._stop_requested:
                print("⚠️ [Network] SSH 隧道连接断开，正在自动重新连接...")
                self._start_ssh_tunnel()

    def _start_pinggy_tunnel(self) -> Optional[str]:
        """Start ephemeral Pinggy tunnel with auto-recovery and change listener."""
        try:
            import pinggy
            print("⏳ [Network] 正在建立 Pinggy 免费公网隧道...")
            token = self.net_cfg.get("pinggy_token", "") or os.environ.get("PINGGY_TOKEN", "")

            mgr_self = self
            class PinggyTunnelHandler(pinggy.BaseTunnelHandler):
                def reconnection_completed(self):
                    super().reconnection_completed()
                    urls = getattr(self.tunnel, "urls", [])
                    https_url = next((u for u in urls if u.startswith("https://")), None)
                    if not https_url and urls:
                        https_url = urls[0]
                    if https_url:
                        threading.Thread(target=mgr_self._handle_url_updated, args=(https_url,), daemon=True).start()

                def tunnel_established(self, urls):
                    super().tunnel_established(urls)
                    urls = getattr(self.tunnel, "urls", [])
                    https_url = next((u for u in urls if u.startswith("https://")), None)
                    if not https_url and urls:
                        https_url = urls[0]
                    if https_url:
                        mgr_self.current_url = https_url

            tun = pinggy.start_tunnel(
                forwardto=f"localhost:{self.port}",
                token=token,
                force=True,
                localservertls=False,
                autoreconnect=True,
                eventclass=PinggyTunnelHandler
            )
            self.tunnel_process = tun

            urls = getattr(tun, "urls", [])
            https_url = next((u for u in urls if u.startswith("https://")), None)
            if not https_url and urls:
                https_url = urls[0]
            self.current_url = https_url
            return https_url
        except Exception as e:
            print(f"[Network] Pinggy error: {e}")
            return None

    def _start_frpc(self) -> bool:
        """Start local frpc client pointing to user's VPS."""
        vps_cfg = self.net_cfg.get("vps", {})
        vps_host = vps_cfg.get("host")
        vps_port = vps_cfg.get("server_port", 7000)
        remote_port = vps_cfg.get("remote_port", self.port)
        token = vps_cfg.get("token", "")

        # Write frpc.toml
        frpc_toml_path = Path("frpc.toml")
        toml_content = f"""serverAddr = "{vps_host}"
serverPort = {vps_port}
auth.token = "{token}"

[[proxies]]
name = "antigravity_web_{remote_port}"
type = "tcp"
localIP = "127.0.0.1"
localPort = {self.port}
remotePort = {remote_port}
"""
        with open(frpc_toml_path, "w", encoding="utf-8") as f:
            f.write(toml_content)

        frpc_bin = self._ensure_frpc_binary()
        if not frpc_bin:
            return False

        try:
            print(f"⏳ [Network] 正在连接云服务器中继 {vps_host}:{vps_port} ...")
            self.frpc_process = subprocess.Popen(
                [str(frpc_bin), "-c", str(frpc_toml_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            time.sleep(3.0)
            if self.frpc_process.poll() is None:
                print("✅ [Network] 云服务器 FRP 中继通道握手成功！")
                return True
            else:
                print("❌ [Network] frpc 进程启动异常退出，请检查云服务器防火墙 7000 端口是否放行。")
                return False
        except Exception as e:
            print(f"[Network] frpc launch failed: {e}")
            return False

    def _ensure_frpc_binary(self) -> Optional[Path]:
        """Ensure frpc executable exists locally or attempt download."""
        bin_name = "frpc.exe" if sys.platform == "win32" else "frpc"
        local_bin = Path(bin_name)
        if local_bin.exists():
            return local_bin

        gw_bin = Path("gateway") / bin_name
        if gw_bin.exists():
            return gw_bin

        return None

    @staticmethod
    def print_qr_code(url: str):
        """Render QR code to console."""
        try:
            import qrcode
            qr = qrcode.QRCode(border=1)
            qr.add_data(url)
            qr.make(fit=True)
            qr.print_ascii(invert=True)
        except Exception:
            pass

    def stop(self):
        """Clean up background processes."""
        self._stop_requested = True
        if self.ssh_process and self.ssh_process.poll() is None:
            try:
                self.ssh_process.terminate()
            except Exception:
                pass
        if self.frpc_process and self.frpc_process.poll() is None:
            try:
                self.frpc_process.terminate()
            except Exception:
                pass
        if self.tunnel_process:
            try:
                self.tunnel_process.stop()
            except Exception:
                pass
