import json
import urllib.request
import urllib.parse
from typing import Dict, Any, Optional

class Notifier:
    def __init__(self, config: Dict[str, Any]):
        self.config = config.get("notifications", {})
        self.enabled = self.config.get("enabled", False)
        self.bark_key = self.config.get("bark_key", "").strip()
        self.pushplus_token = self.config.get("pushplus_token", "").strip()
        self.serverchan_sendkey = self.config.get("serverchan_sendkey", "").strip()

    def send(self, title: str, body: str, url: Optional[str] = None):
        """Send notification across configured channels."""
        if not self.enabled:
            return

        if self.bark_key:
            self._send_bark(title, body, url)
        if self.pushplus_token:
            self._send_pushplus(title, body, url)
        if self.serverchan_sendkey:
            self._send_serverchan(title, body, url)

    def _send_bark(self, title: str, body: str, url: Optional[str] = None):
        """Send iOS push via Bark with one-click direct URL launch."""
        try:
            api_url = f"https://api.day.app/{self.bark_key}"
            payload_dict = {
                "title": title,
                "body": body,
                "group": "Antigravity",
                "icon": "https://cdn-icons-png.flaticon.com/512/4712/4712109.png"
            }
            if url:
                payload_dict["url"] = url
            payload = json.dumps(payload_dict).encode("utf-8")
            req = urllib.request.Request(
                api_url,
                data=payload,
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "User-Agent": "AntigravityRemoteStudio/1.0"
                }
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()
            print("[Notifier] Bark 手机通知发送成功！")
        except Exception as e:
            print(f"[Notifier] Bark push error: {e}")

    def _send_pushplus(self, title: str, body: str, url: Optional[str] = None):
        """Send WeChat push via PushPlus with clickable link."""
        try:
            api_url = "http://www.pushplus.plus/send"
            content = body
            if url:
                content += f"\n\n---\n👉 **[点击这里直接打开反重力工作台]({url})**"
            payload = json.dumps({
                "token": self.pushplus_token,
                "title": title,
                "content": content,
                "template": "markdown"
            }).encode("utf-8")
            req = urllib.request.Request(api_url, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp_text = resp.read().decode("utf-8", errors="ignore")
            print("[Notifier] PushPlus 微信通知发送成功！")
        except Exception as e:
            print(f"[Notifier] PushPlus push error: {e}")

    def _send_serverchan(self, title: str, body: str, url: Optional[str] = None):
        """Send WeChat push via ServerChan (Turbo)."""
        try:
            api_url = f"https://sctapi.ftqq.com/{self.serverchan_sendkey}.send"
            desp = body
            if url:
                desp += f"\n\n---\n👉 **[点击这里直接打开反重力工作台]({url})**"
            data = urllib.parse.urlencode({"title": title, "desp": desp}).encode("utf-8")
            req = urllib.request.Request(api_url, data=data)
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp_text = resp.read().decode("utf-8", errors="ignore")
            print("[Notifier] Server酱 微信通知发送成功！")
        except Exception as e:
            print(f"[Notifier] ServerChan push error: {e}")
