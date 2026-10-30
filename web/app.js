/**
 * Antigravity Remote Studio - Mobile Web App Controller
 * Claude-Inspired Minimalist Black & White Aesthetic
 */

// Ensure safe-area top inset for iPhone / standalone PWA
(function initSafeArea() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS || isStandalone || window.innerWidth < 768) {
    document.documentElement.style.setProperty('--ios-top-safe', '68px');
  } else {
    document.documentElement.style.setProperty('--ios-top-safe', '0px');
  }
})();

// Persistent unique device identifier per browser
function getDeviceId() {
  let devId = localStorage.getItem('ag_device_id');
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
    try { localStorage.setItem('ag_device_id', devId); } catch (e) {}
  }
  return devId;
}

// =============================================================================
// App State & Preferences
// =============================================================================
const state = {
  authToken: new URLSearchParams(window.location.search).get('key') || localStorage.getItem('ag_auth_key') || '',
  sessionToken: localStorage.getItem('ag_session_token') || '',
  deviceId: getDeviceId(),
  clientIp: '',
  isAuthenticated: false,
  activeConversationId: null,
  activeTitle: '未命名会话',
  conversations: [],
  quotaGroups: [
    {
      id: "gemini",
      name: "Gemini",
      display_name: "Gemini Models",
      windows: {
        "5h": { window: "5h", label: "5h 额度", remaining_fraction: 0.8, remaining_percent: 80.0, reset_time: null, reset_time_bj: "—", countdown: "充足" },
        "weekly": { window: "weekly", label: "周额度", remaining_fraction: 0.95, remaining_percent: 95.0, reset_time: null, reset_time_bj: "—", countdown: "充足" }
      }
    },
    {
      id: "claude",
      name: "Claude / GPT",
      display_name: "Claude and GPT models",
      windows: {
        "5h": { window: "5h", label: "5h 额度", remaining_fraction: 1.0, remaining_percent: 100.0, reset_time: null, reset_time_bj: "—", countdown: "充足" },
        "weekly": { window: "weekly", label: "周额度", remaining_fraction: 1.0, remaining_percent: 100.0, reset_time: null, reset_time_bj: "—", countdown: "充足" }
      }
    }
  ],
  selectedQuotaGroup: 'gemini',
  contextWindow: {
    estimated_tokens: 0,
    max_tokens: 256000,
    tokens_label: "-- / 256K tok",
    used_percent: 0,
    remaining_percent: 100,
    sampled_model: "Gemini 3.8 Flash"
  },
  quota5Hour: {
    title: "5小时滚动配额",
    subtitle: "Claude Sonnet 4.6 / Claude Opus 4.6",
    cycle_label: "5小时滚动恢复",
    remaining_percent: 100,
    countdown_text: "充足"
  },
  quotaDaily: {
    title: "周期配额 (按日重置)",
    subtitle: "Gemini 3.8 Flash 全系列主力模型",
    cycle_label: "按日周期重置",
    remaining_percent: 88,
    countdown_text: "充足"
  },
  pendingAttachments: [],
  steps: [],
  artifacts: [],
  galleryImages: [],
  ws: null,
  wsReconnectTimer: null,
  autoScroll: true,
  thinkingStartTime: null,
  thinkingInterval: null,
  thinkingElapsedSeconds: 0,
  activeStreamTimer: null,
  accumulatedThinking: [],
  currentTurnWorkflow: [],
  isProcessing: false,
  activePollTimer: null,
  renderedConvId: null
};

if (state.authToken) {
  localStorage.setItem('ag_auth_key', state.authToken);
}

// =============================================================================
// Theme Controller (Dark / Light Mode)
// =============================================================================
function initTheme() {
  const savedTheme = localStorage.getItem('ag_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;

  applyTheme(isDark);

  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      const currentDark = document.documentElement.classList.contains('dark');
      applyTheme(!currentDark);
    });
  }
}

function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('ag_theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('ag_theme', 'light');
  }
}

