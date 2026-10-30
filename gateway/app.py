import os
import sys
import json
import asyncio
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List, Set
from contextlib import asynccontextmanager

# Enforce UTF-8 on Windows
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query, status, File, UploadFile, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from gateway.antigravity_core import AntigravityCore
from gateway.agent_api import AgentAPI
from gateway.notifier import Notifier
from gateway.network_manager import NetworkManager
from gateway.auth_manager import AuthManager

# -----------------------------------------------------------------------------
# Configuration Loader
# -----------------------------------------------------------------------------
def load_config() -> Dict[str, Any]:
    config_path = Path("config.json")
    example_path = Path("config.example.json")
    config = {}

    if not config_path.exists() and example_path.exists():
        try:
            import shutil
            shutil.copy(example_path, config_path)
            print("[Config] 首次启动：已根据 config.example.json 自动生成初始 config.json")
        except Exception as e:
            print(f"[Config] Error copying config.example.json: {e}")

    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            print(f"[Config] Error reading config.json: {e}")

    # Environment variable overrides
    auth_token = os.environ.get("STUDIO_AUTH_TOKEN")
    if auth_token:
        config.setdefault("server", {})["auth_token"] = auth_token

    net_mode = os.environ.get("STUDIO_NETWORK_MODE")
    if net_mode:
        config.setdefault("network", {})["mode"] = net_mode

    vps_host = os.environ.get("VPS_HOST")
    if vps_host:
        config.setdefault("network", {}).setdefault("vps", {})["host"] = vps_host

    return config

config = load_config()
AUTH_TOKEN = config.get("server", {}).get("auth_token", "antigravity")

# Initialize modules
core = AntigravityCore()
agent_api = AgentAPI()
notifier = Notifier(config)
network_mgr = NetworkManager(config)
auth_mgr = AuthManager(config_path=Path("config.json"), sessions_path=Path(".cache/sessions.json"))

# -----------------------------------------------------------------------------
# State & WebSocket Manager
# -----------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        dead = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.active_connections.discard(d)

ws_manager = ConnectionManager()
active_conversation_id: Optional[str] = core.get_active_conversation_id()

# In-memory tracking to eliminate mobile freeze and message disappearance
pending_user_messages: Dict[str, List[Dict[str, Any]]] = {}
active_turn_workflow: Dict[str, List[Dict[str, Any]]] = {}
conversation_busy_until: Dict[str, float] = {}

def extract_tool_workflow_summary(tool_call: Dict[str, Any]) -> Dict[str, Any]:
    name = tool_call.get("name", "")
    args = tool_call.get("args", {})
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}

    summary = str(args.get("toolSummary", "") or args.get("toolAction", "")).strip().strip('"')

    if name == "run_command":
        cmd = str(args.get("CommandLine", "")).strip().strip('"')
        if "generate.ps1" in cmd:
            return {"icon": "⚡", "title": "执行直接文生图 (generate.ps1)", "desc": "Viggle Turbo 8步极速构图"}
        if "edit_image.ps1" in cmd:
            return {"icon": "⚡", "title": "执行高保真图像编辑 (edit_image.ps1)", "desc": "原生25步无LoRA五官像素锚定"}
        if "blend_anime_real.ps1" in cmd:
            return {"icon": "⚡", "title": "执行二次元实景融合 (blend_anime_real.ps1)", "desc": "渡月桥黄金范式双流融合渲染"}
        if "upscale" in cmd or "Remacri" in cmd:
            return {"icon": "🔍", "title": "执行 4K 神经级超分", "desc": "焦外保真双流融合放大"}
        if summary:
            return {"icon": "⚡", "title": summary, "desc": ""}
        first_token = cmd.split()[0] if cmd else "命令行"
        return {"icon": "⚡", "title": f"执行终端命令 ({first_token})", "desc": ""}

    if name in ["write_file", "edit_file"]:
        path = str(args.get("Path", "")).strip().strip('"')
        fname = Path(path).name if path else "文件"
        act = "创建/写入文件" if name == "write_file" else "修改文件"
        return {"icon": "📝", "title": act, "desc": fname}

    if name in ["read_file", "view_file"]:
        path = str(args.get("Path", "") or args.get("AbsolutePath", "")).strip().strip('"')
        fname = Path(path).name if path else "文件"
        return {"icon": "📖", "title": "读取文件", "desc": fname}

    if name == "call_mcp_tool":
        tname = str(args.get("ToolName", "") or args.get("ServerName", "")).strip().strip('"')
        return {"icon": "🎨", "title": "调用扩展工具", "desc": tname}

    if name == "search_web":
        q = str(args.get("query", "")).strip().strip('"')
        return {"icon": "🔍", "title": "网络检索", "desc": (q[:25] + "...") if len(q) > 25 else q}

    if name == "read_url_content":
        return {"icon": "🌐", "title": summary or "读取网页链接内容", "desc": ""}

    if name == "invoke_subagent":
        role = str(args.get("Role", "") or args.get("TypeName", "")).strip().strip('"')
        return {"icon": "🤖", "title": "调度子代理协作", "desc": role or "子代理"}

    if name == "manage_task":
        act = str(args.get("Action", "")).strip().strip('"')
        return {"icon": "⚙️", "title": "后台任务管理", "desc": act or "status"}

    if summary:
        return {"icon": "⚡", "title": summary, "desc": ""}

    return {"icon": "⚡", "title": f"执行动作: {name}", "desc": ""}

