import os
import json
import subprocess
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta
import psutil

MODEL_ALIASES = {
    'model_placeholder_m318': 'Gemini 3.8 Flash (High)',
    'model_placeholder_m319': 'Gemini 3.8 Flash (Medium)',
    'model_placeholder_m320': 'Gemini 3.8 Flash (Low)',
    'model_placeholder_m35': 'Claude Sonnet 4.6 (Thinking)',
    'model_placeholder_m26': 'Claude Opus 4.6 (Thinking)',
    'model_openai_gpt_oss_120b_medium': 'GPT-OSS 120B (Medium)',
}

class AgentAPI:
    def __init__(self):
        self.address = os.environ.get("ANTIGRAVITY_LS_ADDRESS")
        self.csrf_token = os.environ.get("ANTIGRAVITY_CSRF_TOKEN")
        self.exe_path = os.environ.get("ANTIGRAVITY_AGENTAPI_EXE")
        self._ensure_connection()

    def _ensure_connection(self):
        """Auto-discover language server address and CSRF token if not set in environment."""
        if self.address and self.csrf_token:
            return
        
        addr, token, exe = self._auto_discover_ls()
        if addr and token:
            self.address = addr
            self.csrf_token = token
            os.environ["ANTIGRAVITY_LS_ADDRESS"] = addr
            os.environ["ANTIGRAVITY_CSRF_TOKEN"] = token
            if exe and not self.exe_path:
                self.exe_path = exe
                os.environ["ANTIGRAVITY_AGENTAPI_EXE"] = exe

    @staticmethod
    def _auto_discover_ls() -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Scan running processes for language_server.exe to auto-discover connection."""
        for p in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                name = p.info['name'] or ''
                if 'language_server' not in name.lower():
                    continue

                cmd = p.info['cmdline'] or []
                csrf = None
                for i, arg in enumerate(cmd):
                    if arg == '--csrf_token' and i + 1 < len(cmd):
                        csrf = cmd[i + 1]
                    elif arg.startswith('--csrf_token='):
                        csrf = arg.split('=', 1)[1]

                if not csrf:
                    continue

                for conn in p.net_connections('tcp'):
                    if conn.status == 'LISTEN':
                        port = conn.laddr.port
                        try:
                            req = urllib.request.Request(f"http://localhost:{port}/healthz")
                            with urllib.request.urlopen(req, timeout=0.5) as r:
                                if r.status == 200:
                                    return f"localhost:{port}", csrf, p.exe()
                        except Exception:
                            pass
            except Exception:
                continue
        return None, None, None

    def call_rpc(self, method: str, body: Dict[str, Any] = {}) -> Dict[str, Any]:
        """Execute an RPC call to exa.language_server_pb.LanguageServerService."""
        self._ensure_connection()
        if not self.address:
            return {"error": "Antigravity Language Server not detected. Is Antigravity running?"}

        url = f"http://{self.address}/exa.language_server_pb.LanguageServerService/{method}"
        data = json.dumps(body).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "x-codeium-csrf-token": self.csrf_token or ""
        }
        req = urllib.request.Request(url, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def _format_beijing_time(iso_str: Optional[str]) -> str:
        """Convert UTC ISO timestamp to Beijing Time (UTC+8) MM/DD HH:mm."""
        if not iso_str:
            return "—"
        try:
            dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
            bj_tz = timezone(timedelta(hours=8))
            return dt.astimezone(bj_tz).strftime("%m/%d %H:%M")
        except Exception:
            return "—"

    @staticmethod
    def _format_countdown_hms(iso_str: Optional[str]) -> str:
        """Helper to format countdown string like 02:42:17 or 6天 15:05:48."""
        if not iso_str:
            return "—"
        try:
            target = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            diff = target - now
            total_secs = int(diff.total_seconds())
            if total_secs <= 0:
                return "即将重置"
            days, rem = divmod(total_secs, 86400)
            hours, rem = divmod(rem, 3600)
            mins, secs = divmod(rem, 60)
            if days > 0:
                return f"{days}天 {hours:02d}:{mins:02d}:{secs:02d}"
            return f"{hours:02d}:{mins:02d}:{secs:02d}"
        except Exception:
            return "—"

    @staticmethod
    def _format_model_name(raw_name: str) -> str:
        if not raw_name:
            return "Gemini 3.8 Flash (High)"
        clean = raw_name.lower().strip()
        if clean in MODEL_ALIASES:
            return MODEL_ALIASES[clean]
        if "gemini-3.8-flash" in clean or "gemini-3-8-flash" in clean:
            if "high" in clean:
                return "Gemini 3.8 Flash (High)"
            elif "medium" in clean:
                return "Gemini 3.8 Flash (Medium)"
            elif "low" in clean:
                return "Gemini 3.8 Flash (Low)"
            return "Gemini 3.8 Flash"
        if "m318" in clean or "flash-high" in clean:
            return "Gemini 3.8 Flash (High)"
        if "m319" in clean or "flash-medium" in clean:
            return "Gemini 3.8 Flash (Medium)"
        if "m320" in clean or "flash-low" in clean:
            return "Gemini 3.8 Flash (Low)"
        if "sonnet" in clean:
            return "Claude Sonnet 4.6 (Thinking)"
        if "opus" in clean:
            return "Claude Opus 4.6 (Thinking)"
        if "gpt" in clean or "oss" in clean:
            return "GPT-OSS 120B (Medium)"
        return raw_name

    def get_quota_groups(self) -> List[Dict[str, Any]]:
        """Retrieve quota groups from language server, splitting 5h and weekly quotas cleanly."""
        res = self.call_rpc("RetrieveUserQuotaSummary")
        groups = res.get("response", {}).get("groups", [])
        
        parsed_groups = []
        for g in groups:
            dname = g.get("displayName", "")
            gid = "gemini" if "gemini" in dname.lower() else "claude"
            short_name = "Gemini" if gid == "gemini" else "Claude / GPT"
            
            windows = {}
            for b in g.get("buckets", []):
                w = b.get("window", "") # "5h" or "weekly"
                if not w:
                    if "-5h" in b.get("bucketId", ""):
                        w = "5h"
                    elif "-weekly" in b.get("bucketId", ""):
                        w = "weekly"
                if not w:
                    continue

                frac = b.get("remainingFraction", 1.0)
                reset_time = b.get("resetTime")
                pct = round(frac * 100, 1)
                windows[w] = {
                    "window": w,
                    "label": "5h 额度" if w == "5h" else "周额度",
                    "remaining_fraction": frac,
                    "remaining_percent": pct,
                    "reset_time": reset_time,
                    "reset_time_bj": self._format_beijing_time(reset_time),
                    "countdown": self._format_countdown_hms(reset_time),
                    "note": "同组模型共享额度。"
                }
            
            parsed_groups.append({
                "id": gid,
                "name": short_name,
                "display_name": dname,
                "description": g.get("description", "同组模型共享 5 小时与周额度。"),
                "windows": windows
            })

        # Fallback if language server returned empty groups
        if not parsed_groups:
            parsed_groups = [
                {
                    "id": "gemini",
                    "name": "Gemini",
                    "display_name": "Gemini Models",
                    "description": "Gemini Flash, Gemini Pro",
                    "windows": {
                        "5h": {"window": "5h", "label": "5h 额度", "remaining_fraction": 1.0, "remaining_percent": 100.0, "reset_time": None, "reset_time_bj": "—", "countdown": "充足", "note": "同组模型共享额度。"},
                        "weekly": {"window": "weekly", "label": "周额度", "remaining_fraction": 1.0, "remaining_percent": 100.0, "reset_time": None, "reset_time_bj": "—", "countdown": "充足", "note": "同组模型共享额度。"}
                    }
                },
                {
                    "id": "claude",
                    "name": "Claude / GPT",
                    "display_name": "Claude and GPT models",
                    "description": "Claude Opus, Claude Sonnet, GPT-OSS",
                    "windows": {
                        "5h": {"window": "5h", "label": "5h 额度", "remaining_fraction": 1.0, "remaining_percent": 100.0, "reset_time": None, "reset_time_bj": "—", "countdown": "充足", "note": "同组模型共享额度。"},
                        "weekly": {"window": "weekly", "label": "周额度", "remaining_fraction": 1.0, "remaining_percent": 100.0, "reset_time": None, "reset_time_bj": "—", "countdown": "充足", "note": "同组模型共享额度。"}
                    }
                }
            ]

        return parsed_groups

    @staticmethod
    def parse_model_and_effort(raw_name: Optional[str] = None, response_model: Optional[str] = None, default_effort: str = "High") -> Tuple[str, str]:
        target = raw_name or response_model or ""
        target_lower = target.lower()

        if "flash" in target_lower or "gemini" in target_lower:
            model = "Gemini 3.8 Flash"
        elif "sonnet" in target_lower:
            model = "Claude Sonnet 4.6"
        elif "opus" in target_lower:
            model = "Claude Opus 4.6"
        elif "gpt" in target_lower:
            model = "GPT-OSS 120B"
        elif "argon" in target_lower:
            model = "Gemini 4 Argon"
        else:
            model = "Gemini 3.8 Flash"

        if "high" in target_lower:
            effort = "High"
        elif "medium" in target_lower:
            effort = "Medium"
        elif "low" in target_lower:
            effort = "Low"
        elif "thinking" in target_lower or "claude" in target_lower or "opus" in target_lower:
            effort = "Thinking"
        else:
            effort = default_effort

        return model, effort

    def get_trajectory_step_model_map(self, conversation_id: str) -> Dict[int, Dict[str, str]]:
        """Map each step index to its model name and thinking effort."""
        if not conversation_id:
            return {}
        try:
            self._ensure_connection()
            res = self.call_rpc("GetCascadeTrajectoryGeneratorMetadata", {"cascadeId": conversation_id})
            gens = res.get("generatorMetadata", [])
            if not gens:
                return {}

            step_map = {}
            for g in gens:
                meta = g.get("chatModel", {}).get("customMetadata", {})
                last_step = meta.get("last_step_index")
                p_cfg = g.get("plannerConfig", {})
                m_name = p_cfg.get("modelName")
                r_model = g.get("chatModel", {}).get("responseModel")
                
                model, effort = self.parse_model_and_effort(m_name, r_model)
                if last_step:
                    try:
                        step_map[int(last_step)] = {
                            "model_name": model,
                            "thinking_effort": effort
                        }
                    except ValueError:
                        pass
            return step_map
        except Exception:
            return {}

    def get_context_window(self, conversation_id: Optional[str] = None) -> Dict[str, Any]:
        """Retrieve real-time context window token occupancy for the current conversation."""
        self._ensure_connection()
        if not conversation_id:
            try:
                from .antigravity_core import AntigravityCore
                core = AntigravityCore()
                conversation_id = core.get_active_conversation_id()
            except Exception:
                pass

        fallback = {
            "estimated_tokens": 0,
            "max_tokens": 256000,
            "tokens_label": "0 / 256K tok",
            "used_percent": 0,
            "remaining_percent": 100,
            "sampled_model": "Gemini 3.8 Flash (High)",
            "available": False
        }
        if not conversation_id:
            return fallback

        res = self.call_rpc("GetCascadeTrajectoryGeneratorMetadata", {"cascadeId": conversation_id})
        gens = res.get("generatorMetadata", [])
        if not gens:
            return fallback

        last_gen = gens[-1]
        chat_model = last_gen.get("chatModel", {})
        start_meta = chat_model.get("chatStartMetadata", {})
        ctx_meta = start_meta.get("contextWindowMetadata", {})

        used = ctx_meta.get("estimatedTokensUsed")
        max_tokens = ctx_meta.get("maxContextTokens") or 256000
        if used is None:
            return fallback

        raw_model = chat_model.get("modelDisplayName") or chat_model.get("responseModel") or chat_model.get("model") or ""
        sampled_model = self._format_model_name(raw_model)

        used_k = f"{used / 1000:.1f}K" if used >= 1000 else str(used)
        max_k = f"{max_tokens // 1000}K" if max_tokens >= 1000 else str(max_tokens)
        used_pct = round((used / max_tokens) * 100) if max_tokens else 0
        rem_pct = max(0, 100 - used_pct)

        return {
            "estimated_tokens": used,
            "max_tokens": max_tokens,
            "tokens_label": f"{used_k} / {max_k} tok",
            "used_percent": used_pct,
            "remaining_percent": rem_pct,
            "sampled_model": sampled_model,
            "available": True
        }

    def get_models_and_quota(self, conversation_id: Optional[str] = None) -> Dict[str, Any]:
        """Fetch available models, thinking effort levels, and real-time quota information."""
        self._ensure_connection()
        
        # 1. Fetch available models and quota
        avail_resp = self.call_rpc("GetAvailableModels")
        cascade_resp = self.call_rpc("GetCascadeModelConfigData")
        quota_groups = self.get_quota_groups()
        context_window = self.get_context_window(conversation_id)

        avail_models = avail_resp.get("response", {}).get("models", {})
        quota_map = {}
        for model_id, info in avail_models.items():
            quota_info = info.get("quotaInfo", {})
            if quota_info:
                quota_map[model_id] = {
                    "remaining_fraction": quota_info.get("remainingFraction", 1.0),
                    "reset_time": quota_info.get("resetTime")
                }

        # 2. Build Separate Quotas: 5-Hour Rolling (Claude) vs Daily/Period (Gemini)
        # Claude (5-hour rolling recovery)
        claude_q = quota_map.get("claude-sonnet-4-6") or quota_map.get("claude-opus-4-6-thinking") or {}
        claude_fraction = claude_q.get("remaining_fraction", 1.0)
        claude_reset = claude_q.get("reset_time")
        quota_5hour = {
            "title": "5小时滚动配额",
            "subtitle": "Claude Sonnet 4.6 / Claude Opus 4.6",
            "cycle_type": "5hour",
            "cycle_label": "5小时滚动恢复",
            "remaining_fraction": claude_fraction,
            "remaining_percent": round(claude_fraction * 100),
            "reset_time": claude_reset,
            "countdown_text": self._format_countdown_hms(claude_reset)
        }

        # Gemini (Daily / Weekly reset)
        gemini_q = quota_map.get("gemini-3.8-flash-high") or quota_map.get("gemini-3.8-flash-medium") or {}
        gemini_fraction = gemini_q.get("remaining_fraction", 1.0)
        gemini_reset = gemini_q.get("reset_time")
        quota_daily = {
            "title": "周期配额 (按日重置)",
            "subtitle": "Gemini 3.8 Flash 全系列主力模型",
            "cycle_type": "daily",
            "cycle_label": "按日周期重置",
            "remaining_fraction": gemini_fraction,
            "remaining_percent": round(gemini_fraction * 100),
            "reset_time": gemini_reset,
            "countdown_text": self._format_countdown_hms(gemini_reset)
        }

        # 3. Detect Argon authorization
        # Argon is disabled if marked disabled in cascade config or named with -disabled in avail_models
        raw_configs = cascade_resp.get("clientModelConfigs", [])
        argon_disabled = True
        argon_reason = "当前账号未授权 (仅对 Ultra 及付费 Pro 计划开放)"
        for item in raw_configs:
            label = item.get("label", "")
            if "Argon" in label:
                if item.get("disabled") is False and item.get("tagTitle") != "Unavailable":
                    argon_disabled = False
                elif item.get("tagDescription"):
                    argon_reason = item.get("tagDescription")

        # 4. Structured Base Models (Decoupled from Reasoning Effort)
        base_models = [
            {
                "id": "gemini-3.8-flash",
                "name": "Gemini 3.8 Flash",
                "family": "Gemini",
                "icon": "✦",
                "description": "Google 核心主力模型，超快响应与全能多模态支持",
                "is_recommended": True,
                "is_available": True,
                "quota_category": "daily",
                "default_effort": "medium",
                "efforts": [
                    {"id": "low", "label": "低思考 (极速)", "effort": "Low", "model_id": "gemini-3.8-flash-low"},
                    {"id": "medium", "label": "中思考 (推荐)", "effort": "Medium", "model_id": "gemini-3.8-flash-medium", "default": True},
                    {"id": "high", "label": "高思考 (深度)", "effort": "High", "model_id": "gemini-3.8-flash-high"}
                ]
            },
            {
                "id": "claude-sonnet-4-6",
                "name": "Claude Sonnet 4.6",
                "family": "Claude",
                "icon": "🧠",
                "description": "Anthropic 旗舰代码推理模型，具备深层自省与长链思考",
                "is_recommended": True,
                "is_available": True,
                "quota_category": "5hour",
                "default_effort": "thinking",
                "efforts": [
                    {"id": "thinking", "label": "深度思考 (Thinking)", "effort": "Thinking", "model_id": "claude-sonnet-4-6", "default": True}
                ]
            },
            {
                "id": "claude-opus-4-6",
                "name": "Claude Opus 4.6",
                "family": "Claude",
                "icon": "👑",
                "description": "顶尖复杂推理与长篇架构设计，攻坚高难度任务",
                "is_recommended": False,
                "is_available": True,
                "quota_category": "5hour",
                "default_effort": "thinking",
                "efforts": [
                    {"id": "thinking", "label": "深度思考 (Thinking)", "effort": "Thinking", "model_id": "claude-opus-4-6-thinking", "default": True}
                ]
            },
            {
                "id": "gpt-oss-120b",
                "name": "GPT-OSS 120B",
                "family": "OpenAI",
                "icon": "⚡",
                "description": "开源千亿大参数模型，均衡语言与逻辑分析",
                "is_recommended": False,
                "is_available": True,
                "quota_category": "daily",
                "default_effort": "medium",
                "efforts": [
                    {"id": "medium", "label": "标准推理 (Medium)", "effort": "Medium", "model_id": "gpt-oss-120b-medium", "default": True}
                ]
            },
            {
                "id": "gemini-4-argon",
                "name": "Gemini 4 Argon",
                "family": "Gemini",
                "icon": "🔒",
                "description": "下一代先锋前沿模型，当前账号暂未授权",
                "is_recommended": False,
                "is_available": not argon_disabled,
                "unavailable_reason": argon_reason,
                "quota_category": "daily",
                "default_effort": "medium",
                "efforts": [
                    {"id": "medium", "label": "标准推理", "effort": "Medium", "model_id": "gemini-4-argon-disabled", "default": True}
                ]
            }
        ]

        # Flat models list for backward compatibility
        flat_models = []
        for bm in base_models:
            if not bm["is_available"]:
                flat_models.append({
                    "label": f"{bm['name']} (未授权)",
                    "model_id": f"{bm['id']}-disabled",
                    "family": bm["family"],
                    "effort": "None",
                    "is_recommended": False,
                    "is_available": False,
                    "unavailable_reason": bm.get("unavailable_reason"),
                    "quota": {"remaining_fraction": 0, "countdown_text": "未授权"}
                })
                continue
            for eff in bm["efforts"]:
                flat_models.append({
                    "label": f"{bm['name']} ({eff['effort']})",
                    "base_model_id": bm["id"],
                    "model_id": eff["model_id"],
                    "family": bm["family"],
                    "effort": eff["effort"],
                    "is_recommended": bm["is_recommended"] and eff.get("default", False),
                    "is_available": True,
                    "quota": quota_5hour if bm["quota_category"] == "5hour" else quota_daily
                })

        return {
            "status": "connected" if self.address else "disconnected",
            "address": self.address,
            "quota_groups": quota_groups,
            "context_window": context_window,
            "quota_5hour": quota_5hour,
            "quota_daily": quota_daily,
            "base_models": base_models,
            "models": flat_models,
            "quota_summary": quota_map
        }

    def _get_subprocess_env(self) -> Dict[str, str]:
        """Prepare environment variables with language server connection info."""
        env = os.environ.copy()
        if self.address:
            env["ANTIGRAVITY_LS_ADDRESS"] = self.address
        if self.csrf_token:
            env["ANTIGRAVITY_CSRF_TOKEN"] = self.csrf_token
        return env

    def send_message(self, conversation_id: str, content: str, title: Optional[str] = None) -> Dict[str, Any]:
        """Send a prompt/message into the target conversation."""
        self._ensure_connection()
        exe = self.exe_path or os.environ.get("ANTIGRAVITY_AGENTAPI_EXE") or "agy"

        args = [exe, "agentapi", "send-message"]
        if title:
            args.extend(["--title", title])
        args.extend([conversation_id, content])

        try:
            env = self._get_subprocess_env()
            res = subprocess.run(
                args,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=45
            )
            if res.returncode == 0:
                return {"success": True, "output": res.stdout.strip()}
            else:
                err_text = res.stderr.strip() or res.stdout.strip()
                return {"success": False, "error": err_text}
        except subprocess.TimeoutExpired:
            # Command was launched; CLI may still be waiting on turn pickup
            return {"success": True, "output": "Message dispatched, waiting for turn completion", "timeout_warning": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def new_conversation(self, prompt: str, model: str = "flash", title: Optional[str] = None) -> Dict[str, Any]:
        """Start a brand new conversation with the specified prompt and model."""
        self._ensure_connection()
        exe = self.exe_path or os.environ.get("ANTIGRAVITY_AGENTAPI_EXE") or "agy"

        # Safe fallback to standard CLI tier
        cli_tier = "flash"
        m_lower = (model or "").lower()
        if "pro" in m_lower or "claude" in m_lower:
            cli_tier = "pro"
        elif "lite" in m_lower:
            cli_tier = "flash_lite"

        args = [exe, "agentapi", "new-conversation", f"--model={cli_tier}"]
        if title:
            args.extend(["--title", title])
        args.append(prompt)

        try:
            env = self._get_subprocess_env()
            res = subprocess.run(
                args,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=15
            )
            if res.returncode == 0:
                try:
                    data = json.loads(res.stdout)
                    return {"success": True, "data": data}
                except Exception:
                    return {"success": True, "output": res.stdout.strip()}
            else:
                return {"success": False, "error": res.stderr.strip() or res.stdout.strip()}
        except Exception as e:
            return {"success": False, "error": str(e)}