// Marked.js Configuration with Custom Image Renderer for Multi-Platform & Mobile
const customRenderer = new marked.Renderer();
customRenderer.image = function (hrefOrToken, title, text) {
  let href = '';
  let altText = '';
  let imgTitle = '';

  if (typeof hrefOrToken === 'object' && hrefOrToken !== null) {
    href = hrefOrToken.href || '';
    altText = hrefOrToken.text || '';
    imgTitle = hrefOrToken.title || '';
  } else {
    href = hrefOrToken || '';
    altText = text || '';
    imgTitle = title || '';
  }

  let cleanHref = href.trim();
  if (cleanHref.startsWith('file:///')) {
    cleanHref = decodeURIComponent(cleanHref.replace(/^file:\/\/\//, ''));
  } else if (cleanHref.startsWith('file://')) {
    cleanHref = decodeURIComponent(cleanHref.replace(/^file:\/\//, ''));
  }
  cleanHref = cleanHref.replace(/\\/g, '/');

  // Convert ComfyUI outputs, brain artifacts, or uploads to authenticated API URLs
  const comfyMatch = cleanHref.match(/(ComfyUI生图成果\/.*)$/i) || cleanHref.match(/(outputs?\/.*)$/i);
  const brainMatch = cleanHref.match(/(\.gemini\/antigravity\/brain\/.*)$/i) || cleanHref.match(/(brain\/[a-f0-9\-]+\/.*)$/i);
  const uploadMatch = cleanHref.match(/(uploads\/[^\/]+)$/i);

  let targetUrl = '';
  if (cleanHref.startsWith('/api/')) {
    targetUrl = getApiUrl(cleanHref);
  } else if (cleanHref.startsWith('http://') || cleanHref.startsWith('https://')) {
    targetUrl = cleanHref;
  } else {
    // Match ComfyUI outputs, brain artifacts, uploads, or general image path
    const comfyMatch = cleanHref.match(/(ComfyUI生图成果\/.*)$/i) || cleanHref.match(/(outputs?\/.*)$/i);
    const brainMatch = cleanHref.match(/(\.gemini\/antigravity\/brain\/.*)$/i) || cleanHref.match(/(brain\/[a-f0-9\-]+\/.*)$/i);
    const uploadMatch = cleanHref.match(/(uploads\/[^\/]+)$/i);

    if (comfyMatch) {
      targetUrl = getApiUrl('/api/image', { path: comfyMatch[1] });
    } else if (brainMatch) {
      targetUrl = getApiUrl('/api/image', { path: brainMatch[1] });
    } else if (uploadMatch) {
      targetUrl = getApiUrl('/api/uploads/' + uploadMatch[1].split('/').pop());
    } else if (cleanHref.includes('ComfyUI生图成果')) {
      const wsPart = cleanHref.split('ComfyUI生图成果')[1];
      targetUrl = getApiUrl('/api/image', { path: 'ComfyUI生图成果' + wsPart });
    } else {
      // General path or filename
      targetUrl = getApiUrl('/api/image', { path: cleanHref });
    }
  }

  const titleAttr = imgTitle ? ` title="${escapeHtml(imgTitle)}"` : '';
  const altAttr = altText ? ` alt="${escapeHtml(altText)}"` : ' alt="生图成果"';

  return `<div class="chat-img-wrapper my-3 rounded-2xl overflow-hidden border border-[#E5E5E3] dark:border-[#262624] shadow-md max-w-md bg-black/5 dark:bg-white/5">
    <img src="${targetUrl}" data-fullsrc="${targetUrl}"${altAttr}${titleAttr} class="w-full h-auto object-cover cursor-zoom-in transition-all duration-200 hover:scale-[1.01] hover:brightness-105 active:scale-95" loading="lazy" decoding="async" />
  </div>`;
};

marked.setOptions({
  renderer: customRenderer,
  gfm: true,
  breaks: true,
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (e) {}
    }
    return hljs.highlightAuto(code).value;
  }
});

// =============================================================================
// DOM Elements
// =============================================================================
const chatStream = document.getElementById('chat-stream');
const chatTitle = document.getElementById('chat-title');
const chatSubtitle = document.getElementById('chat-subtitle');
const headerModelLabel = document.getElementById('header-model-label');
const connDot = document.getElementById('conn-dot');
const chatForm = document.getElementById('chat-form');
const promptInput = document.getElementById('prompt-input');
const btnSend = document.getElementById('btn-send');

// Mobile Attachments
const btnAttach = document.getElementById('btn-attach');
const attachmentMenu = document.getElementById('attachment-menu');
const btnPickPhotos = document.getElementById('btn-pick-photos');
const btnPickFiles = document.getElementById('btn-pick-files');
const attachmentPhotoInput = document.getElementById('attachment-photo-input');
const attachmentFileInput = document.getElementById('attachment-file-input');
const attachmentBadge = document.getElementById('attachment-badge');
const attachmentPreviewBar = document.getElementById('attachment-preview-bar');

// Drawer Elements
const btnToggleDrawer = document.getElementById('btn-toggle-drawer');
const historyDrawer = document.getElementById('history-drawer');
const historyOverlay = document.getElementById('history-drawer-overlay');
const historyList = document.getElementById('history-list');
const historySearchInput = document.getElementById('history-search-input');
const btnNewChat = document.getElementById('btn-new-chat');

// Model & Quota Modal
const btnOpenModelModal = document.getElementById('btn-open-model-modal');
const modelModal = document.getElementById('model-modal');
const btnCloseModelModal = document.getElementById('btn-close-model-modal');
const quotaContainer = document.getElementById('quota-cards-container');

// Context Window & Quota Elements
const ctxUsedSummary = document.getElementById('ctx-used-summary');
const ctxTokens = document.getElementById('ctx-tokens');
const ctxFill = document.getElementById('ctx-fill');
const ctxSampledModel = document.getElementById('ctx-sampled-model');

const btnRefreshQuota = document.getElementById('btn-refresh-quota');
const iconRefreshQuota = document.getElementById('icon-refresh-quota');

const fiveBalance = document.getElementById('five-balance');
const fiveFill = document.getElementById('five-fill');
const fiveCountdown = document.getElementById('five-countdown');
const fiveReset = document.getElementById('five-reset');

const weekBalance = document.getElementById('week-balance');
const weekFill = document.getElementById('week-fill');
const weekCountdown = document.getElementById('week-countdown');
const weekReset = document.getElementById('week-reset');

// Gallery & Lightbox Elements
const btnOpenGallery = document.getElementById('btn-open-gallery');
const galleryModal = document.getElementById('gallery-modal');
const btnCloseGallery = document.getElementById('btn-close-gallery');
const galleryContainer = document.getElementById('gallery-container') || document.getElementById('gallery-grid');
const galleryCount = document.getElementById('gallery-count');
const lightboxModal = document.getElementById('lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxName = document.getElementById('lightbox-name');
const lightboxDownload = document.getElementById('lightbox-download');
const btnCloseLightbox = document.getElementById('btn-close-lightbox');
const btnDismissLightboxBottom = document.getElementById('btn-dismiss-lightbox-bottom');
const lightboxBackdrop = document.getElementById('lightbox-backdrop');

// =============================================================================
// Toast Notifications
// =============================================================================
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  const bgClass = type === 'error'
    ? 'bg-red-600 text-white'
    : type === 'success'
      ? 'bg-emerald-600 text-white'
      : 'bg-[#1C1917] dark:bg-white text-white dark:text-[#1C1917]';
  toast.className = `px-3.5 py-2 rounded-2xl shadow-xl text-xs font-medium flex items-center gap-2 pointer-events-auto transition-all duration-300 transform -translate-y-2 opacity-0 ${bgClass}`;
  const icon = type === 'error' ? '⚠️' : type === 'success' ? '✓' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span class="leading-snug">${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('-translate-y-2', 'opacity-0');
  });
  setTimeout(() => {
    toast.classList.add('-translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// =============================================================================
// API & WebSocket
// =============================================================================
function getApiUrl(endpoint, params = {}) {
  const url = new URL(endpoint, window.location.origin);
  if (state.sessionToken) {
    url.searchParams.set('token', state.sessionToken);
  } else if (state.authToken) {
    url.searchParams.set('key', state.authToken);
  }
  if (state.deviceId) {
    url.searchParams.set('device_id', state.deviceId);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function apiFetch(endpoint, options = {}, params = {}, retries = 1) {
  const url = getApiUrl(endpoint, params);
  const opts = { ...options };
  opts.headers = { ...(opts.headers || {}) };

  if (state.sessionToken) {
    opts.headers['Authorization'] = `Bearer ${state.sessionToken}`;
  } else if (state.authToken) {
    opts.headers['Authorization'] = `Bearer ${state.authToken}`;
  }
  if (state.deviceId) {
    opts.headers['X-Device-Id'] = state.deviceId;
  }
  if (state.clientIp) {
    opts.headers['X-Client-Ip'] = state.clientIp;
  }

  try {
    const resp = await fetch(url, opts);
    if (resp.status === 401) {
      const authReason = resp.headers.get('X-Auth-Reason') || 'unauthorized';
      if (typeof showAuthModal === 'function' && !state.isLan) {
        if (authReason === 'not_initialized') {
          showAuthModal('setup');
        } else {
          showAuthModal('login', authReason === 'ip_mismatch' ? '网络 IP 发生变化，请验证密码' : (authReason === 'device_mismatch' ? '新设备/浏览器访问，请验证密码' : '请输入密码解锁工作台'));
        }
      }
      throw new Error('Unauthorized');
    }
    if (!resp.ok) {
      throw new Error(`HTTP Error ${resp.status}`);
    }
    return await resp.json();
  } catch (err) {
    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    if (retries > 0 && isGet && err.message !== 'Unauthorized') {
      await new Promise(r => setTimeout(r, 800));
      return apiFetch(endpoint, options, params, retries - 1);
    }
    throw err;
  }
}

function initWebSocket() {
  if (state.ws) {
    try { state.ws.close(); } catch (e) {}
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  if (state.sessionToken) params.set('token', state.sessionToken);
  if (state.authToken) params.set('key', state.authToken);
  if (state.deviceId) params.set('device_id', state.deviceId);
  if (state.clientIp) params.set('client_ip', state.clientIp);

  const wsUrl = `${protocol}//${window.location.host}/ws?${params.toString()}`;

  connDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-ping';
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    connDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    chatSubtitle.textContent = 'Antigravity Native Studio';
    if (state.wsReconnectTimer) {
      clearTimeout(state.wsReconnectTimer);
      state.wsReconnectTimer = null;
    }
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {}
  };

  state.ws.onclose = (event) => {
    connDot.className = 'w-2 h-2 rounded-full bg-rose-500';
    if (event.code === 1008) {
      chatSubtitle.textContent = '未授权，请验证密码';
      if (typeof showAuthModal === 'function') {
        showAuthModal('login', '会话校验失败或来自新环境，请验证密码');
      }
      return;
    }
    chatSubtitle.textContent = '连接中断，重连中...';
    if (!state.wsReconnectTimer && state.isAuthenticated) {
      state.wsReconnectTimer = setTimeout(initWebSocket, 2500);
    }
  };

  state.ws.onerror = () => {
    connDot.className = 'w-2 h-2 rounded-full bg-rose-500';
  };
}

// =============================================================================
// Workflow Action Parser & Pending State Management (Anti-Freeze & Anti-Loss)
// =============================================================================
function extractWorkflowAction(toolCall) {
  if (!toolCall) return null;
  const name = toolCall.name || '';
  let args = toolCall.args || {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch (_) { args = {}; }
  }

  const cleanVal = (val) => {
    if (!val) return '';
    let s = String(val).trim();
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string') return parsed.trim();
      } catch (_) {
        s = s.slice(1, -1).trim();
      }
    }
    return s;
  };

  const summary = cleanVal(args.toolSummary) || cleanVal(args.toolAction);

  if (name === 'run_command') {
    const cmd = cleanVal(args.CommandLine);
    if (cmd.includes('generate.ps1')) {
      return { icon: '⚡', title: '执行直接文生图', desc: 'generate.ps1 (Viggle Turbo 8步构图)' };
    }
    if (cmd.includes('edit_image.ps1')) {
      return { icon: '⚡', title: '执行高保真图像编辑', desc: 'edit_image.ps1 (原生25步无LoRA五官锚定)' };
    }
    if (cmd.includes('blend_anime_real.ps1')) {
      return { icon: '⚡', title: '执行二次元实景融合', desc: 'blend_anime_real.ps1 (渡月桥黄金范式)' };
    }
    if (cmd.includes('upscale') || cmd.includes('Remacri')) {
      return { icon: '🔍', title: '执行 4K 极清超分', desc: '4x_foolhardy_Remacri 焦外保真双流融合' };
    }
    if (summary) {
      return { icon: '⚡', title: summary, desc: '' };
    }
    const firstWord = cmd.split(/[\s;&|]/)[0] || '终端脚本';
    return { icon: '⚡', title: '执行命令行动作', desc: firstWord };
  }

  if (name === 'write_file') {
    const p = cleanVal(args.Path);
    const fname = p ? p.split(/[/\\]/).pop() : '文件';
    return { icon: '📝', title: '创建/写入文件', desc: fname };
  }

  if (name === 'edit_file') {
    const p = cleanVal(args.Path);
    const fname = p ? p.split(/[/\\]/).pop() : '文件';
    return { icon: '📝', title: '修改文件', desc: fname };
  }

  if (name === 'read_file' || name === 'view_file') {
    const p = cleanVal(args.Path) || cleanVal(args.AbsolutePath);
    const fname = p ? p.split(/[/\\]/).pop() : '文件';
    return { icon: '📖', title: '读取文件', desc: fname };
  }

  if (name === 'call_mcp_tool') {
    const tool = cleanVal(args.ToolName) || cleanVal(args.ServerName);
    return { icon: '🎨', title: '调用扩展工具', desc: tool };
  }

  if (name === 'search_web') {
    const q = cleanVal(args.query);
    const shortQ = q ? (q.length > 28 ? q.slice(0, 28) + '...' : q) : '';
    return { icon: '🔍', title: '网络检索', desc: shortQ };
  }

  if (name === 'read_url_content') {
    return { icon: '🌐', title: summary || '读取网页链接内容', desc: '' };
  }

  if (name === 'invoke_subagent') {
    const role = cleanVal(args.Role) || cleanVal(args.TypeName) || '子代理';
    return { icon: '🤖', title: '调度子代理协作', desc: role };
  }

  if (name === 'manage_task') {
    const act = cleanVal(args.Action) || 'status';
    return { icon: '⚙️', title: '后台任务调度', desc: act };
  }

  if (summary) {
    return { icon: '⚡', title: summary, desc: '' };
  }

  return { icon: '⚡', title: `执行动作: ${name}`, desc: '' };
}

function getPendingMessages(convId) {
  if (!convId) return [];
  try {
    const raw = sessionStorage.getItem(`ag_pending_${convId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function savePendingMessage(convId, step) {
  if (!convId || !step) return;
  try {
    const list = getPendingMessages(convId);
    list.push(step);
    sessionStorage.setItem(`ag_pending_${convId}`, JSON.stringify(list));
  } catch (_) {}
}

function clearPendingMessages(convId) {
  if (!convId) return;
  try {
    sessionStorage.removeItem(`ag_pending_${convId}`);
  } catch (_) {}
}

function startActivePolling(convId, afterStepIndex = null) {
  stopActivePolling();
  if (!convId) return;
  state.activePollTimer = setInterval(async () => {
    if (!state.activeConversationId || state.activeConversationId !== convId) {
      stopActivePolling();
      return;
    }
    try {
      const data = await apiFetch(`/api/conversation/${convId}`, {}, { limit: 30, offset: 0 }, 0);
      if (data && data.steps && data.steps.length > 0) {
        const lastStep = data.steps[data.steps.length - 1];

        // Ensure this step response actually belongs to the current/new turn
        const isNewer = afterStepIndex === null || (lastStep.step_index && Number(lastStep.step_index) > Number(afterStepIndex));

        if (isNewer && lastStep.type === 'PLANNER_RESPONSE' && lastStep.content && lastStep.content.trim()) {
          stopThinkingIndicator(true);
          stopActivePolling();
          clearPendingMessages(convId);
          loadConversation(convId, false);
          return;
        }

        if (data.active_workflow && data.active_workflow.length > 0) {
          const latest = data.active_workflow[data.active_workflow.length - 1];
          updateThinkingIndicator(latest, data.active_workflow.slice(0, -1));
        }

        const localPending = getPendingMessages(convId);
        const hasUnresolvedLocal = localPending && localPending.length > 0;
        if (data.is_processing === false && (!data.pending_steps || data.pending_steps.length === 0) && !hasUnresolvedLocal) {
          stopThinkingIndicator(true);
          stopActivePolling();
          clearPendingMessages(convId);
          loadConversation(convId, false);
        }
      }
    } catch (_) {}
  }, 2500);
}

function stopActivePolling() {
  if (state.activePollTimer) {
    clearInterval(state.activePollTimer);
    state.activePollTimer = null;
  }
}

function handleWsMessage(msg) {
  if (msg.type === 'force_reload' || msg.type === 'reload') {
    const key = state.authToken || '';
    window.location.href = window.location.pathname + (key ? ('?key=' + encodeURIComponent(key)) : '') + '&_v=' + Date.now();
    return;
  }
  if (msg.type === 'init' || msg.type === 'conversation_changed') {
    if (msg.conversation_id && msg.conversation_id !== state.activeConversationId) {
      stopThinkingIndicator(true);
      stopActivePolling();
      state.accumulatedThinking = [];
      state.currentTurnWorkflow = [];
      state.activeConversationId = msg.conversation_id;
      loadConversation(msg.conversation_id);
      loadConversationsList();
    }
  } else if (msg.type === 'step_update') {
    if (msg.conversation_id === state.activeConversationId && msg.step) {
      const step = msg.step;
      if (step.type === 'PLANNER_RESPONSE') {
        if (step.thinking && step.thinking.trim()) {
          state.accumulatedThinking.push(step.thinking.trim());
        }

        // Live Workflow Steps Accumulation & Dynamic Feedback (Eliminating Frozen Feeling)
        if (step.tool_calls && Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
          for (const tc of step.tool_calls) {
            const action = extractWorkflowAction(tc);
            if (action) {
              state.currentTurnWorkflow.push(action);
            }
          }
          const latestAction = state.currentTurnWorkflow[state.currentTurnWorkflow.length - 1];
          updateThinkingIndicator(latestAction, state.currentTurnWorkflow.slice(0, -1));
        }

        // Final assistant response with actual markdown content
        if (step.content && step.content.trim()) {
          stopThinkingIndicator(true);
          stopActivePolling();
          clearPendingMessages(state.activeConversationId);
          const mergedStep = {
            ...step,
            thinking: state.accumulatedThinking.join('\n\n---\n\n'),
            workflow: [...state.currentTurnWorkflow]
          };
          state.accumulatedThinking = [];
          state.currentTurnWorkflow = [];
          appendOrUpdateStep(mergedStep, true); // stream typewriter
        }
      } else if (step.source === 'USER_EXPLICIT' || step.type === 'USER_INPUT') {
        state.accumulatedThinking = [];
        state.currentTurnWorkflow = [];
        clearPendingMessages(state.activeConversationId);
        appendOrUpdateStep(step, false);
      }
    }
  }
}

// =============================================================================
// Chat Timeline Rendering (Claude Style)
// =============================================================================
async function loadConversation(convId, isInitial = true) {
  if (!convId) return;
  state.activeConversationId = convId;
  state.accumulatedThinking = [];
  state.currentTurnWorkflow = [];
  if (state.activeStreamTimer) {
    clearInterval(state.activeStreamTimer);
    state.activeStreamTimer = null;
  }
  if (isInitial) {
    chatStream.innerHTML = `
      <div class="text-center py-20 text-[#78716C] text-sm">
        <div class="inline-block animate-spin rounded-full h-6 w-6 border-2 border-[#1C1917] dark:border-[#E6E6E5] border-t-transparent mb-3"></div>
        <p class="font-serif">正在读取会话历史...</p>
      </div>
    `;
  }

  try {
    const data = await apiFetch(`/api/conversation/${convId}`, {}, { limit: 60, offset: 0 });
    state.steps = data.steps || [];
    state.artifacts = data.artifacts || [];
    state.totalSteps = data.total_steps || state.steps.length;
    state.hasMoreSteps = Boolean(data.has_more);

    // Merge server pending steps and local sessionStorage pending steps to prevent refresh loss
    const serverPending = data.pending_steps || [];
    const localPending = getPendingMessages(convId);
    const combinedPending = [...serverPending];
    for (const lp of localPending) {
      const cleanLp = sanitizeUserMessage(lp.content);
      if (!combinedPending.some(sp => sanitizeUserMessage(sp.content) === cleanLp)) {
        combinedPending.push(lp);
      }
    }

    renderFullTimeline(
      state.steps,
      true,
      combinedPending,
      data.active_workflow || [],
      Boolean(data.is_processing)
    );
    updateHeaderTitle();
    loadModelsAndQuota();
  } catch (e) {
    chatStream.innerHTML = `
      <div class="text-center py-16 px-4">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 mb-3 text-xl">⚠️</div>
        <p class="text-sm font-medium text-[#1C1917] dark:text-[#E6E6E5]">会话数据加载暂时中断</p>
        <p class="text-xs text-[#78716C] mt-1 mb-4 max-w-xs mx-auto">由于移动网络波动或公网隧道连接延迟，未能成功读取会话</p>
        <button id="btn-retry-load" class="px-4 py-2 rounded-xl bg-[#1C1917] dark:bg-white text-white dark:text-[#1C1917] text-xs font-semibold active:scale-95 transition shadow-sm inline-flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <span>重新加载</span>
        </button>
      </div>
    `;
    const btnRetry = document.getElementById('btn-retry-load');
    if (btnRetry) btnRetry.onclick = () => loadConversation(convId, true);
  }
}

async function loadEarlierSteps() {
  const btn = document.getElementById('btn-load-earlier-steps');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在读取更早记录...';
  }
  try {
    const currentOffset = state.steps.length;
    const data = await apiFetch(`/api/conversation/${state.activeConversationId}`, {}, {
      limit: 60,
      offset: currentOffset
    });
    const newSteps = data.steps || [];
    if (newSteps.length > 0) {
      state.steps = [...newSteps, ...state.steps];
      state.hasMoreSteps = Boolean(data.has_more);
      const prevScrollHeight = chatStream.scrollHeight;
      renderFullTimeline(state.steps, false);
      chatStream.scrollTop = chatStream.scrollHeight - prevScrollHeight;
    } else {
      state.hasMoreSteps = false;
      renderFullTimeline(state.steps, false);
    }
  } catch (err) {
    showToast(`加载更早记录失败: ${err.message}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '加载失败，点击重试';
    }
  }
}

function renderFullTimeline(steps, shouldScroll = true, pendingSteps = [], activeWorkflow = [], isProcessing = false) {
  // If switching to a different conversation, do a clean clear
  const isConvSwitched = state.renderedConvId !== state.activeConversationId;
  if (isConvSwitched) {
    chatStream.innerHTML = '';
    state.renderedConvId = state.activeConversationId;
  }

  if (!steps.length && !pendingSteps.length) {
    chatStream.innerHTML = `
      <div class="text-center py-20 text-[#78716C] text-sm">
        <p class="text-3xl mb-2">✦</p>
        <p class="font-serif font-medium">新会话已就绪</p>
        <p class="text-xs text-[#A8A29E] mt-1">在下方输入框中发送指令开始协作</p>
      </div>
    `;
    return;
  }

  // Remove empty placeholder if any
  const placeholder = chatStream.querySelector('.text-center.py-20');
  if (placeholder) placeholder.remove();

  // Multi-turn consolidation: merge tool thinkings AND workflows into the final response
  let turnThinking = [];
  let turnWorkflow = [];
  const consolidated = [];

  for (const step of steps) {
    if (step.source === 'USER_EXPLICIT' || step.type === 'USER_INPUT') {
      turnThinking = [];
      turnWorkflow = [];
      consolidated.push(step);
    } else if (step.type === 'PLANNER_RESPONSE') {
      if (step.thinking && step.thinking.trim()) {
        turnThinking.push(step.thinking.trim());
      }
      if (step.tool_calls && Array.isArray(step.tool_calls)) {
        for (const tc of step.tool_calls) {
          const act = extractWorkflowAction(tc);
          if (act) turnWorkflow.push(act);
        }
      }
      // Strictly only keep assistant steps that have actual markdown dialogue content
      if (step.content && step.content.trim()) {
        consolidated.push({
          ...step,
          thinking: turnThinking.join('\n\n---\n\n'),
          workflow: [...turnWorkflow]
        });
        turnThinking = [];
        turnWorkflow = [];
      }
    }
  }

  // Append pending user messages if they haven't appeared in confirmed steps yet
  const unconfirmedPending = [];
  if (pendingSteps && pendingSteps.length > 0) {
    for (const p of pendingSteps) {
      const cleanP = sanitizeUserMessage(p.content);
      const alreadyIn = consolidated.some(c => 
        (c.source === 'USER_EXPLICIT' || c.type === 'USER_INPUT') &&
        sanitizeUserMessage(c.content) === cleanP
      );
      if (!alreadyIn) {
        unconfirmedPending.push(p);
        consolidated.push(p);
      }
    }
  }

  // Smooth DOM reconciliation: only append genuinely new steps or update pending ones, never destroy existing DOM
  const existingIndicator = document.getElementById('active-thinking-indicator');
  if (existingIndicator) existingIndicator.remove(); // temporarily detach so it stays at the very bottom

  for (const step of consolidated) {
    const stepId = `step-${step.step_index}`;
    let existingEl = document.getElementById(stepId);

    // If this step is a confirmed user message matching an existing pending element, upgrade it
    if (!existingEl && (step.source === 'USER_EXPLICIT' || step.type === 'USER_INPUT')) {
      const cleanContent = sanitizeUserMessage(step.content);
      const pendingEls = chatStream.querySelectorAll('[id^="step-pending_"]');
      for (const pEl of pendingEls) {
        if (sanitizeUserMessage(pEl.textContent).includes(cleanContent)) {
          existingEl = pEl;
          existingEl.id = stepId;
          break;
        }
      }
    }

    if (!existingEl) {
      const newEl = createStepElement(step);
      if (newEl) {
        chatStream.appendChild(newEl);
      }
    }
  }

  // Check if the conversation turn has cleanly concluded with a final assistant markdown response
  const lastConsolidated = consolidated.length > 0 ? consolidated[consolidated.length - 1] : null;
  const lastIsFinishedResponse = lastConsolidated && 
    lastConsolidated.type === 'PLANNER_RESPONSE' && 
    Boolean(lastConsolidated.content && lastConsolidated.content.trim());

  // Strictly ONLY show thinking if there are unconfirmed user messages, unfinished tools, or backend is genuinely busy WITHOUT a completed response
  const hasPending = unconfirmedPending.length > 0;
  const hasUnfinishedWorkflow = turnWorkflow.length > 0 || (activeWorkflow && activeWorkflow.length > 0);
  const shouldShowThinking = !lastIsFinishedResponse && (isProcessing || hasPending || hasUnfinishedWorkflow);

  if (shouldShowThinking) {
    const combinedWf = [...turnWorkflow, ...(activeWorkflow || [])];
    const latestAction = combinedWf.length > 0 ? combinedWf[combinedWf.length - 1] : null;
    startThinkingIndicator(latestAction);
    if (combinedWf.length > 1) {
      updateThinkingIndicator(latestAction, combinedWf.slice(0, -1));
    }
    // Only start polling if not already active
    if (!state.activePollTimer) {
      const lastIdx = steps.length > 0 ? steps[steps.length - 1].step_index : 0;
      startActivePolling(state.activeConversationId, lastIdx);
    }
  } else {
    stopThinkingIndicator(true);
    stopActivePolling();
    if (lastIsFinishedResponse) {
      clearPendingMessages(state.activeConversationId);
    }
  }

  if (shouldScroll && state.autoScroll) {
    scrollToBottom();
  }
}

function formatMessageTime(isoStr) {
  if (!isoStr) {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  try {
    const d = new Date(isoStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch (_) {
    return '';
  }
}

function startThinkingIndicator(initialAction) {
  stopThinkingIndicator(false);
  state.thinkingStartTime = Date.now();
  state.thinkingElapsedSeconds = 0;

  const defaultAction = initialAction || { icon: '✦', title: '正在深度思考中...', desc: '正在规划执行方案与步骤' };

  const indicator = document.createElement('div');
  indicator.id = 'active-thinking-indicator';
  indicator.className = 'flex flex-col gap-2 mb-4 animate-fade-in max-w-[92%]';
  indicator.innerHTML = `
    <div class="flex items-center justify-between gap-3 text-xs bg-white dark:bg-[#181816] border border-[#E5E5E3] dark:border-[#262624] rounded-2xl px-3.5 py-2.5 shadow-sm">
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="inline-block animate-spin text-sm text-[#1C1917] dark:text-[#E6E6E5] shrink-0 font-bold select-none">✦</span>
        <div class="min-w-0">
          <div id="active-workflow-action" class="font-sans font-semibold text-xs text-[#1C1917] dark:text-[#E6E6E5] truncate flex items-center gap-1">
            <span>${escapeHtml(defaultAction.title)}</span>
          </div>
          <div id="active-workflow-sub" class="text-[10px] text-[#78716C] dark:text-[#A8A29E] font-mono truncate mt-0.5">
            ${escapeHtml(defaultAction.desc || '准备执行中...')}
          </div>
        </div>
      </div>
      <span id="active-thinking-timer" class="font-mono text-[11px] text-[#78716C] dark:text-[#A8A29E] bg-black/5 dark:bg-white/10 px-2 py-0.5 rounded-full font-bold shrink-0">0s</span>
    </div>
    <div id="active-workflow-history" class="hidden flex flex-col gap-1 pl-3 text-[11px] text-[#78716C] dark:text-[#A8A29E]"></div>
  `;
  chatStream.appendChild(indicator);
  if (state.autoScroll) scrollToBottom();

  state.thinkingInterval = setInterval(() => {
    state.thinkingElapsedSeconds = Math.floor((Date.now() - state.thinkingStartTime) / 1000);
    const timerEl = document.getElementById('active-thinking-timer');
    if (timerEl) {
      timerEl.textContent = `${state.thinkingElapsedSeconds}s`;
    }
  }, 1000);
}

function updateThinkingIndicator(action, historyList) {
  let indicator = document.getElementById('active-thinking-indicator');
  if (!indicator) {
    startThinkingIndicator(action);
    indicator = document.getElementById('active-thinking-indicator');
  }
  if (!indicator) return;

  const actionEl = document.getElementById('active-workflow-action');
  const subEl = document.getElementById('active-workflow-sub');
  if (actionEl && action) {
    actionEl.innerHTML = `<span>${action.icon ? action.icon + ' ' : ''}${escapeHtml(action.title)}</span>`;
  }
  if (subEl && action) {
    subEl.textContent = action.desc || '正在执行中...';
  }

  const histEl = document.getElementById('active-workflow-history');
  if (histEl && historyList && historyList.length > 0) {
    histEl.classList.remove('hidden');
    const recent = historyList.slice(-3);
    histEl.innerHTML = recent.map(item => `
      <div class="flex items-center gap-1.5 opacity-80">
        <span class="text-emerald-500 font-bold text-[10px]">✓</span>
        <span class="font-medium text-[#57534E] dark:text-[#D6D3D1] truncate">${escapeHtml(item.title)}</span>
        ${item.desc ? `<span class="text-[9px] font-mono text-[#A8A29E] truncate">(${escapeHtml(item.desc)})</span>` : ''}
      </div>
    `).join('');
  }

  if (state.autoScroll) scrollToBottom();
}

function stopThinkingIndicator(removeDom = true) {
  if (state.thinkingInterval) {
    clearInterval(state.thinkingInterval);
    state.thinkingInterval = null;
  }
  if (removeDom) {
    const el = document.getElementById('active-thinking-indicator');
    if (el) el.remove();
  }
}

function streamPlannerResponse(step, el) {
  const fullContent = step.content || '';
  const contentBox = el.querySelector('.prose-claude');
  if (!contentBox || !fullContent) return;

  if (state.activeStreamTimer) {
    clearInterval(state.activeStreamTimer);
    state.activeStreamTimer = null;
  }

  let currentIndex = 0;
  const totalLength = fullContent.length;
  // Adaptive chunk size so text finishes in ~1.5 to 3 seconds
  const chunkSize = Math.max(3, Math.ceil(totalLength / 55));
  const tickInterval = 20;

  contentBox.innerHTML = '<span class="inline-block w-1.5 h-4 bg-emerald-500 animate-pulse translate-y-0.5 ml-0.5"></span>';

  state.activeStreamTimer = setInterval(() => {
    currentIndex += chunkSize;
    if (currentIndex >= totalLength) {
      clearInterval(state.activeStreamTimer);
      state.activeStreamTimer = null;
      contentBox.innerHTML = marked.parse(fullContent);
      bindImagesInElement(contentBox);
      if (state.autoScroll) scrollToBottom();
    } else {
      const sub = fullContent.slice(0, currentIndex);
      contentBox.innerHTML = marked.parse(sub) + '<span class="inline-block w-1.5 h-4 bg-emerald-500 animate-pulse translate-y-0.5 ml-0.5"></span>';
      if (state.autoScroll) scrollToBottom();
    }
  }, tickInterval);
}

function bindImagesInElement(parent) {
  parent.querySelectorAll('img').forEach(img => {
    img.style.cursor = 'zoom-in';
    img.onerror = () => {
      const src = img.getAttribute('src') || '';
      if (!img.dataset.retried) {
        img.dataset.retried = '1';
        try {
          const urlObj = new URL(src, window.location.origin);
          const pathParam = urlObj.searchParams.get('path') || urlObj.pathname;
          const fname = pathParam.split(/[/\\]/).pop();
          if (fname && fname.includes('.')) {
            const fallbackSrc = getApiUrl('/api/image', { path: fname });
            img.src = fallbackSrc;
            img.setAttribute('data-fullsrc', fallbackSrc);
            return;
          }
        } catch (_) {}
      }
    };
    img.onclick = (e) => {
      e.stopPropagation();
      const full = img.getAttribute('data-fullsrc') || img.src;
      openLightbox(full, img.alt || '图片预览');
    };
  });
}

function sanitizeUserMessage(rawContent) {
  if (!rawContent) return '';
  let text = String(rawContent);

  // 1. Extract pure user instruction from <USER_REQUEST>...</USER_REQUEST> if present
  const reqMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (reqMatch) {
    text = reqMatch[1];
  }

  // 2. Strip system metadata wrappers and XML tags
  text = text.replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, '');
  text = text.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '');
  text = text.replace(/The user has uploaded \d+ image\(s\):[\s\S]*?(?=(\n\n|\r\n\r\n|$))/gi, '');
  text = text.replace(/<RULE\[.*?\]>[\s\S]*?<\/RULE\[.*?\]>/gi, '');
  text = text.replace(/<ARTIFACT:.*?<\/ARTIFACT>/gi, '');

  return text.trim();
}

function createStepElement(step) {
  const stepIndex = step.step_index;
  const source = step.source;
  const type = step.type;

  // 1. User Message (Clean warm bubble on right with timestamp above it)
  if (source === 'USER_EXPLICIT' || type === 'USER_INPUT') {
    const rawContent = step.content || (typeof step.tool_calls === 'string' ? step.tool_calls : '');
    const cleanContent = sanitizeUserMessage(rawContent);
    if (!cleanContent) return null; // Ignore purely internal system prompt injections

    const timeStr = formatMessageTime(step.created_at);

    const el = document.createElement('div');
    el.id = `step-${stepIndex}`;
    el.className = 'flex flex-col items-end mb-4';
    el.innerHTML = `
      ${timeStr ? `<div class="text-[10px] text-[#A8A29E] dark:text-[#78716C] font-mono mb-1 mr-1.5 select-none">${timeStr}</div>` : ''}
      <div class="max-w-[85%] bg-[#EBEBEA] dark:bg-[#262624] text-[#1C1917] dark:text-[#E6E6E5] border border-[#DCDCDA] dark:border-[#383835] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm shadow-sm">
        <div class="whitespace-pre-wrap leading-relaxed font-sans">${escapeHtml(cleanContent)}</div>
      </div>
    `;
    return el;
  }

  // 2. Assistant Message - STRICTLY ONLY render PLANNER_RESPONSE with actual content!
  if (type === 'PLANNER_RESPONSE') {
    // Suppress intermediate tool-calling steps that lack user-facing dialogue content
    if (!step.content || !step.content.trim()) return null;

    const el = document.createElement('div');
    el.id = `step-${stepIndex}`;
    el.className = 'flex flex-col gap-1.5 mb-5 max-w-full';

    const modelName = step.model_name || state.contextWindow?.sampled_model || 'Gemini 3.8 Flash';
    const effortLabel = step.thinking_effort || (modelName.includes('Flash') ? 'High' : 'Thinking');
    const timeStr = formatMessageTime(step.created_at);

    let html = '';

    // Metadata Header above Assistant Bubble: Model Name · Effort (High/Medium/Low) · Timestamp
    html += `
      <div class="flex items-center gap-1.5 px-1 pt-0.5 text-[11px] font-mono text-[#A8A29E] dark:text-[#78716C] select-none">
        <span class="font-medium text-[#44403C] dark:text-[#D6D3D1] flex items-center gap-1">
          <span class="text-xs">✨</span>
          <span>${escapeHtml(modelName)}</span>
        </span>
        <span class="text-[#D6D3D1] dark:text-[#383835]">·</span>
        <span class="px-1.5 py-0.2 rounded bg-[#EBEBEA] dark:bg-[#262624] text-[10px] font-medium text-[#57534E] dark:text-[#A8A29E]">${escapeHtml(effortLabel)}</span>
        ${timeStr ? `
          <span class="text-[#D6D3D1] dark:text-[#383835]">·</span>
          <span>${timeStr}</span>
        ` : ''}
      </div>
    `;

    // Minimalist, elegant Claude-style thinking dropdown
    if (step.thinking && step.thinking.trim()) {
      const thinkingDuration = step.thinking_duration_sec || state.thinkingElapsedSeconds;
      const durationLabel = thinkingDuration ? `已思考 ${thinkingDuration} 秒` : '深度思考过程';

      html += `
        <details class="group text-xs text-[#78716C] dark:text-[#A8A29E] my-0.5">
          <summary class="cursor-pointer list-none flex items-center gap-1.5 py-1 px-1 font-serif text-[11px] opacity-80 hover:opacity-100 transition select-none w-fit">
            <span class="inline-block transition-transform duration-150 group-open:rotate-90 text-[8px] text-[#A8A29E]">▶</span>
            <span class="flex items-center gap-1">
              <span class="text-xs">💭</span>
              <span class="font-medium">${durationLabel}</span>
            </span>
          </summary>
          <div class="mt-1.5 p-3 rounded-xl border border-[#E5E5E3] dark:border-[#262624] text-[#57534E] dark:text-[#A8A29E] font-mono text-[11px] whitespace-pre-wrap leading-relaxed bg-[#F7F7F5] dark:bg-[#141413] max-h-60 overflow-y-auto">
            ${escapeHtml(step.thinking)}
          </div>
        </details>
      `;
    }

    // Execution Workflow Steps (Strictly NO code dumps, clean concise badges)
    if (step.workflow && Array.isArray(step.workflow) && step.workflow.length > 0) {
      html += `
        <details class="group text-xs text-[#78716C] dark:text-[#A8A29E] my-0.5">
          <summary class="cursor-pointer list-none flex items-center gap-1.5 py-1 px-1 font-serif text-[11px] opacity-80 hover:opacity-100 transition select-none w-fit">
            <span class="inline-block transition-transform duration-150 group-open:rotate-90 text-[8px] text-[#A8A29E]">▶</span>
            <span class="flex items-center gap-1">
              <span class="text-xs">⚡</span>
              <span class="font-medium">已执行工作流程 (${step.workflow.length} 步)</span>
            </span>
          </summary>
          <div class="mt-1.5 p-2.5 rounded-xl border border-[#E5E5E3] dark:border-[#262624] text-[#57534E] dark:text-[#A8A29E] font-sans text-[11px] bg-[#F7F7F5] dark:bg-[#141413] flex flex-col gap-1.5">
            ${step.workflow.map(item => `
              <div class="flex items-start gap-2 py-0.5 border-b border-[#EBEBEA] dark:border-[#222220] last:border-0">
                <span class="text-xs shrink-0 select-none">${item.icon || '✓'}</span>
                <div class="min-w-0">
                  <span class="font-medium text-[#1C1917] dark:text-[#E6E6E5]">${escapeHtml(item.title)}</span>
                  ${item.desc ? `<span class="ml-1 text-[#78716C] dark:text-[#A8A29E] font-mono text-[10px]">(${escapeHtml(item.desc)})</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      `;
    }

    // Main Dialogue Content (Claude Markdown)
    html += `
      <div class="bg-white dark:bg-[#181816] border border-[#E5E5E3] dark:border-[#262624] rounded-2xl rounded-tl-sm p-4 text-sm shadow-sm prose-claude">
        ${marked.parse(step.content)}
      </div>
    `;

    el.innerHTML = html;
    bindImagesInElement(el);

    return el;
  }

  // All other raw terminal dumps ('GENERIC') and system checkpoints are completely hidden for mobile cleanliness
  return null;
}

function appendOrUpdateStep(step, animate = false) {
  const existing = document.getElementById(`step-${step.step_index}`);
  const newEl = createStepElement(step);
  if (!newEl) return;

  const isNew = !existing;
  if (existing) {
    existing.replaceWith(newEl);
  } else {
    chatStream.appendChild(newEl);
  }

  // Strictly only typewrite animate if it's genuinely a new step to prevent repeated re-typing
  if (animate && isNew && step.type === 'PLANNER_RESPONSE' && step.content) {
    streamPlannerResponse(step, newEl);
  }

  if (state.autoScroll) {
    scrollToBottom();
  }
}

function scrollToBottom() {
  chatStream.scrollTop = chatStream.scrollHeight;
}

chatStream.addEventListener('scroll', () => {
  const isBottom = chatStream.scrollHeight - chatStream.scrollTop - chatStream.clientHeight < 60;
  state.autoScroll = isBottom;
});

// =============================================================================
// History Drawer
// =============================================================================
btnToggleDrawer.addEventListener('click', () => {
  toggleDrawer(true);
  loadConversationsList();
});

historyOverlay.addEventListener('click', () => toggleDrawer(false));

function toggleDrawer(open) {
  if (open) {
    historyOverlay.classList.remove('hidden');
    setTimeout(() => {
      historyOverlay.classList.add('opacity-100');
      historyDrawer.classList.remove('-translate-x-full');
    }, 10);
  } else {
    historyOverlay.classList.remove('opacity-100');
    historyDrawer.classList.add('-translate-x-full');
    setTimeout(() => historyOverlay.classList.add('hidden'), 300);
  }
}

async function loadConversationsList(searchTerm = '') {
  try {
    const data = await apiFetch('/api/conversations', {}, { search: searchTerm });
    state.conversations = data.conversations || [];
    renderConversationsList(state.conversations);
  } catch (e) {
    historyList.innerHTML = `<p class="text-xs text-rose-500 p-3">加载会话列表失败</p>`;
  }
}

function renderConversationsList(items) {
  historyList.innerHTML = '';
  if (!items.length) {
    historyList.innerHTML = `<p class="text-xs text-[#78716C] p-4 text-center font-serif">无匹配会话</p>`;
    return;
  }

  for (const item of items) {
    const isActive = item.id === state.activeConversationId;
    const card = document.createElement('div');
    card.className = `p-3 rounded-xl cursor-pointer transition border ${
      isActive 
        ? 'bg-[#EBEBEA] dark:bg-[#262624] border-black dark:border-white text-black dark:text-white font-medium' 
        : 'bg-[#F7F7F5] dark:bg-[#1C1C1A] border-[#E5E5E3] dark:border-[#2E2E2B] text-[#57534E] dark:text-[#A8A29E] hover:bg-[#EBEBEA] dark:hover:bg-[#262624]'
    }`;
    card.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <h4 class="text-xs font-serif font-semibold truncate max-w-[190px]">${escapeHtml(item.title)}</h4>
        <span class="text-[9px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-black dark:bg-white text-white dark:text-black font-semibold' : 'bg-[#E5E5E3] dark:bg-[#262624] text-[#78716C]'}">
          ${item.step_count} 步
        </span>
      </div>
      <p class="text-[11px] text-[#78716C] truncate mb-1">${escapeHtml(item.preview || '暂无摘要')}</p>
      <div class="text-[9px] text-[#A8A29E] text-right">${formatRelativeTime(item.last_modified)}</div>
    `;

    card.addEventListener('click', () => {
      state.activeConversationId = item.id;
      state.activeTitle = item.title;
      toggleDrawer(false);
      loadConversation(item.id);
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ action: 'set_active', conversation_id: item.id }));
      }
    });

    historyList.appendChild(card);
  }
}

historySearchInput.addEventListener('input', (e) => {
  loadConversationsList(e.target.value);
});

btnNewChat.addEventListener('click', () => {
  toggleDrawer(false);
  state.activeConversationId = null;
  state.activeTitle = '新会话';
  chatTitle.textContent = '新会话';
  state.steps = [];
  state.accumulatedThinking = [];
  stopThinkingIndicator(true);

  chatStream.innerHTML = `
    <div class="text-center py-28 text-[#78716C] text-sm animate-fade-in">
      <p class="text-3xl mb-3">✦</p>
      <p class="font-serif font-medium text-base text-[#1C1917] dark:text-[#E6E6E5]">新会话已就绪</p>
      <p class="text-xs text-[#A8A29E] mt-1.5">在下方输入框中发送任意指令，将自动创建并初始化新会话</p>
    </div>
  `;

  promptInput.value = '';
  promptInput.focus();
});

// =============================================================================
// =============================================================================
// Quota Modal
// =============================================================================
btnOpenModelModal.addEventListener('click', () => {
  renderQuotaView();
  modelModal.classList.remove('hidden');
  loadModelsAndQuota();
});

btnCloseModelModal.addEventListener('click', () => modelModal.classList.add('hidden'));
modelModal.querySelector('.modal-backdrop').addEventListener('click', () => modelModal.classList.add('hidden'));

// Quota Group Tab switching
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.quota-group-tab');
  if (tab && tab.dataset.group) {
    state.selectedQuotaGroup = tab.dataset.group;
    renderQuotaView();
  }
});

// Refresh Quota Button
if (btnRefreshQuota) {
  btnRefreshQuota.addEventListener('click', async () => {
    if (iconRefreshQuota) iconRefreshQuota.classList.add('animate-spin');
    await loadModelsAndQuota();
    if (iconRefreshQuota) {
      setTimeout(() => iconRefreshQuota.classList.remove('animate-spin'), 600);
    }
  });
}

function formatLiveCountdown(isoString) {
  if (!isoString) return '充足';
  const target = new Date(isoString).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return '即将重置';
  const totalSecs = Math.floor(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = n => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days}天 ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function tickCountdowns() {
  const currentGroup = state.quotaGroups.find(g => g.id === state.selectedQuotaGroup);
  if (!currentGroup || !currentGroup.windows) return;
  const w5h = currentGroup.windows['5h'];
  const wWeek = currentGroup.windows['weekly'];
  if (w5h && fiveCountdown && w5h.reset_time) {
    fiveCountdown.textContent = formatLiveCountdown(w5h.reset_time);
  }
  if (wWeek && weekCountdown && wWeek.reset_time) {
    weekCountdown.textContent = formatLiveCountdown(wWeek.reset_time);
  }
}
setInterval(tickCountdowns, 1000);

async function loadModelsAndQuota() {
  try {
    const data = await apiFetch('/api/models');
    if (data.quota_groups && data.quota_groups.length) {
      state.quotaGroups = data.quota_groups;
    }
    if (data.context_window) {
      state.contextWindow = data.context_window;
    }
    renderQuotaView();
  } catch (e) {
    console.warn("Background quota sync error:", e);
    renderQuotaView();
  }
}

function renderQuotaView() {
  // 1. Context Window Card
  if (state.contextWindow) {
    const ctx = state.contextWindow;
    if (ctxUsedSummary) {
      ctxUsedSummary.textContent = `${ctx.used_percent || 0}% 已用 (剩余 ${ctx.remaining_percent || 100}%)`;
    }
    if (ctxTokens) {
      ctxTokens.textContent = ctx.tokens_label || `${ctx.estimated_tokens || 0} / 256K tok`;
    }
    if (ctxFill) {
      ctxFill.style.width = `${Math.min(100, Math.max(0, ctx.used_percent || 0))}%`;
    }
    if (ctxSampledModel) {
      ctxSampledModel.textContent = ctx.sampled_model || 'Gemini 3.8 Flash';
    }
  }

  // 2. Active Quota Group
  const currentGroup = state.quotaGroups.find(g => g.id === state.selectedQuotaGroup) || state.quotaGroups[0];
  if (!currentGroup || !currentGroup.windows) return;

  const w5h = currentGroup.windows['5h'] || {};
  const wWeek = currentGroup.windows['weekly'] || {};

  const pct5h = Math.min(100, Math.max(0, w5h.remaining_percent ?? 100));
  if (fiveBalance) fiveBalance.textContent = `${pct5h}%`;
  if (fiveFill) fiveFill.style.width = `${pct5h}%`;
  if (fiveCountdown) fiveCountdown.textContent = w5h.reset_time ? formatLiveCountdown(w5h.reset_time) : (w5h.countdown || '充足');
  if (fiveReset) fiveReset.textContent = w5h.reset_time_bj || '—';

  const pctWeek = Math.min(100, Math.max(0, wWeek.remaining_percent ?? 100));
  if (weekBalance) weekBalance.textContent = `${pctWeek}%`;
  if (weekFill) weekFill.style.width = `${pctWeek}%`;
  if (weekCountdown) weekCountdown.textContent = wWeek.reset_time ? formatLiveCountdown(wWeek.reset_time) : (wWeek.countdown || '充足');
  if (weekReset) weekReset.textContent = wWeek.reset_time_bj || '—';

  // Highlight active Quota Group tab
  document.querySelectorAll('.quota-group-tab').forEach(tab => {
    const isAct = tab.dataset.group === state.selectedQuotaGroup;
    if (isAct) {
      tab.className = 'quota-group-tab active px-2.5 py-1 rounded-lg font-semibold bg-white dark:bg-[#1C1C1A] text-black dark:text-white shadow-xs transition';
    } else {
      tab.className = 'quota-group-tab px-2.5 py-1 rounded-lg font-medium text-[#78716C] hover:text-black dark:hover:text-white transition';
    }
  });

  // Top header quota pill: show live 5h balance
  if (headerModelLabel) {
    headerModelLabel.textContent = `额度 ${pct5h}%`;
  }
}

// =============================================================================
// ComfyUI Photo Gallery & Lightbox (Robust & Bug-Free)
// =============================================================================
btnOpenGallery.addEventListener('click', () => {
  galleryModal.classList.remove('hidden');
  loadGallery();
});

// =============================================================================
// Gallery Controller & Category/NSFW Filtering
// =============================================================================
state.galleryFilter = {
  stage: 'all',   // 'all' | 'finished' | 'draft' | 'reference'
  rating: 'all'   // 'all' | 'safe' | 'nsfw'
};
let galleryFiltersBound = false;

btnCloseGallery.addEventListener('click', () => galleryModal.classList.add('hidden'));

async function loadGallery() {
  if (!galleryContainer) return;
  galleryContainer.innerHTML = `
    <div class="text-center py-24 text-[#78716C] text-xs">
      <div class="inline-block animate-spin rounded-full h-5 w-5 border-2 border-black dark:border-white border-t-transparent mb-2"></div>
      <p class="font-serif">正在读取生图资产与生成轻量缩略图...</p>
    </div>
  `;

  try {
    const data = await apiFetch('/api/gallery');
    state.galleryImages = data.images || [];
    state.galleryGroups = data.groups || [];
    state.galleryCounts = data.counts || null;

    updateGalleryFilterCounts(data.counts, state.galleryImages.length);
    bindGalleryFilterEvents();
    renderGalleryCategorized();
  } catch (e) {
    galleryContainer.innerHTML = `<p class="text-center text-xs text-rose-500 font-serif py-16">扫描生图目录失败</p>`;
  }
}

function updateGalleryFilterCounts(counts, total) {
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setEl('count-stage-all', total);
  setEl('count-rating-all', total);
  if (counts) {
    setEl('count-stage-finished', counts.stage?.finished || 0);
    setEl('count-stage-draft', counts.stage?.draft || 0);
    setEl('count-stage-reference', counts.stage?.reference || 0);
    setEl('count-rating-safe', counts.rating?.safe || 0);
    setEl('count-rating-nsfw', counts.rating?.nsfw || 0);
  }
}

function bindGalleryFilterEvents() {
  if (galleryFiltersBound) return;
  galleryFiltersBound = true;

  document.querySelectorAll('.gallery-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.getAttribute('data-filter-type');
      const val = chip.getAttribute('data-filter-val');
      if (!type || !val) return;

      document.querySelectorAll(`.gallery-filter-chip[data-filter-type="${type}"]`).forEach(c => {
        c.classList.remove('active');
      });
      chip.classList.add('active');

      state.galleryFilter[type] = val;
      renderGalleryCategorized();
    });
  });
}

function renderGalleryCategorized() {
  if (!galleryContainer) return;
  galleryContainer.innerHTML = '';

  const { stage, rating } = state.galleryFilter;
  
  // Filter images
  const filtered = (state.galleryImages || []).filter(img => {
    if (stage !== 'all' && img.stage !== stage) return false;
    if (rating === 'safe' && img.is_nsfw) return false;
    if (rating === 'nsfw' && !img.is_nsfw) return false;
    return true;
  });

  galleryCount.textContent = `筛选出 ${filtered.length} / 共 ${state.galleryImages.length} 张`;

  if (!filtered.length) {
    galleryContainer.innerHTML = `
      <div class="text-center py-24 text-[#78716C] text-sm">
        <p class="text-3xl mb-2">🔍</p>
        <p class="font-serif font-medium">当前分类下暂无图片</p>
        <p class="text-xs text-[#A8A29E] mt-1">请尝试切换其他分类或分级筛选查看</p>
      </div>
    `;
    return;
  }

  // Pre-defined category ordering
  const catSections = [
    { key: "finished_nsfw", icon: "⭐", label: "成品专库 · 🔞 NSFW", desc: "精选成人艺术写真终稿" },
    { key: "finished_safe", icon: "⭐", label: "成品专库 · 🍃 全年龄", desc: "精选常规壁纸插画终稿" },
    { key: "draft_nsfw", icon: "🎨", label: "过程草稿 · 🔞 NSFW", desc: "日常生图与过程草稿" },
    { key: "draft_safe", icon: "🎨", label: "过程草稿 · 🍃 全年龄", desc: "日常生图与过程草稿" },
    { key: "reference_nsfw", icon: "📌", label: "垫图参考 · 🔞 NSFW", desc: "垫图与私密素材库" },
    { key: "reference_safe", icon: "📌", label: "垫图参考 · 🍃 全年龄", desc: "立绘与风景垫图素材" },
  ];

  const groups = [];
  catSections.forEach(def => {
    const matched = filtered.filter(img => (img.group_key === def.key));
    if (matched.length > 0) {
      groups.push({
        ...def,
        images: matched
      });
    }
  });

  const knownKeys = new Set(catSections.map(s => s.key));
  const leftovers = filtered.filter(img => !knownKeys.has(img.group_key));
  if (leftovers.length > 0) {
    groups.push({
      key: "other",
      icon: "📁",
      label: "其他生图资产",
      desc: "未分类资源",
      images: leftovers
    });
  }

  // Bind Expand / Collapse All
  const btnGalleryToggleAll = document.getElementById('btn-gallery-toggle-all');
  let isAllExpanded = false;
  if (btnGalleryToggleAll) {
    btnGalleryToggleAll.textContent = '展开全部';
    btnGalleryToggleAll.onclick = () => {
      isAllExpanded = !isAllExpanded;
      document.querySelectorAll('.gallery-day-section').forEach(sec => {
        const content = sec.querySelector('.gallery-day-content');
        const statusText = sec.querySelector('.toggle-status-text');
        const arrowIcon = sec.querySelector('.arrow-icon');
        if (isAllExpanded) {
          sec.classList.add('expanded');
          content?.classList.remove('hidden');
          if (statusText) statusText.textContent = '收起';
          if (arrowIcon) arrowIcon.classList.add('rotate-180');
        } else {
          sec.classList.remove('expanded');
          content?.classList.add('hidden');
          if (statusText) statusText.textContent = '展开';
          if (arrowIcon) arrowIcon.classList.remove('rotate-180');
        }
      });
      btnGalleryToggleAll.textContent = isAllExpanded ? '全部收起' : '展开全部';
    };
  }

  groups.forEach((group) => {
    const section = document.createElement('div');
    // Privacy protection: default to collapsed so no thumbnails show until user explicitly expands
    section.className = 'gallery-day-section';

    const header = document.createElement('div');
    header.className = 'gallery-day-header bg-white dark:bg-[#181816]';
    header.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-sm shrink-0">${group.icon}</span>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-serif font-bold text-xs text-[#1C1917] dark:text-white truncate">${escapeHtml(group.label)}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-[#78716C] font-mono shrink-0">${group.images.length} 张</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-1.5 text-xs text-[#78716C] shrink-0">
        <span class="toggle-status-text text-[10px] font-sans">展开</span>
        <svg class="w-3.5 h-3.5 arrow-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    `;

    const content = document.createElement('div');
    content.className = 'gallery-day-content hidden';

    const grid = document.createElement('div');
    grid.className = 'gallery-day-grid';

    group.images.forEach(img => {
      const thumbUrl = getApiUrl('/api/thumbnail', { path: img.rel_path, size: 400 });
      const fullUrl = getApiUrl('/api/image', { path: img.rel_path });

      const card = document.createElement('div');
      card.className = 'gallery-card relative overflow-hidden group';

      const stageBadgeClass = img.stage === 'finished' ? 'bg-amber-500/90 text-white font-medium' : (img.stage === 'reference' ? 'bg-sky-500/90 text-white' : 'bg-black/50 text-neutral-200');
      const ratingBadgeClass = img.is_nsfw ? 'bg-rose-500/90 text-white font-semibold' : 'bg-emerald-600/90 text-white';

      card.innerHTML = `
        <img src="${thumbUrl}" loading="lazy" decoding="async" alt="${escapeHtml(img.filename)}">
        <!-- Top Badges -->
        <div class="absolute top-1.5 inset-x-1.5 flex items-center justify-between pointer-events-none text-[9px]">
          <span class="px-1.5 py-0.5 rounded-md backdrop-blur-md ${stageBadgeClass}">${img.stage_badge || '生图'}</span>
          <span class="px-1.5 py-0.5 rounded-md backdrop-blur-md ${ratingBadgeClass}">${img.rating_badge || '全年龄'}</span>
        </div>
        <!-- Bottom Filename & Time -->
        <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-2 text-white pointer-events-none">
          <p class="text-[10px] font-mono truncate leading-tight">${escapeHtml(img.filename)}</p>
          <div class="flex items-center justify-between mt-0.5 text-[9px] text-neutral-300 font-mono">
            <span>${img.date_label || ''}</span>
            <span>${img.time_str || ''}</span>
          </div>
        </div>
      `;

      card.onclick = (e) => {
        e.stopPropagation();
        openLightbox(fullUrl, img.filename);
      };

      grid.appendChild(card);
    });

    content.appendChild(grid);
    section.appendChild(header);
    section.appendChild(content);

    header.onclick = () => {
      const isExpanded = section.classList.toggle('expanded');
      const statusText = header.querySelector('.toggle-status-text');
      const arrowIcon = header.querySelector('.arrow-icon');
      if (isExpanded) {
        content.classList.remove('hidden');
        if (statusText) statusText.textContent = '收起';
        if (arrowIcon) arrowIcon.classList.add('rotate-180');
      } else {
        content.classList.add('hidden');
        if (statusText) statusText.textContent = '展开';
        if (arrowIcon) arrowIcon.classList.remove('rotate-180');
      }
    };

    galleryContainer.appendChild(section);
  });
}

// =============================================================================
// =============================================================================
// Full-Screen Interactive Lightbox Controller (Mobile Touch & Zoom Engine v4.2)
// =============================================================================
const lightboxState = {
  scale: 1,
  minScale: 1,
  maxScale: 5,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  initialDistance: 0,
  initialScale: 1,
  currentUrl: '',
  currentName: '',
  lastTapTime: 0,
  tapTimeout: null,
  isTouchMoved: false,
  touchStartX: 0,
  touchStartY: 0,
  ignoreClickUntil: 0
};

function toggleLightboxHud(force) {
  if (!lightboxModal) return;
  if (typeof force === 'boolean') {
    if (force) lightboxModal.classList.remove('hud-hidden');
    else lightboxModal.classList.add('hud-hidden');
  } else {
    lightboxModal.classList.toggle('hud-hidden');
  }
}

function updateLightboxTransform(animate = false) {
  if (!lightboxImg) return;
  lightboxImg.style.transition = animate ? 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
  lightboxImg.style.transform = `translate3d(${lightboxState.translateX}px, ${lightboxState.translateY}px, 0) scale(${lightboxState.scale})`;
  
  const badge = document.getElementById('lightbox-zoom-badge');
  const btnReset = document.getElementById('btn-zoom-reset');
  const pct = `${Math.round(lightboxState.scale * 100)}%`;
  if (badge) badge.textContent = pct;
  if (btnReset) btnReset.textContent = pct;
}

function resetLightboxZoom() {
  lightboxState.scale = 1;
  lightboxState.translateX = 0;
  lightboxState.translateY = 0;
  updateLightboxTransform(true);
}

function openLightbox(url, name) {
  if (!lightboxModal || !lightboxImg) return;
  lightboxState.currentUrl = url;
  lightboxState.currentName = name || '图片预览';

  lightboxImg.src = url;
  if (lightboxName) lightboxName.textContent = lightboxState.currentName;

  // Reset to contain mode & display HUD initially
  lightboxImg.classList.remove('fill-mode');
  lightboxModal.classList.remove('hud-hidden');
  const btnFit = document.getElementById('btn-zoom-fit');
  if (btnFit) {
    btnFit.textContent = '⛶ 铺满';
    btnFit.title = '切换全屏铺满';
  }

  resetLightboxZoom();
  lightboxModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  if (!lightboxModal) return;
  if (lightboxState.tapTimeout) {
    clearTimeout(lightboxState.tapTimeout);
    lightboxState.tapTimeout = null;
  }
  lightboxModal.classList.add('hidden');
  lightboxModal.classList.remove('hud-hidden');
  if (lightboxImg) {
    lightboxImg.src = '';
    lightboxImg.classList.remove('fill-mode');
  }
  document.body.style.overflow = '';
  resetLightboxZoom();
}

async function saveOrShareImage() {
  const url = lightboxState.currentUrl;
  const name = lightboxState.currentName || 'antigravity_image.png';
  if (!url) return;

  showToast('正在准备图像...', 'info', 1500);

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();

    let filename = name;
    if (!filename.includes('.')) {
      const ext = blob.type === 'image/jpeg' ? '.jpg' : '.png';
      filename += ext;
    }

    const file = new File([blob], filename, { type: blob.type || 'image/png' });

    // 1. Native Web Share API (Direct save to iOS Photos / Share Sheet without navigating away)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: filename,
        });
        showToast('已调起系统分享，可选择『存储图像』到系统相册', 'success', 3000);
        return;
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') return; // User canceled share sheet
      }
    }

    // 2. Safe in-memory Blob download (PC & fallback)
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }, 1500);

    showToast('下载已触发！长按图片亦可直接保存至系统相册', 'success', 3500);
  } catch (err) {
    showToast(`保存失败: ${err.message}，您可以直接长按图片进行保存`, 'error', 4000);
  }
}