# -----------------------------------------------------------------------------
# Background Log Watcher
# -----------------------------------------------------------------------------
async def watch_transcripts():
    """Continuously monitors active transcript.jsonl and streams step updates."""
    global active_conversation_id
    last_file_pos = 0
    current_watched_id = None
    last_turn_notify_time = 0
    last_notified_step_index = 0

    while True:
        try:
            # Check if active conversation has changed
            latest_id = core.get_active_conversation_id()
            if latest_id and latest_id != current_watched_id:
                current_watched_id = latest_id
                active_conversation_id = latest_id
                t_init_path = core.get_transcript_path(latest_id)
                last_file_pos = t_init_path.stat().st_size if (t_init_path and t_init_path.exists()) else 0
                last_notified_step_index = 0
                if t_init_path and t_init_path.exists():
                    try:
                        with open(t_init_path, "r", encoding="utf-8", errors="ignore") as f_init:
                            for l in f_init:
                                l = l.strip()
                                if l:
                                    try:
                                        s_data = json.loads(l)
                                        s_idx = s_data.get("step_index", 0)
                                        if s_idx > last_notified_step_index:
                                            last_notified_step_index = s_idx
                                    except Exception:
                                        pass
                    except Exception:
                        pass

                await ws_manager.broadcast({
                    "type": "conversation_changed",
                    "conversation_id": latest_id
                })

            if current_watched_id:
                t_path = core.get_transcript_path(current_watched_id)
                if t_path and t_path.exists():
                    file_size = t_path.stat().st_size
                    if file_size < last_file_pos:
                        last_file_pos = 0

                    if file_size > last_file_pos:
                        with open(t_path, "r", encoding="utf-8", errors="ignore") as f:
                            f.seek(last_file_pos)
                            new_lines = f.readlines()
                            last_file_pos = f.tell()

                        step_model_map = None
                        candidate_notify_step = None
                        for line in new_lines:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                step = json.loads(line)
                                if step.get("type") == "PLANNER_RESPONSE":
                                    try:
                                        if step_model_map is None:
                                            step_model_map = agent_api.get_trajectory_step_model_map(current_watched_id)
                                        s_idx = step.get("step_index")
                                        info = step_model_map.get(s_idx)
                                        if info:
                                            step["model_name"] = info["model_name"]
                                            step["thinking_effort"] = info["thinking_effort"]
                                        else:
                                            latest_ctx = agent_api.get_context_window(current_watched_id)
                                            default_model = latest_ctx.get("sampled_model") or "Gemini 3.8 Flash"
                                            step["model_name"] = default_model
                                            step["thinking_effort"] = "High" if "Flash" in default_model else "Thinking"
                                    except Exception:
                                        pass

                                await ws_manager.broadcast({
                                    "type": "step_update",
                                    "conversation_id": current_watched_id,
                                    "step": step
                                })

                                s_type = step.get("type")
                                s_source = step.get("source")

                                if s_source == "USER_EXPLICIT" or s_type == "USER_INPUT":
                                    pending_user_messages.pop(current_watched_id, None)
                                    active_turn_workflow[current_watched_id] = []
                                    conversation_busy_until[current_watched_id] = time.time() + 180

                                if s_type == "PLANNER_RESPONSE":
                                    tc = step.get("tool_calls")
                                    if tc and isinstance(tc, list):
                                        conversation_busy_until[current_watched_id] = time.time() + 180
                                        turn_list = active_turn_workflow.setdefault(current_watched_id, [])
                                        for call in tc:
                                            action_meta = extract_tool_workflow_summary(call)
                                            if action_meta:
                                                turn_list.append(action_meta)

                                    if step.get("content") and not tc:
                                        conversation_busy_until[current_watched_id] = 0
                                        active_turn_workflow.pop(current_watched_id, None)
                                        pending_user_messages.pop(current_watched_id, None)

                                # Check if candidate for model turn completion (only final PLANNER_RESPONSE, ignore tool results which are GENERIC)
                                if (step.get("type") == "PLANNER_RESPONSE"
                                        and not step.get("tool_calls") 
                                        and step.get("content")):
                                    s_idx = step.get("step_index", 0)
                                    if s_idx > last_notified_step_index:
                                        candidate_notify_step = step
                            except Exception:
                                pass

                        if candidate_notify_step and (time.time() - last_turn_notify_time > 5):
                            last_turn_notify_time = time.time()
                            last_notified_step_index = candidate_notify_step.get("step_index", 0)
                            content = str(candidate_notify_step.get("content", "")).strip()
                            if content:
                                preview = (content[:80] + "...") if len(content) > 80 else content
                                try:
                                    notifier.send(
                                        title="Antigravity 任务回复完成 💬",
                                        body=preview,
                                        url=current_magic_url
                                    )
                                except Exception:
                                    pass
        except Exception:
            pass

        await asyncio.sleep(0.3)

