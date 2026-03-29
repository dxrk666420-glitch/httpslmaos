import { encodeMsgpack, decodeMsgpack } from "./msgpack-helpers.js";

const clientId = window.location.pathname.split("/")[1];
let ws = null;
let processes = [];
let processMap = new Map();
let processTree = [];
let collapsedPids = new Set();
let selectedPid = null;
let sortField = "cpu";
let sortDirection = "desc";
let searchTerm = "";

const statusEl = document.getElementById("status-indicator");
const processCountEl = document.getElementById("process-count");
const processListEl = document.getElementById("process-list");
const refreshBtn = document.getElementById("refresh-btn");
const killBtn = document.getElementById("kill-btn");
const searchInput = document.getElementById("search-input");
const clientIdHeader = document.getElementById("client-id-header");

if (clientIdHeader) {
  clientIdHeader.textContent = `${clientId} - Process Manager`;
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/clients/${clientId}/processes/ws`;

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("Process manager connected");
    updateStatus("connected", "Connected");
    enableControls(true);
    requestProcessList();
  };

  ws.onmessage = (event) => {
    const msg = decodeMsgpack(event.data);
    if (!msg) {
      console.error("Failed to decode message");
      return;
    }
    handleMessage(msg);
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    updateStatus("error", "Connection Error");
  };

  ws.onclose = () => {
    console.log("Process manager disconnected");
    updateStatus("disconnected", "Disconnected");
    enableControls(false);
    setTimeout(() => connect(), 3000);
  };
}

function updateStatus(state, text) {
  const icons = {
    connecting: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
    connected: '<i class="fa-solid fa-circle text-green-400"></i>',
    error: '<i class="fa-solid fa-circle-exclamation text-red-400"></i>',
    disconnected: '<i class="fa-solid fa-circle text-slate-500"></i>',
  };

  statusEl.innerHTML = `${icons[state] || icons.disconnected} ${text}`;
  statusEl.className =
    state === "connected"
      ? "inline-flex items-center gap-2 px-3 py-2 rounded-full bg-green-900/40 text-green-100 border border-green-700/60"
      : "inline-flex items-center gap-2 px-3 py-2 rounded-full bg-slate-800 text-slate-300";
}

function enableControls(enabled) {
  refreshBtn.disabled = !enabled;
  updateKillButton();
}

function updateKillButton() {
  killBtn.disabled = !selectedPid || !ws || ws.readyState !== WebSocket.OPEN;
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(encodeMsgpack(msg));
  }
}

function handleMessage(msg) {
  console.log("Received:", msg.type);

  switch (msg.type) {
    case "ready":
      console.log("Session ready:", msg.sessionId);
      break;
    case "status":
      if (msg.status === "offline") {
        updateStatus("error", "Client Offline");
        enableControls(false);
      }
      break;
    case "process_list_result":
      handleProcessList(msg);
      break;
    case "command_result":
      handleCommandResult(msg);
      break;
    case "cleanup_result":
      handleCleanupResult(msg);
      break;
    case "fun_result":
      handleFunResult(msg);
      break;
    default:
      console.log("Unknown message type:", msg.type);
  }
}

function requestProcessList() {
  send({ type: "process_list" });
  updateStatus("connected", "Loading processes...");
}

function handleProcessList(msg) {
  if (msg.error) {
    processListEl.innerHTML = `<div class="px-4 py-6 text-center text-red-400"><i class="fa-solid fa-exclamation-triangle mr-2"></i>${escapeHtml(msg.error)}</div>`;
    updateStatus("error", "Error loading processes");
    return;
  }

  processes = (msg.processes || []).map((proc) => {
    const normalizeId = (value) => {
      if (typeof value === "bigint") {
        return Number(value);
      }
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return Number.isFinite(value) ? value : 0;
    };
    return {
      ...proc,
      pid: normalizeId(proc.pid),
      ppid: normalizeId(proc.ppid),
    };
  });
  processCountEl.innerHTML = `<i class="fa-solid fa-list"></i> ${processes.length} processes`;
  updateStatus("connected", "Connected");
  buildProcessTree();
  renderProcesses();
}

function buildProcessTree() {
  processMap.clear();
  processes.forEach((proc) => {
    processMap.set(proc.pid, { ...proc, children: [] });
  });

  const roots = [];
  processMap.forEach((proc) => {
    if (proc.ppid && processMap.has(proc.ppid)) {
      processMap.get(proc.ppid).children.push(proc);
    } else {
      roots.push(proc);
    }
  });

  function sortChildren(proc) {
    if (proc.children.length > 0) {
      proc.children.sort((a, b) => {
        let aVal = a[sortField];
        let bVal = b[sortField];

        if (sortField === "name") {
          aVal = aVal.toLowerCase();
          bVal = bVal.toLowerCase();
        }

        if (sortDirection === "asc") {
          return aVal > bVal ? 1 : -1;
        } else {
          return aVal < bVal ? 1 : -1;
        }
      });

      proc.children.forEach((child) => sortChildren(child));
    }
  }

  roots.forEach((proc) => sortChildren(proc));

  roots.sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    if (sortField === "name") {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }

    if (sortDirection === "asc") {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });

  processTree = roots;
}

function renderProcesses() {
  const filtered = [];

  function collectMatches(proc, depth = 0) {
    const matches =
      !searchTerm ||
      proc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proc.pid.toString().includes(searchTerm) ||
      (proc.username &&
        proc.username.toLowerCase().includes(searchTerm.toLowerCase()));

    if (matches) {
      filtered.push({ ...proc, depth });
    }

    if (
      proc.children &&
      proc.children.length > 0 &&
      !collapsedPids.has(proc.pid)
    ) {
      proc.children.forEach((child) => collectMatches(child, depth + 1));
    }
  }

  processTree.forEach((proc) => collectMatches(proc, 0));

  if (filtered.length === 0) {
    processListEl.innerHTML =
      '<div class="px-4 py-6 text-center text-slate-400"><i class="fa-solid fa-inbox mr-2"></i>No processes found</div>';
    return;
  }

  processListEl.innerHTML = "";
  filtered.forEach((proc) => {
    const row = createProcessRow(proc, proc.depth);
    processListEl.appendChild(row);
  });
}

function createProcessRow(proc, depth = 0) {
  const row = document.createElement("div");
  row.className =
    "process-row grid grid-cols-12 gap-3 px-4 py-3 border border-transparent cursor-pointer transition-colors";
  row.dataset.pid = proc.pid;

  if (selectedPid === proc.pid) {
    row.classList.add("selected");
  }

  const cpuColor =
    proc.cpu > 50
      ? "text-red-400"
      : proc.cpu > 20
        ? "text-yellow-400"
        : "text-slate-400";
  const memoryStr = formatBytes(proc.memory);

  const hasChildren = proc.children && proc.children.length > 0;
  const isCollapsed = collapsedPids.has(proc.pid);
  const indent = "    ".repeat(depth);

  let treeIcon = "";
  if (hasChildren) {
    treeIcon = `<span class="tree-icon" data-pid="${escapeHtml(String(proc.pid))}">${isCollapsed ? "▶" : "▼"}</span>`;
  } else if (depth > 0) {
    treeIcon = '<span class="tree-indent"></span>';
  }

  let nameColor = "text-slate-200";
  let iconColor = "text-blue-400";
  if (proc.type === "system") {
    nameColor = "text-purple-400";
    iconColor = "text-purple-400";
  } else if (proc.type === "service") {
    nameColor = "text-cyan-400";
    iconColor = "text-cyan-400";
  } else if (proc.type === "own") {
    nameColor = "text-green-300";
    iconColor = "text-green-400";
  }

  row.innerHTML = `
    <div class="col-span-1 text-sm font-mono text-slate-400">${proc.pid}</div>
    <div class="col-span-4 flex items-center gap-1 truncate">
      ${indent}${treeIcon}<i class="fa-solid fa-microchip ${iconColor}"></i>
      <span class="truncate ${nameColor}">${escapeHtml(proc.name)}</span>
    </div>
    <div class="col-span-2 text-sm ${cpuColor} font-semibold">${proc.cpu.toFixed(1)}%</div>
    <div class="col-span-2 text-sm text-slate-400">${memoryStr}</div>
    <div class="col-span-3 text-sm text-slate-500 truncate">${escapeHtml(proc.username || "-")}</div>
  `;

  row.onclick = (e) => {
    if (e.target.classList.contains("tree-icon")) {
      toggleCollapse(proc.pid);
      return;
    }
    selectProcess(proc.pid);
  };

  row.ondblclick = () => {
    selectProcess(proc.pid);
    killProcess();
  };

  return row;
}

function toggleCollapse(pid) {
  if (collapsedPids.has(pid)) {
    collapsedPids.delete(pid);
  } else {
    collapsedPids.add(pid);
  }
  renderProcesses();
}

function selectProcess(pid) {
  selectedPid = pid;
  updateKillButton();
  renderProcesses();
}

function killProcess() {
  if (!selectedPid) return;

  const proc = processes.find((p) => p.pid === selectedPid);
  if (!proc) return;

  if (!confirm(`Kill process "${proc.name}" (PID: ${proc.pid})?`)) return;

  const pid = Number(selectedPid);
  if (!Number.isFinite(pid) || pid <= 0) {
    alert("Invalid PID selected.");
    return;
  }
  console.log("Killing process:", pid);
  send({ type: "process_kill", pid });
  updateStatus("connected", "Killing process...");
}

function handleCommandResult(msg) {
  if (!msg.ok) {
    alert(`Operation failed: ${msg.message || "Unknown error"}`);
    updateStatus("connected", "Connected");
  } else {
    setTimeout(() => requestProcessList(), 500);
  }
}

// ── Cleanup ────────────────────────────────────────────────────────────────
const cleanupBtn = document.getElementById("cleanup-btn");
const cleanupResult = document.getElementById("cleanup-result");

function handleCleanupResult(msg) {
  if (!cleanupResult) return;
  cleanupResult.classList.remove("hidden");
  if (!msg.ok && msg.errors?.length) {
    cleanupResult.innerHTML = `<span class="text-red-400">Error: ${escapeHtml(msg.errors.join(", "))}</span>`;
    return;
  }
  const cleared = (msg.cleared || []).map((s) => `<span class="text-green-400">✓ ${escapeHtml(s)}</span>`).join("<br>");
  const errors = (msg.errors || []).map((s) => `<span class="text-red-400">✗ ${escapeHtml(s)}</span>`).join("<br>");
  cleanupResult.innerHTML = (cleared + (errors ? "<br>" + errors : "")) || "<span class='text-slate-500'>Nothing cleared.</span>";
}

if (cleanupBtn) {
  cleanupBtn.addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    cleanupResult?.classList.add("hidden");
    send({ type: "cleanup" });
    cleanupBtn.disabled = true;
    setTimeout(() => { if (cleanupBtn) cleanupBtn.disabled = false; }, 5000);
  });
}

// ── Fun Actions ────────────────────────────────────────────────────────────
const funToast = document.getElementById("fun-toast");
const funModal = document.getElementById("fun-modal");
const funModalTitle = document.getElementById("fun-modal-title");
const funModalFields = document.getElementById("fun-modal-fields");
const funModalOk = document.getElementById("fun-modal-ok");
const funModalCancel = document.getElementById("fun-modal-cancel");
const volumeSlider = document.getElementById("volume-slider");
const volumeLabel = document.getElementById("volume-label");

if (volumeSlider) {
  volumeSlider.addEventListener("input", () => {
    if (volumeLabel) volumeLabel.textContent = volumeSlider.value + "%";
  });
}

let pendingFunAction = null;

function showFunModal(title, fields) {
  if (!funModal) return;
  funModalTitle.textContent = title;
  funModalFields.innerHTML = fields
    .map((f) => `<div class="flex flex-col gap-1">
      <label class="text-xs text-slate-400">${escapeHtml(f.label)}</label>
      <input id="fun-field-${escapeHtml(f.id)}" type="text" placeholder="${escapeHtml(f.placeholder || "")}"
        class="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200 focus:outline-none focus:border-blue-500" />
    </div>`)
    .join("");
  funModal.classList.remove("hidden");
  funModalFields.querySelector("input")?.focus();
}

function closeFunModal() {
  if (funModal) funModal.classList.add("hidden");
  pendingFunAction = null;
}

if (funModalCancel) funModalCancel.addEventListener("click", closeFunModal);
if (funModal) funModal.addEventListener("click", (e) => { if (e.target === funModal) closeFunModal(); });

if (funModalOk) {
  funModalOk.addEventListener("click", () => {
    if (!pendingFunAction) return;
    const payload = { type: "fun", action: pendingFunAction };
    funModalFields.querySelectorAll("input").forEach((el) => {
      payload[el.id.replace("fun-field-", "")] = el.value;
    });
    send(payload);
    closeFunModal();
  });
}

function handleFunResult(msg) {
  if (!funToast) return;
  funToast.classList.remove("hidden");
  funToast.textContent = msg.ok ? `✓ ${msg.message}` : `✗ ${msg.message}`;
  funToast.style.color = msg.ok ? "#86efac" : "#f87171";
  setTimeout(() => funToast.classList.add("hidden"), 4000);
}

document.querySelectorAll(".fun-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const action = btn.dataset.fun;
    if (!action) return;

    if (action === "msgbox") {
      pendingFunAction = "msgbox";
      showFunModal("Message Box", [
        { id: "title", label: "Title", placeholder: "Notice" },
        { id: "text", label: "Message text", placeholder: "Hello!" },
      ]);
    } else if (action === "tts") {
      pendingFunAction = "tts";
      showFunModal("Text-to-Speech", [
        { id: "text", label: "Text to speak", placeholder: "Hello world" },
      ]);
    } else if (action === "wallpaper") {
      pendingFunAction = "wallpaper";
      showFunModal("Change Wallpaper", [
        { id: "url", label: "Image URL (.jpg/.png)", placeholder: "https://..." },
      ]);
    } else if (action === "lock") {
      send({ type: "fun", action: "lock" });
    } else if (action === "volume") {
      const vol = parseInt(volumeSlider?.value || "50", 10);
      send({ type: "fun", action: "volume", volume: vol });
    } else if (action === "shutdown") {
      const mode = document.getElementById("shutdown-mode")?.value || "shutdown";
      if (!confirm(`${mode.charAt(0).toUpperCase() + mode.slice(1)} the remote machine?`)) return;
      send({ type: "fun", action: "shutdown", mode });
    }
  });
});
function setSortField(field) {
  if (sortField === field) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortField = field;
    sortDirection = field === "name" ? "asc" : "desc";
  }
  buildProcessTree();
  renderProcesses();
  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('[id^="sort-"]').forEach((el) => {
    const field = el.id.replace("sort-", "");
    const icon = el.querySelector("i");
    if (field === sortField) {
      icon.className =
        sortDirection === "asc"
          ? "fa-solid fa-sort-up"
          : "fa-solid fa-sort-down";
    } else {
      icon.className = "fa-solid fa-sort";
    }
  });
}

function formatBytes(bytes) {
  if (bytes === 0 || bytes === 0n) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  if (typeof bytes === "bigint") {
    const k = 1024n;
    let i = 0;
    let value = bytes;
    while (value >= k && i < sizes.length - 1) {
      value /= k;
      i += 1;
    }
    return `${value.toString()} ${sizes[i]}`;
  }
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

refreshBtn.onclick = () => requestProcessList();
killBtn.onclick = () => killProcess();

searchInput.oninput = (e) => {
  searchTerm = e.target.value;
  renderProcesses();
};

document.getElementById("sort-pid").onclick = () => setSortField("pid");
document.getElementById("sort-name").onclick = () => setSortField("name");
document.getElementById("sort-cpu").onclick = () => setSortField("cpu");
document.getElementById("sort-memory").onclick = () => setSortField("memory");

setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    requestProcessList();
  }
}, 3000);

updateStatus("connecting", "Connecting...");
connect();
updateSortIndicators();