function initLightboxEngine() {
  const viewport = document.getElementById('lightbox-viewport');
  const topBar = document.getElementById('lightbox-top-bar');
  const bottomBar = document.getElementById('lightbox-bottom-bar');
  const dock = document.getElementById('lightbox-controls-dock');
  if (!viewport || !lightboxImg) return;

  function getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Prevent HUD clicks from triggering viewport tap
  if (topBar) {
    topBar.addEventListener('click', (e) => e.stopPropagation());
    topBar.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  }
  if (bottomBar) {
    bottomBar.addEventListener('click', (e) => e.stopPropagation());
    bottomBar.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  }

  // Touch gesture handlers for mobile
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lightboxState.isDragging = false;
      lightboxState.isTouchMoved = true;
      lightboxState.initialDistance = getDistance(e.touches[0], e.touches[1]);
      lightboxState.initialScale = lightboxState.scale;
      lightboxImg.classList.add('no-transition');
    } else if (e.touches.length === 1) {
      lightboxState.touchStartX = e.touches[0].clientX;
      lightboxState.touchStartY = e.touches[0].clientY;
      lightboxState.isTouchMoved = false;
      lightboxState.isDragging = true;
      lightboxState.startX = e.touches[0].clientX - lightboxState.translateX;
      lightboxState.startY = e.touches[0].clientY - lightboxState.translateY;
      lightboxImg.classList.add('no-transition');
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && lightboxState.initialDistance > 0) {
      e.preventDefault();
      const currentDist = getDistance(e.touches[0], e.touches[1]);
      const newScale = lightboxState.initialScale * (currentDist / lightboxState.initialDistance);
      lightboxState.scale = Math.min(lightboxState.maxScale, Math.max(lightboxState.minScale, newScale));
      updateLightboxTransform(false);
    } else if (e.touches.length === 1 && lightboxState.isDragging) {
      const moveDist = Math.hypot(e.touches[0].clientX - lightboxState.touchStartX, e.touches[0].clientY - lightboxState.touchStartY);
      if (moveDist > 6) {
        lightboxState.isTouchMoved = true;
      }

      if (lightboxState.scale > 1) {
        e.preventDefault();
        lightboxState.translateX = e.touches[0].clientX - lightboxState.startX;
        lightboxState.translateY = e.touches[0].clientY - lightboxState.startY;
        updateLightboxTransform(false);
      } else {
        const dy = e.touches[0].clientY - lightboxState.startY;
        if (dy > 0) {
          e.preventDefault();
          lightboxState.translateY = dy;
          updateLightboxTransform(false);
        }
      }
    }
  }, { passive: false });

  viewport.addEventListener('touchend', (e) => {
    lightboxImg.classList.remove('no-transition');
    lightboxState.ignoreClickUntil = Date.now() + 400;

    if (e.touches.length === 0) {
      lightboxState.isDragging = false;

      // Tap handling (when user didn't pan or drag)
      if (!lightboxState.isTouchMoved) {
        const now = Date.now();
        if (now - lightboxState.lastTapTime < 300) {
          // Double Tap: clear single tap timer and toggle 1.0x <-> 2.5x zoom
          if (lightboxState.tapTimeout) {
            clearTimeout(lightboxState.tapTimeout);
            lightboxState.tapTimeout = null;
          }
          if (lightboxState.scale > 1.2) {
            resetLightboxZoom();
          } else {
            lightboxState.scale = 2.5;
            const rect = lightboxImg.getBoundingClientRect();
            const offsetX = lightboxState.touchStartX - (rect.left + rect.width / 2);
            const offsetY = lightboxState.touchStartY - (rect.top + rect.height / 2);
            lightboxState.translateX = -offsetX * 0.7;
            lightboxState.translateY = -offsetY * 0.7;
            updateLightboxTransform(true);
          }
          lightboxState.lastTapTime = 0;
        } else {
          // Single Tap: toggle HUD after small delay
          lightboxState.lastTapTime = now;
          lightboxState.tapTimeout = setTimeout(() => {
            toggleLightboxHud();
            lightboxState.tapTimeout = null;
          }, 260);
        }
      } else {
        // Drag or swipe end
        if (lightboxState.scale < 1) {
          resetLightboxZoom();
        } else if (lightboxState.scale === 1 && lightboxState.translateY > 75) {
          closeLightbox();
        } else if (lightboxState.scale === 1) {
          resetLightboxZoom();
        }
      }
    }
  });

  // Desktop click handling (ignoring synthetic clicks right after touch)
  viewport.addEventListener('click', (e) => {
    if (Date.now() < lightboxState.ignoreClickUntil) return;
    toggleLightboxHud();
  });

  // Double click for desktop
  viewport.addEventListener('dblclick', (e) => {
    if (Date.now() < lightboxState.ignoreClickUntil) return;
    e.stopPropagation();
    if (lightboxState.scale > 1.2) {
      resetLightboxZoom();
    } else {
      lightboxState.scale = 2.5;
      const rect = lightboxImg.getBoundingClientRect();
      const offsetX = e.clientX - (rect.left + rect.width / 2);
      const offsetY = e.clientY - (rect.top + rect.height / 2);
      lightboxState.translateX = -offsetX * 0.7;
      lightboxState.translateY = -offsetY * 0.7;
      updateLightboxTransform(true);
    }
  });

  // Mouse wheel zoom for desktop
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    lightboxState.scale = Math.min(lightboxState.maxScale, Math.max(lightboxState.minScale, lightboxState.scale + delta));
    if (lightboxState.scale <= 1) {
      resetLightboxZoom();
    } else {
      updateLightboxTransform(true);
    }
  }, { passive: false });

  // Floating zoom & action buttons
  const btnIn = document.getElementById('btn-zoom-in');
  const btnOut = document.getElementById('btn-zoom-out');
  const btnReset = document.getElementById('btn-zoom-reset');
  const btnFit = document.getElementById('btn-zoom-fit');
  const btnSave = document.getElementById('btn-save-image');

  if (btnIn) {
    btnIn.onclick = (e) => {
      e.stopPropagation();
      lightboxState.scale = Math.min(lightboxState.maxScale, lightboxState.scale + 0.5);
      updateLightboxTransform(true);
    };
  }
  if (btnOut) {
    btnOut.onclick = (e) => {
      e.stopPropagation();
      lightboxState.scale = Math.max(lightboxState.minScale, lightboxState.scale - 0.5);
      if (lightboxState.scale <= 1) resetLightboxZoom();
      else updateLightboxTransform(true);
    };
  }
  if (btnReset) {
    btnReset.onclick = (e) => {
      e.stopPropagation();
      resetLightboxZoom();
    };
  }
  if (btnFit) {
    btnFit.onclick = (e) => {
      e.stopPropagation();
      const isFill = lightboxImg.classList.toggle('fill-mode');
      btnFit.textContent = isFill ? '⛶ 适屏' : '⛶ 铺满';
      btnFit.title = isFill ? '切换完整适屏' : '切换全屏铺满';
      resetLightboxZoom();
      showToast(isFill ? '已切换为全屏铺满模式' : '已切换为完整适屏模式', 'info', 1500);
    };
  }
  if (btnSave) {
    btnSave.onclick = (e) => {
      e.stopPropagation();
      saveOrShareImage();
    };
  }

  if (btnCloseLightbox) {
    btnCloseLightbox.onclick = (e) => {
      e.stopPropagation();
      closeLightbox();
    };
  }
}