@asynccontextmanager
async def lifespan(app: FastAPI):
    watcher_task = asyncio.create_task(watch_transcripts())
    yield
    watcher_task.cancel()

app = FastAPI(title="Antigravity Remote Studio Gateway", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# -----------------------------------------------------------------------------
# Security Dependency & Session Auth
# -----------------------------------------------------------------------------
class AuthSetupRequest(BaseModel):
    password: str
    device_id: Optional[str] = ""
    client_ip: Optional[str] = ""

class AuthLoginRequest(BaseModel):
    password: str
    device_id: Optional[str] = ""
    client_ip: Optional[str] = ""

def verify_auth(request: Request, key: Optional[str] = Query(None)):
    # 0. LAN Bypass: Direct local/LAN access completely bypasses password auth!
    if auth_mgr.is_lan_request(request):
        return True

    client_ip = auth_mgr.resolve_client_ip(request)
    device_id = request.headers.get("x-device-id", "").strip()

    auth_header = request.headers.get("authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif request.headers.get("x-auth-token"):
        token = request.headers.get("x-auth-token").strip()
    elif "ag_session" in request.cookies:
        token = request.cookies.get("ag_session").strip()
    elif key:
        token = key.strip()

    # Direct master password / token match in query/token -> auto allow & session auto-bind
    if key and auth_mgr.verify_password(key):
        return True
    if token and auth_mgr.verify_password(token):
        return True

    # If master password is not yet initialized, require initialization
    if not auth_mgr.is_initialized():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="System not initialized. Please set master password first.",
            headers={"X-Auth-Reason": "not_initialized"}
        )

    # Strict check: Same IP AND Same Browser/Device
    valid, reason = auth_mgr.verify_session(token, client_ip, device_id)
    if valid:
        return True

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=f"Authentication required: {reason}",
        headers={"X-Auth-Reason": reason}
    )

