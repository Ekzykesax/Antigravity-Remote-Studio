import os
import sys
import time
import json
import secrets
import hashlib
import ipaddress
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, Union
from fastapi import Request

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

class AuthManager:
    """
    Antigravity Remote Studio Enterprise Auth Manager:
    - First-time setup: forces user to initialize master password.
    - Session-bound auth: binds session token to both (device_id, client_ip).
    - Zero-friction re-entry: same IP & browser/device automatically bypass password.
    - Security-first: different IP or different browser prompts for password.
    """
    def __init__(self, config_path: Path, sessions_path: Path):
        self.config_path = config_path
        self.sessions_path = sessions_path
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.config_cache: Dict[str, Any] = {}
        self.session_ttl_sec = 30 * 86400  # 30 days
        self._load_config()
        self._load_sessions()

    def _load_config(self) -> Dict[str, Any]:
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    self.config_cache = json.load(f)
            except Exception as e:
                print(f"[AuthManager] Warning: failed to read config.json: {e}")
                self.config_cache = {}
        return self.config_cache

    def _save_config(self):
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self.config_cache, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[AuthManager] Error saving config.json: {e}")

    def _load_sessions(self):
        if self.sessions_path.exists():
            try:
                with open(self.sessions_path, "r", encoding="utf-8") as f:
                    self.sessions = json.load(f)
            except Exception:
                self.sessions = {}
        else:
            self.sessions = {}

    def _save_sessions(self):
        try:
            self.sessions_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.sessions_path, "w", encoding="utf-8") as f:
                json.dump(self.sessions, f, indent=2)
        except Exception as e:
            print(f"[AuthManager] Error saving sessions: {e}")

    @staticmethod
    def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
        if not salt:
            salt = secrets.token_hex(16)
        pwd_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            100_000
        ).hex()
        return pwd_hash, salt

    def is_initialized(self) -> bool:
        """Check if master password has been set."""
        self._load_config()
        auth_cfg = self.config_cache.get("auth", {})
        pwd_hash = auth_cfg.get("password_hash")
        if pwd_hash and str(pwd_hash).strip():
            return True
        return False

    def setup_password(self, password: str) -> bool:
        """Set initial master password."""
        if not password or len(password.strip()) < 4:
            return False
        pwd_hash, salt = self.hash_password(password.strip())
        auth_cfg = self.config_cache.setdefault("auth", {})
        auth_cfg["initialized"] = True
        auth_cfg["password_hash"] = pwd_hash
        auth_cfg["salt"] = salt
        auth_cfg["session_ttl_days"] = 30
        self._save_config()
        print("[AuthManager] Master password initialized and saved successfully.")
        return True

    def verify_password(self, password: str) -> bool:
        """Verify entered password against stored hash or fallback token."""
        if not password:
            return False
        self._load_config()
        auth_cfg = self.config_cache.get("auth", {})
        pwd_hash = auth_cfg.get("password_hash")
        salt = auth_cfg.get("salt")

        if pwd_hash and salt:
            calculated, _ = self.hash_password(password.strip(), salt)
            if secrets.compare_digest(calculated, pwd_hash):
                return True

        # Fallback check against legacy server.auth_token if present
        legacy_token = self.config_cache.get("server", {}).get("auth_token")
        if legacy_token and secrets.compare_digest(password.strip(), str(legacy_token).strip()):
            return True

        return False

    def create_session(self, client_ip: str, device_id: str, user_agent: str = "") -> str:
        """Create new session bound to both device_id and client_ip."""
        token = secrets.token_urlsafe(32)
        now = time.time()
        self.sessions[token] = {
            "token": token,
            "client_ip": client_ip.strip(),
            "device_id": device_id.strip() if device_id else "unknown_device",
            "user_agent": user_agent[:180],
            "created_at": now,
            "last_active": now
        }
        self._save_sessions()
        return token

    def verify_session(self, session_token: Optional[str], client_ip: str, device_id: str) -> Tuple[bool, str]:
        """
        Verify if request matches an active session.
        Rule: Same IP AND Same Browser/Device -> True (免密)
              Different IP OR Different Browser -> False (需输密码)
        """
        if not session_token:
            return False, "no_token"

        session = self.sessions.get(session_token)
        if not session:
            return False, "invalid_session"

        now = time.time()
        if now - session.get("last_active", 0) > self.session_ttl_sec:
            self.sessions.pop(session_token, None)
            self._save_sessions()
            return False, "session_expired"

        # 1. Device / Browser check
        sess_device = session.get("device_id", "")
        req_device = device_id.strip() if device_id else ""
        if sess_device and req_device and sess_device != req_device:
            return False, "device_mismatch"

        # 2. IP check
        sess_ip = session.get("client_ip", "")
        curr_ip = client_ip.strip() if client_ip else ""

        # Normalize loopback
        if sess_ip in ["127.0.0.1", "localhost", "::1"] and curr_ip in ["127.0.0.1", "localhost", "::1"]:
            pass
        elif sess_ip and curr_ip and sess_ip != curr_ip:
            # Different IP requires re-authentication!
            return False, "ip_mismatch"

        # Touch last_active (debounced: save at most once every 5 minutes)
        if now - session.get("last_active", 0) > 300:
            session["last_active"] = now
            self._save_sessions()

        return True, "ok"

    def revoke_session(self, session_token: str):
        if session_token in self.sessions:
            del self.sessions[session_token]
            self._save_sessions()

    @staticmethod
    def is_private_or_local_host(host_str: str) -> bool:
        """Check if a host string is localhost, private LAN IP, or .local/.lan."""
        if not host_str:
            return False
        # Strip port and brackets
        h = host_str.split(":")[0].strip().strip("[]").lower()
        if h in ["localhost", "127.0.0.1", "::1", "testserver"]:
            return True
        if h.endswith(".local") or h.endswith(".lan"):
            return True
        try:
            ip = ipaddress.ip_address(h)
            return ip.is_private or ip.is_loopback or ip.is_link_local
        except ValueError:
            # Domain name (e.g. pinggy.link, remote server domain) -> not local
            return False

    def is_lan_request(self, request: Any) -> bool:
        """
        Determine if the request originates purely from the local machine or local area network (LAN).
        If it passes through an external tunnel, public VPS, or public domain, it is NOT LAN.
        """
        if not request:
            return False

        # 1. Check Host header: if Host is a public domain or public IP, it came via tunnel/remote
        host_header = request.headers.get("host", "")
        if host_header:
            host_name = host_header.split(":")[0].strip()
            if not self.is_private_or_local_host(host_name):
                return False

        # 2. Check proxy headers indicating external source
        for h in ["cf-connecting-ip", "x-real-ip"]:
            ip_val = request.headers.get(h, "").strip()
            if ip_val and not self.is_private_or_local_host(ip_val):
                return False

        x_forwarded_for = request.headers.get("x-forwarded-for", "").strip()
        if x_forwarded_for:
            for part in x_forwarded_for.split(","):
                p = part.strip()
                if p and not self.is_private_or_local_host(p):
                    return False

        # 3. Check direct socket client host
        if request.client and request.client.host:
            if not self.is_private_or_local_host(request.client.host):
                return False

        return True

    @staticmethod
    def resolve_client_ip(request: Any) -> str:
        """
        Extract effective client IP.
        Supports Cloudflare, Nginx, FRP, Pinggy, reported public IP from client,
        and fallback direct TCP socket.
        """
        # 1. Standard proxy headers
        for h in ["cf-connecting-ip", "x-real-ip"]:
            val = request.headers.get(h)
            if val and val.strip():
                return val.strip()

        x_forwarded_for = request.headers.get("x-forwarded-for")
        if x_forwarded_for and x_forwarded_for.strip():
            first_ip = x_forwarded_for.split(",")[0].strip()
            if first_ip and first_ip != "127.0.0.1":
                return first_ip

        # 2. Client reported IP (critical when raw SSH reverse port forwarding gives 127.0.0.1)
        client_rep = request.headers.get("x-client-ip")
        if client_rep and client_rep.strip() and client_rep.strip() != "127.0.0.1":
            return client_rep.strip()

        # 3. Direct socket IP
        if request.client and request.client.host:
            return request.client.host

        return "127.0.0.1"