// Close via Escape key
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!lightboxModal.classList.contains('hidden')) {
      closeLightbox();
    } else if (!galleryModal.classList.contains('hidden')) {
      galleryModal.classList.add('hidden');
    } else if (!modelModal.classList.contains('hidden')) {
      modelModal.classList.add('hidden');
    }
  }
});

// =============================================================================
// Mobile Attachments Logic
// =============================================================================
if (btnAttach && attachmentMenu) {
  btnAttach.addEventListener('click', (e) => {
    e.stopPropagation();
    attachmentMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!attachmentMenu.contains(e.target) && e.target !== btnAttach) {
      attachmentMenu.classList.add('hidden');
    }
  });

  if (btnPickPhotos && attachmentPhotoInput) {
    btnPickPhotos.addEventListener('click', () => {
      attachmentMenu.classList.add('hidden');
      attachmentPhotoInput.click();
    });
  }

  if (btnPickFiles && attachmentFileInput) {
    btnPickFiles.addEventListener('click', () => {
      attachmentMenu.classList.add('hidden');
      attachmentFileInput.click();
    });
  }
}

async function handleFilesSelected(files) {
  if (!files || !files.length) return;
  for (const file of files) {
    await uploadAttachment(file);
  }
}

if (attachmentPhotoInput) {
  attachmentPhotoInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    await handleFilesSelected(files);
    attachmentPhotoInput.value = '';
  });
}