# -----------------------------------------------------------------------------
# Authentication Endpoints
# -----------------------------------------------------------------------------
@app.get("/api/auth/status")
async def get_auth_status(request: Request, key: Optional[str] = Query(None)):
    is_lan = auth_mgr.is_lan_request(request)
    client_ip = auth_mgr.resolve_client_ip(request)
    device_id = request.headers.get("x-device-id", "").strip()

    # Direct LAN / Local access: completely bypass password requirement
    if is_lan:
        return {
            "initialized": auth_mgr.is_initialized(),
            "authenticated": True,
            "is_lan": True,
            "client_ip": client_ip,
            "reason": "lan_bypass"
        }

    auth_header = request.headers.get("authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif request.headers.get("x-auth-token"):
        token = request.headers.get("x-auth-token").strip()
    elif "ag_session" in request.cookies:
        token = request.cookies.get("ag_session").strip()
    elif key:
        token = key.strip()

    is_init = auth_mgr.is_initialized()
    if not is_init:
        return {
            "initialized": False,
            "authenticated": False,
            "client_ip": client_ip,
            "reason": "not_initialized"
        }

    # If master password is provided directly via ?key= or token
    if token and auth_mgr.verify_password(token):
        new_token = auth_mgr.create_session(client_ip, device_id, request.headers.get("user-agent", ""))
        return {
            "initialized": True,
            "authenticated": True,
            "client_ip": client_ip,
            "session_token": new_token,
            "reason": "key_match"
        }

    valid, reason = auth_mgr.verify_session(token, client_ip, device_id)
    return {
        "initialized": True,
        "authenticated": valid,
        "client_ip": client_ip,
        "reason": reason
    }

@app.post("/api/auth/setup")
async def auth_setup(req: AuthSetupRequest, request: Request, response: Response):
    if auth_mgr.is_initialized():
        raise HTTPException(status_code=400, detail="Password already initialized")
    if len(req.password.strip()) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    success = auth_mgr.setup_password(req.password)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to initialize password")

    effective_ip = req.client_ip.strip() if req.client_ip and req.client_ip.strip() != "127.0.0.1" else auth_mgr.resolve_client_ip(request)
    device_id = req.device_id or request.headers.get("x-device-id", "unknown_device")
    token = auth_mgr.create_session(effective_ip, device_id, request.headers.get("user-agent", ""))

    response.set_cookie(
        key="ag_session",
        value=token,
        max_age=30 * 86400,
        httponly=False,
        samesite="lax"
    )
    return {
        "success": True,
        "session_token": token,
        "client_ip": effective_ip
    }

@app.post("/api/auth/login")
async def auth_login(req: AuthLoginRequest, request: Request, response: Response):
    if not auth_mgr.is_initialized():
        raise HTTPException(status_code=400, detail="System not initialized. Please setup password first.")

    if not auth_mgr.verify_password(req.password):
        return {
            "success": False,
            "error": "密码不正确，请重新输入"
        }

    effective_ip = req.client_ip.strip() if req.client_ip and req.client_ip.strip() != "127.0.0.1" else auth_mgr.resolve_client_ip(request)
    device_id = req.device_id or request.headers.get("x-device-id", "unknown_device")
    token = auth_mgr.create_session(effective_ip, device_id, request.headers.get("user-agent", ""))

    response.set_cookie(
        key="ag_session",
        value=token,
        max_age=30 * 86400,
        httponly=False,
        samesite="lax"
    )
    return {
        "success": True,
        "session_token": token,
        "client_ip": effective_ip
    }

@app.post("/api/auth/logout")
async def auth_logout(request: Request, response: Response):
    token = request.cookies.get("ag_session")
    if token:
        auth_mgr.revoke_session(token)
    response.delete_cookie("ag_session")
    return {"success": True}

# -----------------------------------------------------------------------------
# REST API Endpoints
# -----------------------------------------------------------------------------
@app.get("/api/status")
async def get_status(auth: bool = Depends(verify_auth)):
    return {
        "status": "online",
        "antigravity_connected": bool(agent_api.address),
        "ls_address": agent_api.address,
        "active_conversation_id": active_conversation_id,
        "network_mode": network_mgr.mode
    }

@app.get("/api/conversations")
async def list_conversations(limit: int = 30, search: str = "", auth: bool = Depends(verify_auth)):
    conversations = core.list_conversations(limit=limit, search=search)
    return {
        "active_id": active_conversation_id,
        "conversations": conversations
    }

@app.get("/api/conversation/{conv_id}")
async def get_conversation(
    conv_id: str,
    limit: Optional[int] = 60,
    offset: int = 0,
    all: bool = False,
    auth: bool = Depends(verify_auth)
):
    eff_limit = None if all else limit
    res = core.get_full_transcript(conv_id, limit=eff_limit, offset=offset)
    artifacts = core.get_artifacts(conv_id)
    steps = res.get("steps", [])

    # Annotate PLANNER_RESPONSE steps with model name and thinking effort
    step_model_map = agent_api.get_trajectory_step_model_map(conv_id)
    latest_ctx = agent_api.get_context_window(conv_id)
    default_model = latest_ctx.get("sampled_model") or "Gemini 3.8 Flash"

    for s in steps:
        if s.get("type") == "PLANNER_RESPONSE":
            s_idx = s.get("step_index")
            info = step_model_map.get(s_idx)
            if info:
                s["model_name"] = info["model_name"]
                s["thinking_effort"] = info["thinking_effort"]
            else:
                s["model_name"] = default_model
                s["thinking_effort"] = "High" if "Flash" in default_model else "Thinking"

    now = time.time()
    raw_pending = pending_user_messages.get(conv_id, [])
    valid_pending = []
    for p in raw_pending:
        if now - p.get("timestamp", now) < 180:
            clean_p = p.get("content", "").strip()
            already_there = any(
                (s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT") and
                str(s.get("content", "")).strip() == clean_p
                for s in steps
            )
            if not already_there:
                valid_pending.append(p)

    active_wf = active_turn_workflow.get(conv_id, [])

    # If there are unresolved pending messages, conversation is actively busy and waiting for AI response!
    if valid_pending:
        is_busy = True
    else:
        is_busy = (conversation_busy_until.get(conv_id, 0) > now)
        if steps:
            last_s = steps[-1]
            if last_s.get("type") == "PLANNER_RESPONSE" and last_s.get("content") and not last_s.get("tool_calls"):
                is_busy = False
                conversation_busy_until[conv_id] = 0
                active_turn_workflow.pop(conv_id, None)
                pending_user_messages.pop(conv_id, None)

    return {
        "id": conv_id,
        "steps": steps,
        "total_steps": res.get("total_steps", 0),
        "has_more": res.get("has_more", False),
        "offset": res.get("offset", 0),
        "limit": res.get("limit"),
        "artifacts": artifacts,
        "pending_steps": valid_pending,
        "active_workflow": active_wf,
        "is_processing": bool(is_busy or valid_pending or active_wf)
    }

@app.get("/api/models")
async def get_models(auth: bool = Depends(verify_auth)):
    return agent_api.get_models_and_quota(active_conversation_id)

@app.get("/api/quota")
async def get_quota(auth: bool = Depends(verify_auth)):
    return {
        "quota_groups": agent_api.get_quota_groups(),
        "context_window": agent_api.get_context_window(active_conversation_id)
    }

# Directory for uploaded mobile attachments
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

class SendMessageRequest(BaseModel):
    conversation_id: str
    content: str
    title: Optional[str] = None
    attachments: Optional[List[Dict[str, Any]]] = None

@app.post("/api/send")
async def send_message(req: SendMessageRequest, auth: bool = Depends(verify_auth)):
    final_content = req.content
    if req.attachments:
        attachment_lines = ["[用户随附附件]:"]
        for att in req.attachments:
            name = att.get("filename", "file")
            abs_p = att.get("abs_path") or att.get("path") or ""
            if abs_p:
                file_url = f"file:///{abs_p.replace(chr(92), '/')}"
                attachment_lines.append(f"- [{name}]({file_url})")
            else:
                attachment_lines.append(f"- {name}")
        final_content = "\n".join(attachment_lines) + "\n\n" + (final_content or "")

    now = time.time()
    pending_entry = {
        "step_index": int(now * 1000),
        "source": "USER_EXPLICIT",
        "type": "USER_INPUT",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "content": final_content,
        "is_pending": True,
        "timestamp": now
    }
    pending_user_messages.setdefault(req.conversation_id, []).append(pending_entry)
    conversation_busy_until[req.conversation_id] = now + 180

    res = agent_api.send_message(req.conversation_id, final_content, req.title)
    return res

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), auth: bool = Depends(verify_auth)):
    try:
        import time
        import re
        safe_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', file.filename or "file")
        unique_name = f"{int(time.time())}_{safe_name}"
        dest_path = UPLOAD_DIR / unique_name
        
        contents = await file.read()
        with open(dest_path, "wb") as f:
            f.write(contents)
            
        is_image = False
        if file.content_type and file.content_type.startswith("image/"):
            is_image = True
        elif dest_path.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]:
            is_image = True
            
        return {
            "success": True,
            "filename": file.filename,
            "saved_filename": unique_name,
            "url": f"/api/uploads/{unique_name}",
            "abs_path": str(dest_path.resolve()),
            "size": len(contents),
            "is_image": is_image
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/uploads/{filename}")
async def get_uploaded_file(filename: str, auth: bool = Depends(verify_auth)):
    file_path = (UPLOAD_DIR / filename).resolve()
    if not str(file_path).startswith(str(UPLOAD_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path))

class NewChatRequest(BaseModel):
    prompt: str
    model: str = "flash"
    title: Optional[str] = None

@app.post("/api/new-chat")
async def new_chat(req: NewChatRequest, auth: bool = Depends(verify_auth)):
    res = agent_api.new_conversation(req.prompt, req.model, req.title)
    return res

THUMBNAIL_DIR = Path(".cache/thumbnails")
THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)

