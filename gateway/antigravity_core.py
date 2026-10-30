import os
import json
import sqlite3
import glob
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta

def get_antigravity_data_dir() -> Path:
    """Locate the Antigravity data directory."""
    env_dir = os.environ.get("ANTIGRAVITY_APP_DATA_DIR")
    if env_dir and os.path.exists(env_dir):
        return Path(env_dir)
    
    # Default locations
    home = Path.home()
    default_dir = home / ".gemini" / "antigravity"
    if default_dir.exists():
        return default_dir
    
    # Check Windows AppData
    appdata = os.environ.get("APPDATA")
    if appdata:
        win_dir = Path(appdata) / ".gemini" / "antigravity"
        if win_dir.exists():
            return win_dir
            
    return default_dir

class AntigravityCore:
    def __init__(self, workspace_root: Optional[str] = None):
        self.data_dir = get_antigravity_data_dir()
        self.db_path = self.data_dir / "conversation_summaries.db"
        self.brain_dir = self.data_dir / "brain"
        
        if workspace_root:
            self.workspace_root = Path(workspace_root)
        else:
            cwd = Path.cwd()
            # If running inside Antigravity-Remote-Studio subdirectory
            if (cwd.parent / "ComfyUI生图成果").exists():
                self.workspace_root = cwd.parent
            elif (cwd / "ComfyUI生图成果").exists():
                self.workspace_root = cwd
            else:
                self.workspace_root = cwd.parent if cwd.name == "Antigravity-Remote-Studio" else cwd

    def get_db_connection(self):
        """Open a read-only SQLite connection to the conversation summaries db."""
        if not self.db_path.exists():
            return None
        # Open in URI mode read-only to avoid file locking conflicts with IDE
        db_uri = f"file:{self.db_path.as_posix()}?mode=ro"
        conn = sqlite3.connect(db_uri, uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def list_conversations(self, limit: int = 40, search: str = "") -> List[Dict[str, Any]]:
        """List past conversations ordered by last modified time."""
        conn = self.get_db_connection()
        if not conn:
            return []
        
        try:
            cursor = conn.cursor()
            if search.strip():
                query = """
                    SELECT conversation_id, title, preview, step_count, last_modified_time, status 
                    FROM conversation_summaries 
                    WHERE title LIKE ? OR preview LIKE ?
                    ORDER BY last_modified_time DESC LIMIT ?
                """
                like_term = f"%{search.strip()}%"
                rows = cursor.execute(query, (like_term, like_term, limit)).fetchall()
            else:
                query = """
                    SELECT conversation_id, title, preview, step_count, last_modified_time, status 
                    FROM conversation_summaries 
                    ORDER BY last_modified_time DESC LIMIT ?
                """
                rows = cursor.execute(query, (limit,)).fetchall()
            
            conversations = []
            for r in rows:
                conversations.append({
                    "id": r["conversation_id"],
                    "title": r["title"] or "Untitled Chat",
                    "preview": r["preview"] or "",
                    "step_count": r["step_count"] or 0,
                    "last_modified": r["last_modified_time"],
                    "status": r["status"] or "UNKNOWN"
                })
            return conversations
        except Exception as e:
            print(f"[Core] Error querying conversations: {e}")
            return []
        finally:
            conn.close()

    def get_active_conversation_id(self) -> Optional[str]:
        """Find the most recently modified active conversation ID."""
        # First check environment variable
        env_id = os.environ.get("ANTIGRAVITY_CONVERSATION_ID")
        if env_id:
            return env_id

        # Query database for most recent
        conn = self.get_db_connection()
        if conn:
            try:
                row = conn.execute(
                    "SELECT conversation_id FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 1"
                ).fetchone()
                if row:
                    return row["conversation_id"]
            except Exception:
                pass
            finally:
                conn.close()

        # Fallback to brain folder sorting
        if self.brain_dir.exists():
            subdirs = [d for d in self.brain_dir.iterdir() if d.is_dir() and d.name != "tempmediaStorage"]
            if subdirs:
                subdirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
                return subdirs[0].name
        return None

    def get_transcript_path(self, conversation_id: str) -> Optional[Path]:
        """Get the transcript.jsonl path for a conversation."""
        t_path = self.brain_dir / conversation_id / ".system_generated" / "logs" / "transcript.jsonl"
        if t_path.exists():
            return t_path
        return None

    def get_full_transcript(self, conversation_id: str, limit: Optional[int] = None, offset: int = 0) -> Dict[str, Any]:
        """Read steps from transcript.jsonl with pagination and optimization."""
        t_path = self.get_transcript_path(conversation_id)
        if not t_path or not t_path.exists():
            return {"steps": [], "total_steps": 0, "has_more": False}

        raw_lines = []
        try:
            with open(t_path, "r", encoding="utf-8", errors="ignore") as f:
                raw_lines = [line.strip() for line in f if line.strip()]
        except Exception as e:
            print(f"[Core] Error reading transcript for {conversation_id}: {e}")
            return {"steps": [], "total_steps": 0, "has_more": False}

        total_steps = len(raw_lines)
        if total_steps == 0:
            return {"steps": [], "total_steps": 0, "has_more": False}

        if limit is not None and limit > 0:
            start_idx = max(0, total_steps - offset - limit)
            end_idx = max(0, total_steps - offset)
            if start_idx >= end_idx or end_idx <= 0:
                return {"steps": [], "total_steps": total_steps, "has_more": False, "offset": offset, "limit": limit}
            target_indices = list(range(start_idx, end_idx))
            has_more = start_idx > 0
        else:
            target_indices = list(range(total_steps))
            has_more = False

        full_path = t_path.parent / "transcript_full.jsonl"
        has_full = full_path.exists()
        full_lines = None

        steps = []
        for idx in target_indices:
            line = raw_lines[idx]
            try:
                step_data = json.loads(line)
                truncated = step_data.get("truncated_fields", [])
                if truncated and has_full:
                    if full_lines is None:
                        try:
                            with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                                full_lines = f.readlines()
                        except Exception:
                            has_full = False
                    if has_full and full_lines and idx < len(full_lines):
                        try:
                            full_step = json.loads(full_lines[idx])
                            for field in truncated:
                                if field in full_step:
                                    step_data[field] = full_step[field]
                        except Exception:
                            pass
                steps.append(step_data)
            except json.JSONDecodeError:
                continue

        return {
            "steps": steps,
            "total_steps": total_steps,
            "has_more": has_more,
            "offset": offset,
            "limit": limit
        }

    def get_artifacts(self, conversation_id: str) -> List[Dict[str, Any]]:
        """Get all artifacts created in this conversation."""
        conv_dir = self.brain_dir / conversation_id
        if not conv_dir.exists():
            return []

        artifacts = []
        for file in conv_dir.glob("*.md"):
            try:
                stat = file.stat()
                with open(file, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                artifacts.append({
                    "name": file.name,
                    "path": str(file),
                    "size": stat.st_size,
                    "mtime": stat.st_mtime,
                    "content": content
                })
            except Exception:
                pass
        artifacts.sort(key=lambda a: a["mtime"], reverse=True)
        return artifacts

    def get_gallery_images(self, subdirs: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Scan workspace for images (e.g. ComfyUI outputs) with date labeling."""
        if subdirs is None:
            subdirs = ["ComfyUI生图成果", "outputs", "output"]

        images = []
        valid_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
        bj_tz = timezone(timedelta(hours=8))
        today = datetime.now(bj_tz).date()
        weekday_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

        for subdir in subdirs:
            target_dir = self.workspace_root / subdir
            if not target_dir.exists():
                continue
            
            for file in target_dir.rglob("*"):
                if file.is_file() and file.suffix.lower() in valid_exts:
                    try:
                        stat = file.stat()
                        rel_path = file.relative_to(self.workspace_root).as_posix()
                        dt = datetime.fromtimestamp(stat.st_mtime, bj_tz)
                        img_date = dt.date()
                        diff_days = (today - img_date).days

                        if diff_days == 0:
                            date_label = f"今天 · {dt.strftime('%m月%d日')}"
                        elif diff_days == 1:
                            date_label = f"昨天 · {dt.strftime('%m月%d日')}"
                        elif diff_days == 2:
                            date_label = f"前天 · {dt.strftime('%m月%d日')}"
                        elif diff_days < 7:
                            date_label = f"{dt.strftime('%m月%d日')} ({weekday_names[dt.weekday()]})"
                        else:
                            date_label = dt.strftime("%Y年%m月%d日")

                        parts = [p.strip() for p in file.parts]
                        parts_upper = [p.upper() for p in parts]

                        # 1. 业务阶段分类 (是否成品图 / 过程草稿 / 参考图)
                        if "成品图" in parts or "成品" in parts or "FINISHED" in parts_upper:
                            stage = "finished"
                            stage_label = "成品图"
                            stage_badge = "⭐ 成品"
                        elif "参考图" in parts or "REFERENCE" in parts_upper or "REF" in parts_upper:
                            stage = "reference"
                            stage_label = "参考图"
                            stage_badge = "📌 参考"
                        elif "生成的图片" in parts or "GENERATED" in parts_upper or "DRAFT" in parts_upper:
                            stage = "draft"
                            stage_label = "过程草稿"
                            stage_badge = "🎨 草稿"
                        else:
                            stage = "draft"
                            stage_label = "过程草稿"
                            stage_badge = "🎨 草稿"

                        # 2. 分级隔离 (是否 NSFW)
                        if "NSFW" in parts_upper or "NSFW" in file.name.upper():
                            rating = "nsfw"
                            rating_label = "NSFW"
                            rating_badge = "🔞 NSFW"
                            is_nsfw = True
                        else:
                            rating = "safe"
                            rating_label = "全年龄"
                            rating_badge = "🍃 全年龄"
                            is_nsfw = False

                        group_key = f"{stage}_{rating}"
                        group_label = f"{stage_label} · {rating_label}"

                        images.append({
                            "filename": file.name,
                            "rel_path": rel_path,
                            "size": stat.st_size,
                            "mtime": stat.st_mtime,
                            "dir": subdir,
                            "stage": stage,
                            "stage_label": stage_label,
                            "stage_badge": stage_badge,
                            "rating": rating,
                            "rating_label": rating_label,
                            "rating_badge": rating_badge,
                            "is_nsfw": is_nsfw,
                            "group_key": group_key,
                            "group_label": group_label,
                            "date_str": img_date.isoformat(),
                            "date_label": date_label,
                            "time_str": dt.strftime("%H:%M")
                        })
                    except Exception:
                        continue

        images.sort(key=lambda img: img["mtime"], reverse=True)
        return images