if (attachmentFileInput) {
  attachmentFileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    await handleFilesSelected(files);
    attachmentFileInput.value = '';
  });
}

// Clipboard Paste Support on Prompt Input
if (promptInput) {
  promptInput.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || window.clipboardData)?.items;
    if (!items) return;
    const filesToUpload = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) filesToUpload.push(file);
      }
    }
    if (filesToUpload.length > 0) {
      showToast(`已从剪贴板添加 ${filesToUpload.length} 个附件`, 'info', 2000);
      await handleFilesSelected(filesToUpload);
    }
  });
}

async function uploadAttachment(file) {
  if (!attachmentPreviewBar) return;
  attachmentPreviewBar.classList.remove('hidden');

  const tempId = 'att_' + Date.now() + Math.random().toString(36).substring(2, 6);
  const chip = document.createElement('div');
  chip.id = tempId;
  chip.className = 'attachment-chip animate-pulse text-xs';
  chip.innerHTML = `
    <span class="inline-block animate-spin w-3 h-3 border border-black dark:border-white border-t-transparent rounded-full"></span>
    <span class="truncate max-w-[120px] font-mono">${escapeHtml(file.name)}</span>
  `;
  attachmentPreviewBar.appendChild(chip);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const url = getApiUrl('/api/upload');
    const resp = await fetch(url, {
      method: 'POST',
      body: formData
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();

    state.pendingAttachments.push({
      filename: file.name,
      url: result.url,
      abs_path: result.abs_path,
      size: result.size,
      is_image: result.is_image
    });

    renderAttachmentPreviews();
  } catch (err) {
    const el = document.getElementById(tempId);
    if (el) el.remove();
    showToast(`附件上传失败: ${err.message}`, 'error', 3500);
  }
}

function updateAttachmentBadge() {
  if (!attachmentBadge) return;
  const count = state.pendingAttachments.length;
  if (count > 0) {
    attachmentBadge.textContent = count > 9 ? '9+' : count;
    attachmentBadge.classList.remove('hidden');
  } else {
    attachmentBadge.classList.add('hidden');
  }
}

function renderAttachmentPreviews() {
  updateAttachmentBadge();
  if (!attachmentPreviewBar) return;
  if (!state.pendingAttachments.length) {
    attachmentPreviewBar.classList.add('hidden');
    attachmentPreviewBar.innerHTML = '';
    return;
  }

  attachmentPreviewBar.classList.remove('hidden');
  attachmentPreviewBar.innerHTML = '';

  state.pendingAttachments.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip text-xs';
    const thumbHtml = att.is_image && att.url
      ? `<img src="${getApiUrl(att.url)}" class="w-4 h-4 rounded object-cover">`
      : `<span>${att.is_image ? '🖼️' : '📄'}</span>`;
    chip.innerHTML = `
      ${thumbHtml}
      <span class="truncate max-w-[130px] font-mono font-medium">${escapeHtml(att.filename)}</span>
      <button type="button" class="ml-1 text-[#A8A29E] hover:text-black dark:hover:text-white remove-att-btn text-xs font-bold" data-index="${idx}">✕</button>
    `;
    chip.querySelector('.remove-att-btn').onclick = (e) => {
      e.stopPropagation();
      state.pendingAttachments.splice(idx, 1);
      renderAttachmentPreviews();
    };
    attachmentPreviewBar.appendChild(chip);
  });
}