@app.get("/api/gallery")
async def list_gallery(auth: bool = Depends(verify_auth)):
    from collections import OrderedDict
    subdirs = config.get("workspace", {}).get("gallery_subdirs", ["ComfyUI生图成果", "outputs", "output"])
    images = core.get_gallery_images(subdirs=subdirs)
    
    # 1. Category grouping order (Finished -> Draft -> Reference, with NSFW & Safe)
    cat_order = [
        ("finished_nsfw", "⭐ 成品图 · 🔞 NSFW"),
        ("finished_safe", "⭐ 成品图 · 🍃 全年龄"),
        ("draft_nsfw", "🎨 过程草稿 · 🔞 NSFW"),
        ("draft_safe", "🎨 过程草稿 · 🍃 全年龄"),
        ("reference_nsfw", "📌 参考图 · 🔞 NSFW"),
        ("reference_safe", "📌 参考图 · 🍃 全年龄"),
    ]
    
    category_groups_map = OrderedDict()
    for k, label in cat_order:
        category_groups_map[k] = {
            "key": k,
            "label": label,
            "images": []
        }
    
    date_groups_map = OrderedDict()
    counts = {
        "total": len(images),
        "stage": {
            "all": len(images),
            "finished": 0,
            "draft": 0,
            "reference": 0,
        },
        "rating": {
            "all": len(images),
            "safe": 0,
            "nsfw": 0,
        }
    }

    for img in images:
        k = img.get("group_key") or "draft_safe"
        if k not in category_groups_map:
            category_groups_map[k] = {
                "key": k,
                "label": img.get("group_label") or "其他分类",
                "images": []
            }
        category_groups_map[k]["images"].append(img)
        
        st = img.get("stage", "draft")
        if st in counts["stage"]:
            counts["stage"][st] += 1
            
        rt = img.get("rating", "safe")
        if rt in counts["rating"]:
            counts["rating"][rt] += 1

        d = img.get("date_str") or "other"
        if d not in date_groups_map:
            date_groups_map[d] = {
                "date": d,
                "label": img.get("date_label") or "其他时间",
                "images": []
            }
        date_groups_map[d]["images"].append(img)

    active_category_groups = [g for g in category_groups_map.values() if len(g["images"]) > 0]

    return {
        "total": len(images),
        "counts": counts,
        "category_groups": active_category_groups,
        "date_groups": list(date_groups_map.values()),
        "groups": active_category_groups,
        "images": images
    }

def resolve_any_image_file(raw_path: str) -> Optional[Path]:
    """Robust image file resolver across workspace, brain artifacts, and home directory."""
    import urllib.parse
    cleaned = urllib.parse.unquote(raw_path).strip()
    if cleaned.startswith("file:///"):
        cleaned = cleaned[8:]
    elif cleaned.startswith("file://"):
        cleaned = cleaned[7:]

    cleaned = cleaned.replace("\\", "/")
    # Remove leading slash on Windows like /C:/
    if len(cleaned) >= 3 and cleaned[0] == "/" and cleaned[2] == ":":
        cleaned = cleaned[1:]

    candidate_paths: List[Path] = []

    # 1. Direct absolute path
    p = Path(cleaned)
    if p.is_absolute():
        candidate_paths.append(p.resolve())

    # 2. Relative to workspace root
    cleaned_rel = cleaned.lstrip("/")
    candidate_paths.append((core.workspace_root / cleaned_rel).resolve())
    candidate_paths.append((core.workspace_root / "ComfyUI生图成果" / cleaned_rel).resolve())

    # 3. If contains .gemini or brain
    if ".gemini" in cleaned:
        gemini_sub = cleaned.split(".gemini", 1)[1].lstrip("/")
        candidate_paths.append((Path.home() / ".gemini" / gemini_sub).resolve())
        candidate_paths.append((core.data_dir.parent / gemini_sub).resolve())
        candidate_paths.append((core.data_dir / gemini_sub).resolve())
    if "brain" in cleaned:
        brain_sub = cleaned.split("brain", 1)[1].lstrip("/")
        candidate_paths.append((core.brain_dir / brain_sub).resolve())

    # 4. Search by filename across workspace ComfyUI outputs and brain dirs
    fname = Path(cleaned).name
    if fname:
        comfy_dir = core.workspace_root / "ComfyUI生图成果"
        if comfy_dir.exists():
            for f in comfy_dir.rglob(fname):
                if f.is_file():
                    candidate_paths.append(f.resolve())
                    break
        if core.brain_dir.exists():
            for f in core.brain_dir.rglob(fname):
                if f.is_file():
                    candidate_paths.append(f.resolve())
                    break

    ws_root = core.workspace_root.resolve()
    brain_root = core.brain_dir.resolve()
    home_root = Path.home().resolve()

    for cp in candidate_paths:
        try:
            if cp.exists() and cp.is_file():
                cp_str = str(cp)
                if (cp_str.startswith(str(ws_root)) or 
                    cp_str.startswith(str(brain_root)) or 
                    cp_str.startswith(str(home_root))):
                    return cp
        except Exception:
            continue

    return None