// =============================================================================
// Quick Actions & Message Sending
// =============================================================================
document.querySelectorAll('.quick-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const text = chip.getAttribute('data-text');
    if (text) {
      sendMessage(text);
    }
  });
});

function handleSendSubmit(e) {
  if (e) e.preventDefault();
  const text = promptInput.value.trim();
  if (text || state.pendingAttachments.length) {
    sendMessage(text);
    promptInput.value = '';
    promptInput.style.height = 'auto';
  }
}

chatForm.addEventListener('submit', handleSendSubmit);
btnSend.addEventListener('click', handleSendSubmit);

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendSubmit();
  }
});

promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 120)}px`;
});

async function sendMessage(content) {
  if (!content && !state.pendingAttachments.length) return;

  const currentAttachments = [...state.pendingAttachments];
  state.pendingAttachments = [];
  renderAttachmentPreviews();

  // Temporary local step display
  let previewText = content;
  if (currentAttachments.length) {
    const attDesc = currentAttachments.map(a => `${a.is_image ? '🖼️' : '📄'} ${a.filename}`).join(', ');
    previewText = previewText ? `${previewText}\n[附带: ${attDesc}]` : `[附带文件: ${attDesc}]`;
  }

  const tempStep = {
    step_index: 'pending_' + Date.now(),
    source: 'USER_EXPLICIT',
    type: 'USER_INPUT',
    created_at: new Date().toISOString(),
    content: previewText,
    is_pending: true
  };

  // Persist pending message immediately to prevent refresh message loss!
  if (state.activeConversationId) {
    savePendingMessage(state.activeConversationId, tempStep);
  }

  appendOrUpdateStep(tempStep);

  // Immediately display thinking state with live second timer
  state.accumulatedThinking = [];
  state.currentTurnWorkflow = [];
  startThinkingIndicator({ icon: '✦', title: '正在深度思考中...', desc: '正在分析意图并规划执行路径' });

  if (state.activeConversationId) {
    const lastIdx = state.steps && state.steps.length > 0 ? state.steps[state.steps.length - 1].step_index : 0;
    startActivePolling(state.activeConversationId, lastIdx);
  }

  btnSend.disabled = true;
  btnSend.classList.add('opacity-40');

  try {
    if (!state.activeConversationId) {
      chatTitle.textContent = '启动新会话...';
      const res = await apiFetch('/api/new-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: previewText
        })
      });
      if (res && res.success === false) {
        stopThinkingIndicator(true);
        stopActivePolling();
        showToast(`创建新会话未成功: ${res.error || '语言服务器未响应'}`, 'error', 4000);
      } else {
        setTimeout(() => loadConversationsList(), 1500);
      }
    } else {
      const res = await apiFetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: state.activeConversationId,
          content: content,
          attachments: currentAttachments
        })
      });
      if (res && res.success === false) {
        if (!res.timeout_warning) {
          stopThinkingIndicator(true);
          stopActivePolling();
          clearPendingMessages(state.activeConversationId);
          showToast(`发送未成功: ${res.error || '语言服务器未响应'}`, 'error', 4000);
        }
      }
    }
  } catch (e) {
    const isNetErr = e.message === 'Load failed' || e.message.includes('fetch') || e.message.includes('Network');
    if (isNetErr) {
      showToast('网络连接波动，正在后台同步中...', 'info', 2500);
      // Keep polling rather than stopping thinking indicator!
    } else {
      stopThinkingIndicator(true);
      stopActivePolling();
      showToast(`发送失败: ${e.message}`, 'error', 4500);
    }
  } finally {
    btnSend.disabled = false;
    btnSend.classList.remove('opacity-40');
  }
}

// =============================================================================
// Utilities
// =============================================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
    return `${Math.floor(diffSec / 86400)}天前`;
  } catch (e) {
    return dateStr;
  }
}

function updateHeaderTitle() {
  const current = state.conversations.find(c => c.id === state.activeConversationId);
  if (current) {
    chatTitle.textContent = current.title || '当前会话';
  } else {
    chatTitle.textContent = state.activeTitle || '当前会话';
  }
}

// =============================================================================
// Security & Authentication Modal Controller
// =============================================================================
let authModalMode = 'login'; // 'setup' | 'login'
let appInitialized = false;

function isLanHost(host) {
  const h = (host || window.location.hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local') || h.endsWith('.lan')) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  const match172 = h.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const sec = parseInt(match172[1], 10);
    if (sec >= 16 && sec <= 31) return true;
  }
  return false;
}

async function detectClientIp() {
  if (state.clientIp) return state.clientIp;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (data && data.ip) {
      state.clientIp = data.ip;
      return data.ip;
    }
  } catch (e) {}
  return '';
}

function showAuthModal(mode = 'login', customDesc = '') {
  authModalMode = mode;
  const modal = document.getElementById('auth-modal');
  const title = document.getElementById('auth-title');
  const desc = document.getElementById('auth-desc');
  const icon = document.getElementById('auth-icon-badge');
  const pwdInput = document.getElementById('auth-pwd-input');
  const confirmBox = document.getElementById('auth-confirm-box');
  const pwdConfirm = document.getElementById('auth-pwd-confirm');
  const btnText = document.getElementById('auth-btn-text');
  const errMsg = document.getElementById('auth-error-msg');

  if (!modal) return;

  if (errMsg) {
    errMsg.classList.add('hidden');
    errMsg.textContent = '';
  }

  if (mode === 'setup') {
    if (title) title.textContent = '首次部署安全设置';
    if (desc) desc.textContent = '请为 Antigravity 工作台设置主访问密码（至少 4 位字符）。';
    if (icon) icon.textContent = '🔑';
    if (confirmBox) confirmBox.classList.remove('hidden');
    if (btnText) btnText.textContent = '创建主密码并登录';
  } else {
    if (title) title.textContent = '安全访问验证';
    if (desc) desc.textContent = customDesc || '检测到新浏览器或网络环境变更，请输入密码解锁工作台。';
    if (icon) icon.textContent = '🔒';
    if (confirmBox) confirmBox.classList.add('hidden');
    if (btnText) btnText.textContent = '解锁进入工作台';
  }

  if (pwdInput) pwdInput.value = '';
  if (pwdConfirm) pwdConfirm.value = '';

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    if (pwdInput) pwdInput.focus();
  }, 100);
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  document.body.style.overflow = '';
}

function initAuthModalEvents() {
  const form = document.getElementById('auth-form');
  const pwdInput = document.getElementById('auth-pwd-input');
  const pwdConfirm = document.getElementById('auth-pwd-confirm');
  const errMsg = document.getElementById('auth-error-msg');
  const submitBtn = document.getElementById('btn-auth-submit');
  const btnText = document.getElementById('auth-btn-text');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = (pwdInput?.value || '').trim();
    if (!pwd) {
      showAuthError('请输入密码');
      return;
    }

    if (authModalMode === 'setup') {
      const confirmVal = (pwdConfirm?.value || '').trim();
      if (pwd.length < 4) {
        showAuthError('密码长度至少需要 4 位字符');
        return;
      }
      if (pwd !== confirmVal) {
        showAuthError('两次输入的密码不一致，请重新输入');
        return;
      }
    }

    if (errMsg) errMsg.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = true;
    if (btnText) btnText.textContent = '正在验证...';

    try {
      const endpoint = authModalMode === 'setup' ? '/api/auth/setup' : '/api/auth/login';
      const payload = {
        password: pwd,
        device_id: state.deviceId,
        client_ip: state.clientIp || ''
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': state.deviceId,
          'X-Client-Ip': state.clientIp || ''
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        showAuthError(data.error || data.detail || '验证失败，请重试');
        return;
      }

      // Success
      if (data.session_token) {
        state.sessionToken = data.session_token;
        try { localStorage.setItem('ag_session_token', data.session_token); } catch (e) {}
      }
      if (data.client_ip) {
        state.clientIp = data.client_ip;
      }
      state.isAuthenticated = true;

      hideAuthModal();
      initAppAfterAuth();
    } catch (err) {
      showAuthError('网络请求失败: ' + (err.message || '未知错误'));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (btnText) {
        btnText.textContent = authModalMode === 'setup' ? '创建主密码并登录' : '解锁进入工作台';
      }
    }
  });

  function showAuthError(msg) {
    if (errMsg) {
      errMsg.textContent = msg;
      errMsg.classList.remove('hidden');
    }
  }
}

// =============================================================================
// Application Boot
// =============================================================================
async function initAppAfterAuth() {
  if (appInitialized) return;
  appInitialized = true;

  initWebSocket();
  initLightboxEngine();

  if (headerModelLabel) {
    headerModelLabel.textContent = '额度';
  }

  // Pre-render quota cards immediately
  renderQuotaView();

  // Pre-fetch live quotas in background
  loadModelsAndQuota();

  // Mobile auto-reconnect & auto-refresh on screen unlock or tab focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        initWebSocket();
      }
      if (state.activeConversationId) {
        loadConversation(state.activeConversationId, false);
      }
    }
  });

  try {
    const status = await apiFetch('/api/status');
    if (status.active_conversation_id) {
      state.activeConversationId = status.active_conversation_id;
      loadConversation(status.active_conversation_id);
    }
  } catch (e) {
    console.error('Initial status fetch failed:', e);
  }
}

async function initApp() {
  initTheme();
  initAuthModalEvents();

  const isLan = isLanHost();
  state.isLan = isLan;

  // For remote/tunnel access, probe public IP for precise session binding
  if (!isLan) {
    await detectClientIp();
  }

  // Check server auth status
  try {
    const params = new URLSearchParams();
    if (state.sessionToken) params.set('token', state.sessionToken);
    if (state.authToken) params.set('key', state.authToken);
    if (state.deviceId) params.set('device_id', state.deviceId);
    if (state.clientIp) params.set('client_ip', state.clientIp);

    const headers = {
      'X-Device-Id': state.deviceId,
      'X-Client-Ip': state.clientIp || ''
    };
    if (state.sessionToken) {
      headers['Authorization'] = `Bearer ${state.sessionToken}`;
    } else if (state.authToken) {
      headers['Authorization'] = `Bearer ${state.authToken}`;
    }

    const res = await fetch(`/api/auth/status?${params.toString()}`, { headers });
    if (!res.ok) {
      if (isLan) {
        state.isAuthenticated = true;
        initAppAfterAuth();
        return;
      }
      showAuthModal('login', '服务器验证响应异常');
      return;
    }

    const data = await res.json();
    if (data.client_ip && !state.clientIp) {
      state.clientIp = data.client_ip;
    }

    // 🌟 LAN Direct Access: Completely bypass password requirement!
    if (data.is_lan || isLan) {
      state.isLan = true;
      state.isAuthenticated = true;
      initAppAfterAuth();
      return;
    }

    // Remote / Tunnel Access:
    if (!data.initialized) {
      // First-time remote setup
      showAuthModal('setup');
      return;
    }

    if (data.authenticated) {
      if (data.session_token) {
        state.sessionToken = data.session_token;
        try { localStorage.setItem('ag_session_token', data.session_token); } catch (e) {}
      }
      state.isAuthenticated = true;
      initAppAfterAuth();
    } else {
      let reasonText = '检测到新设备或 IP 变动，请输入密码验证';
      if (data.reason === 'ip_mismatch') {
        reasonText = '检测到网络 IP 发生变化，请验证密码';
      } else if (data.reason === 'device_mismatch') {
        reasonText = '检测到新浏览器访问，请验证密码';
      }
      showAuthModal('login', reasonText);
    }
  } catch (e) {
    if (isLan) {
      state.isAuthenticated = true;
      initAppAfterAuth();
      return;
    }
    console.error('Failed to check auth status:', e);
    showAuthModal('login', '无法连接到验证服务，请检查网络');
  }
}

document.addEventListener('DOMContentLoaded', initApp);