@app.api_route("/api/thumbnail", methods=["GET", "HEAD"])
async def get_thumbnail(path: str = Query(...), size: int = 360, auth: bool = Depends(verify_auth)):
    safe_path = resolve_any_image_file(path)
    if not safe_path:
        raise HTTPException(status_code=404, detail="Image not found")

    import hashlib
    stat = safe_path.stat()
    cache_key = hashlib.md5(f"{safe_path}:{stat.st_mtime}:{size}".encode("utf-8")).hexdigest()
    thumb_path = THUMBNAIL_DIR / f"{cache_key}.webp"

    if thumb_path.exists():
        return FileResponse(str(thumb_path), media_type="image/webp")

    try:
        from PIL import Image
        with Image.open(safe_path) as img:
            img = img.convert("RGB")
            img.thumbnail((size, size), Image.Resampling.LANCZOS)
            img.save(thumb_path, "WEBP", quality=80)
        return FileResponse(str(thumb_path), media_type="image/webp")
    except Exception:
        return FileResponse(str(safe_path))

@app.api_route("/api/image", methods=["GET", "HEAD"])
async def get_image(path: str = Query(...), auth: bool = Depends(verify_auth)):
    found_path = resolve_any_image_file(path)
    if not found_path:
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(str(found_path))

# -----------------------------------------------------------------------------
# WebSocket Endpoint
# -----------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    key: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    device_id: Optional[str] = Query(None),
    client_ip: Optional[str] = Query(None)
):
    global active_conversation_id
    eff_ip = client_ip or (websocket.client.host if websocket.client else "127.0.0.1")
    eff_device = device_id or ""
    auth_token = token or key or websocket.cookies.get("ag_session")

    is_authed = False
    if auth_mgr.is_lan_request(websocket):
        is_authed = True
    elif auth_token and auth_mgr.verify_password(auth_token):
        is_authed = True
    elif auth_mgr.is_initialized():
        valid, _ = auth_mgr.verify_session(auth_token, eff_ip, eff_device)
        if valid:
            is_authed = True

    if not is_authed:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws_manager.connect(websocket)
    try:
        await websocket.send_json({
            "type": "init",
            "active_conversation_id": active_conversation_id
        })
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            if action == "ping":
                await websocket.send_json({"type": "pong"})
            elif action == "set_active":
                target_id = data.get("conversation_id")
                if target_id:
                    active_conversation_id = target_id
                    await ws_manager.broadcast({
                        "type": "conversation_changed",
                        "conversation_id": target_id
                    })
            elif action == "send_message":
                conv_id = data.get("conversation_id") or active_conversation_id
                content = data.get("content", "")
                if conv_id and content:
                    res = agent_api.send_message(conv_id, content)
                    await websocket.send_json({
                        "type": "send_ack",
                        "result": res
                    })
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

# -----------------------------------------------------------------------------
# Mount Static Frontend
# -----------------------------------------------------------------------------
web_dir = Path("web")
if web_dir.exists():
    app.mount("/", StaticFiles(directory="web", html=True), name="web")

# -----------------------------------------------------------------------------
# Helper: Free Port
# -----------------------------------------------------------------------------
def free_port(target_port: int):
    """Automatically terminates any existing process listening on target_port."""
    my_pid = os.getpid()
    try:
        import psutil
        for conn in psutil.net_connections('tcp'):
            if conn.status == 'LISTEN' and conn.laddr.port == target_port:
                try:
                    if conn.pid and conn.pid != my_pid:
                        p = psutil.Process(conn.pid)
                        p.kill()
                        p.wait(timeout=1.0)
                except Exception:
                    pass
    except Exception:
        pass

    # Windows taskkill fallback for 100% reliable port liberation
    if sys.platform == "win32":
        try:
            import subprocess
            out = subprocess.check_output(f'netstat -ano | findstr :{target_port}', shell=True, text=True, stderr=subprocess.DEVNULL)
            for line in out.strip().splitlines():
                if "LISTENING" in line:
                    parts = line.split()
                    if parts:
                        pid = int(parts[-1])
                        if pid != my_pid and pid != 0:
                            subprocess.run(f'taskkill /F /PID {pid}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(0.5)
        except Exception:
            pass

# -----------------------------------------------------------------------------
# Global URL tracking & Notifications
# -----------------------------------------------------------------------------
current_magic_url = ""

def save_and_notify_url(url: str, is_update: bool = False):
    global current_magic_url
    magic_url = f"{url}?key={AUTH_TOKEN}"
    if magic_url == current_magic_url and is_update:
        return
    was_empty = not bool(current_magic_url)
    current_magic_url = magic_url

    # Save to current_url.txt for quick access
    try:
        url_file = Path("current_url.txt")
        url_file.write_text(magic_url, encoding="utf-8")
    except Exception:
        pass

    if is_update and not was_empty:
        print(f"\n🔄 [Network] 网址发生变化，最新访问链接: {magic_url}")
        network_mgr.print_qr_code(magic_url)

    notify_cfg = config.get("notifications", {})
    if notify_cfg.get("enabled", False):
        if is_update and not was_empty:
            notifier.send(
                "反重力工作台公网网址已更新 🚀",
                f"手机端最新直连地址已就绪：\n{magic_url}\n\n点击直接打开进入工作台。",
                url=magic_url
            )
        elif not is_update:
            notifier.send(
                "反重力工作台已上线 🚀",
                f"手机端直连地址已就绪：\n{magic_url}\n\n点击直接打开进入工作台。",
                url=magic_url
            )

def start_heartbeat_worker():
    """Background worker that periodically sends the latest URL to phone if enabled."""
    notify_cfg = config.get("notifications", {})
    interval_minutes = int(notify_cfg.get("heartbeat_interval_minutes", 0))
    if not notify_cfg.get("enabled", False) or interval_minutes <= 0:
        return

    def _worker():
        while True:
            time.sleep(interval_minutes * 60)
            if current_magic_url and notify_cfg.get("enabled", False):
                notifier.send(
                    "反重力工作台在线运行中 💓",
                    f"当前手机端最新直连地址：\n{current_magic_url}\n\n点击直接打开进入工作台。",
                    url=current_magic_url
                )

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------
def run():
    import uvicorn
    
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    port = config.get("server", {}).get("port", 8888)
    host = config.get("server", {}).get("host", "0.0.0.0")

    # Ensure port is completely free
    free_port(port)

    print("=" * 60)
    print("🚀 Antigravity Remote Studio (反重力移动工作台)")
    print("=" * 60)

    # Register dynamic URL update listener
    network_mgr.set_on_url_change(lambda new_url: save_and_notify_url(new_url, is_update=True))

    # Start network routing
    public_url, mode_desc = network_mgr.start_network()
    save_and_notify_url(public_url, is_update=False)

    print(f"\n📡 当前网络模式: {mode_desc}")
    print(f"🔗 访问链接: {current_magic_url}")
    print(f"🔑 访问密钥: {AUTH_TOKEN}")
    print("\n📱 手机扫码直连 (免输密码自动登录):")
    network_mgr.print_qr_code(current_magic_url)

    print("-" * 60)
    print("💡 提示: 保持本终端开启，手机即可随时随地监控与交互。按 Ctrl+C 退出。")
    print("=" * 60 + "\n")

    # Start heartbeat if configured
    start_heartbeat_worker()

    server_exit_code = 0
    try:
        print("[Gateway] 正在启动 Web 服务 (uvicorn)...")
        uvicorn.run(app, host=host, port=port, log_level="info")
        print("[Gateway] Web 服务已停止。")
    except Exception as e:
        print(f"[Gateway] Web 服务异常退出: {e}")
        import traceback
        traceback.print_exc()
        server_exit_code = 1
    finally:
        print("[Gateway] 正在清理网络路由通道...")
        network_mgr.stop()
        if server_exit_code != 0:
            sys.exit(server_exit_code)

if __name__ == "__main__":
    run()
