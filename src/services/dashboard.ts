/**
 * Admin Dashboard HTML/CSS renderer.
 *
 * Generates a self-contained, responsive, dark-themed admin dashboard
 * with zero external UI dependencies. All styles are inlined and all
 * interactivity is vanilla JavaScript that calls the Worker's JSON API
 * endpoints (/api/stats, /api/posts, /api/logs, /api/sync).
 */

import { Env } from "../types";

const DASHBOARD_HTML_CSS =
  '<!DOCTYPE html>\n' +
  '<html lang="en">\n' +
  '<head>\n' +
  '  <meta charset="UTF-8" />\n' +
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
  '  <title>Facebook Supermarket Monitor — Admin</title>\n' +
  '  <style>\n' +
  '    :root {\n' +
  '      --bg: #0b1120;\n' +
  '      --surface: #151c2b;\n' +
  '      --surface-hover: #1c2538;\n' +
  '      --border: #263046;\n' +
  '      --text: #e8eaf2;\n' +
  '      --muted: #8a94a8;\n' +
  '      --accent: #22d3ee;\n' +
  '      --accent-hover: #67e8f9;\n' +
  '      --success: #34d399;\n' +
  '      --danger: #f87171;\n' +
  '      --warning: #fbbf24;\n' +
  '      --radius: 12px;\n' +
  '      --shadow: 0 8px 24px rgba(0, 0, 0, 0.35);\n' +
  '    }\n' +
  '\n' +
  '    * { box-sizing: border-box; margin: 0; padding: 0; }\n' +
  '\n' +
  '    html, body {\n' +
  '      height: 100%;\n' +
  '      background: var(--bg);\n' +
  '      color: var(--text);\n' +
  '      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;\n' +
  '      line-height: 1.5;\n' +
  '      -webkit-font-smoothing: antialiased;\n' +
  '    }\n' +
  '\n' +
  '    body { padding: 24px; }\n' +
  '\n' +
  '    .container { max-width: 1400px; margin: 0 auto; }\n' +
  '\n' +
  '    /* ---------- Header ---------- */\n' +
  '    header {\n' +
  '      display: flex;\n' +
  '      align-items: center;\n' +
  '      justify-content: space-between;\n' +
  '      padding: 16px 0 28px;\n' +
  '      border-bottom: 1px solid var(--border);\n' +
  '    }\n' +
  '\n' +
  '    .brand { display: flex; align-items: center; gap: 12px; }\n' +
  '\n' +
  '    .live-dot {\n' +
  '      width: 8px; height: 8px;\n' +
  '      background: var(--success);\n' +
  '      border-radius: 50%;\n' +
  '      box-shadow: 0 0 8px var(--success);\n' +
  '      animation: pulse 2s infinite;\n' +
  '    }\n' +
  '\n' +
  '    @keyframes pulse {\n' +
  '      0%, 100% { opacity: 1; }\n' +
  '      50% { opacity: 0.5; }\n' +
  '    }\n' +
  '\n' +
  '    h1 {\n' +
  '      font-size: 1.25rem;\n' +
  '      font-weight: 700;\n' +
  '      letter-spacing: -0.01em;\n' +
  '    }\n' +
  '\n' +
  '    h1 span { color: var(--muted); font-weight: 400; font-size: 0.875rem; }\n' +
  '\n' +
  '    .status-pill {\n' +
  '      display: inline-flex;\n' +
  '      align-items: center;\n' +
  '      gap: 8px;\n' +
  '      padding: 6px 14px;\n' +
  '      border-radius: 999px;\n' +
  '      font-size: 0.75rem;\n' +
  '      font-weight: 600;\n' +
  '      border: 1px solid var(--border);\n' +
  '      color: var(--muted);\n' +
  '      background: var(--surface);\n' +
  '    }\n' +
  '\n' +
  '    .status-pill.ok { color: var(--success); border-color: rgba(52, 211, 153, 0.35); background: rgba(52, 211, 153, 0.08); }\n' +
  '    .status-pill.err { color: var(--danger); border-color: rgba(248, 113, 113, 0.35); background: rgba(248, 113, 113, 0.08); }\n' +
  '\n' +
  '    /* ---------- Stats Grid ---------- */\n' +
  '    .stats-grid {\n' +
  '      display: grid;\n' +
  '      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));\n' +
  '      gap: 16px;\n' +
  '      margin-bottom: 32px;\n' +
  '    }\n' +
  '\n' +
  '    .stat-card {\n' +
  '      background: var(--surface);\n' +
  '      border: 1px solid var(--border);\n' +
  '      border-radius: var(--radius);\n' +
  '      padding: 20px;\n' +
  '      display: flex;\n' +
  '      flex-direction: column;\n' +
  '      gap: 8px;\n' +
  '      transition: transform 0.2s, border-color 0.2s;\n' +
  '    }\n' +
  '\n' +
  '    .stat-card:hover { border-color: var(--accent); transform: translateY(-2px); }\n' +
  '\n' +
  '    .stat-label {\n' +
  '      font-size: 0.7rem;\n' +
  '      text-transform: uppercase;\n' +
  '      letter-spacing: 0.09em;\n' +
  '      font-weight: 700;\n' +
  '      color: var(--muted);\n' +
  '    }\n' +
  '\n' +
  '    .stat-value {\n' +
  '      font-size: 1.75rem;\n' +
  '      font-weight: 800;\n' +
  '      font-variant-numeric: tabular-nums;\n' +
  '    }\n' +
  '\n' +
  '    .stat-sub {\n' +
  '      font-size: 0.78rem;\n' +
  '      color: var(--muted);\n' +
  '    }\n' +
  '\n' +
  '    .stat-value.warn { color: var(--warning); }\n' +
  '    .stat-value.ok { color: var(--success); }\n' +
  '    .stat-value.err { color: var(--danger); }\n' +
  '\n' +
  '    /* ---------- Sections ---------- */\n' +
  '    .section {\n' +
  '      background: var(--surface);\n' +
  '      border: 1px solid var(--border);\n' +
  '      border-radius: var(--radius);\n' +
  '      margin-bottom: 24px;\n' +
  '      overflow: hidden;\n' +
  '      box-shadow: var(--shadow);\n' +
  '    }\n' +
  '\n' +
  '    .section-head {\n' +
  '      display: flex;\n' +
  '      align-items: center;\n' +
  '      justify-content: space-between;\n' +
  '      padding: 16px 24px;\n' +
  '      border-bottom: 1px solid var(--border);\n' +
  '      background: rgba(0,0,0,0.2);\n' +
  '    }\n' +
  '\n' +
  '    .section-title {\n' +
  '      display: flex;\n' +
  '      align-items: center;\n' +
  '      gap: 8px;\n' +
  '      font-size: 0.85rem;\n' +
  '      font-weight: 700;\n' +
  '      text-transform: uppercase;\n' +
  '      letter-spacing: 0.08em;\n' +
  '      color: var(--muted);\n' +
  '    }\n' +
  '\n' +
  '    .section-actions { display: flex; gap: 10px; }\n' +
  '\n' +
  '    .section-body { padding: 0; }\n' +
  '\n' +
  '    /* ---------- Buttons ---------- */\n' +
  '    button {\n' +
  '      display: inline-flex;\n' +
  '      align-items: center;\n' +
  '      gap: 6px;\n' +
  '      border: none;\n' +
  '      border-radius: 8px;\n' +
  '      padding: 10px 18px;\n' +
  '      font-size: 0.85rem;\n' +
  '      font-weight: 700;\n' +
  '      cursor: pointer;\n' +
  '      transition: all 0.2s;\n' +
  '      white-space: nowrap;\n' +
  '    }\n' +
  '\n' +
  '    button:disabled { opacity: 0.55; cursor: not-allowed; }\n' +
  '\n' +
  '    .btn-primary {\n' +
  '      background: var(--accent);\n' +
  '      color: #021625;\n' +
  '    }\n' +
  '    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }\n' +
  '\n' +
  '    .btn-secondary {\n' +
  '      background: var(--surface-hover);\n' +
  '      color: var(--text);\n' +
  '      border: 1px solid var(--border);\n' +
  '    }\n' +
  '    .btn-secondary:hover:not(:disabled) { background: #23304a; border-color: var(--accent); }\n' +
  '\n' +
  '    .btn-spinner {\n' +
  '      width: 14px; height: 14px;\n' +
  '      border: 2px solid transparent;\n' +
  '      border-top-color: currentColor;\n' +
  '      border-radius: 50%;\n' +
  '      animation: spin 0.8s linear infinite;\n' +
  '    }\n' +
  '\n' +
  '    @keyframes spin { to { transform: rotate(360deg); } }\n' +
  '\n' +
  '    /* ---------- Tables ---------- */\n' +
  '    .table-wrap { overflow-x: auto; }\n' +
  '\n' +
  '    table { width: 100%; border-collapse: collapse; }\n' +
  '\n' +
  '    th {\n' +
  '      text-align: left;\n' +
  '      font-size: 0.68rem;\n' +
  '      text-transform: uppercase;\n' +
  '      letter-spacing: 0.1em;\n' +
  '      font-weight: 700;\n' +
  '      color: var(--muted);\n' +
  '      padding: 12px 16px;\n' +
  '      border-bottom: 1px solid var(--border);\n' +
  '      white-space: nowrap;\n' +
  '    }\n' +
  '\n' +
  '    td {\n' +
  '      padding: 12px 16px;\n' +
  '      border-bottom: 1px solid var(--border);\n' +
  '      font-size: 0.88rem;\n' +
  '      vertical-align: middle;\n' +
  '    }\n' +
  '\n' +
  '    tr:last-child td { border-bottom: none; }\n' +
  '    tr:hover { background: rgba(34, 211, 238, 0.04); }\n' +
  '\n' +
  '    /* ---------- Store Badge ---------- */\n' +
  '    .store-badge {\n' +
  '      display: inline-flex;\n' +
  '      align-items: center;\n' +
  '      gap: 7px;\n' +
  '      padding: 5px 12px;\n' +
  '      border-radius: 8px;\n' +
  '      font-size: 0.8rem;\n' +
  '      font-weight: 700;\n' +
  '      background: rgba(34, 211, 238, 0.1);\n' +
  '      color: var(--accent);\n' +
  '      border: 1px solid rgba(34, 211, 238, 0.25);\n' +
  '      text-transform: capitalize;\n' +
  '    }\n' +
  '\n' +
  '    .post-id {\n' +
  '      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n' +
  '      font-size: 0.8rem;\n' +
  '      color: var(--muted);\n' +
  '    }\n' +
  '\n' +
  '    .date-cell {\n' +
  '      font-size: 0.82rem;\n' +
  '      color: var(--muted);\n' +
  '    }\n' +
  '\n' +
  '    .title-cell { font-weight: 600; max-width: 260px; }\n' +
  '\n' +
  '    /* Links column */\n' +
  '    .links-col { display: flex; flex-direction: column; gap: 6px; }\n' +
  '\n' +
  '    .link-btn {\n' +
  '      display: inline-flex;\n' +
  '      align-items: center;\n' +
  '      gap: 5px;\n' +
  '      font-size: 0.8rem;\n' +
  '      color: var(--accent);\n' +
  '      text-decoration: none;\n' +
  '      padding: 5px 10px;\n' +
  '      border: 1px solid rgba(34, 211, 238, 0.25);\n' +
  '      border-radius: 6px;\n' +
  '      transition: all 0.2s;\n' +
  '      width: fit-content;\n' +
  '    }\n' +
  '    .link-btn:hover { background: rgba(34, 211, 238, 0.1); border-color: var(--accent); }\n' +
  '\n' +
  '    .link-btn svg { width: 12px; height: 12px; fill: currentColor; }\n' +
  '\n' +
  '    /* Images column */\n' +
  '    .images-col { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }\n' +
  '\n' +
  '    .image-chip {\n' +
  '      display: inline-flex;\n' +
  '      align-items: center;\n' +
  '      gap: 6px;\n' +
  '      font-size: 0.8rem;\n' +
  '      color: var(--muted);\n' +
  '    }\n' +
  '\n' +
  '    .thumb-list {\n' +
  '      display: flex;\n' +
  '      gap: 6px;\n' +
  '      flex-wrap: wrap;\n' +
  '      margin-top: 4px;\n' +
  '    }\n' +
  '\n' +
  '    .thumb {\n' +
  '      width: 36px; height: 36px;\n' +
  '      object-fit: cover;\n' +
  '      border-radius: 6px;\n' +
  '      border: 1px solid var(--border);\n' +
  '      background: #0f172a;\n' +
  '    }\n' +
  '\n' +
  '    .no-images { font-size: 0.78rem; color: var(--muted); font-style: italic; }\n' +
  '\n' +
  '    /* ---------- Empty State ---------- */\n' +
  '    .empty {\n' +
  '      padding: 48px 24px;\n' +
  '      text-align: center;\n' +
  '      color: var(--muted);\n' +
  '    }\n' +
  '\n' +
  '    /* ---------- Toast ---------- */\n' +
  '    #toast {\n' +
  '      position: fixed;\n' +
  '      bottom: 24px;\n' +
  '      right: 24px;\n' +
  '      padding: 12px 20px;\n' +
  '      border-radius: 8px;\n' +
  '      color: #fff;\n' +
  '      font-weight: 700;\n' +
  '      font-size: 0.9rem;\n' +
  '      box-shadow: 0 10px 25px rgba(0,0,0,0.4);\n' +
  '      transform: translateY(120px);\n' +
  '      opacity: 0;\n' +
  '      transition: transform 0.3s, opacity 0.3s;\n' +
  '      z-index: 1000;\n' +
  '      border: 1px solid rgba(255,255,255,0.1);\n' +
  '    }\n' +
  '    #toast.show { transform: translateY(0); opacity: 1; }\n' +
  '    #toast.ok { background: var(--success); }\n' +
  '    #toast.err { background: var(--danger); }\n' +
  '\n' +
  '    /* ---------- Responsive ---------- */\n' +
  '    @media (max-width: 768px) {\n' +
  '      body { padding: 14px; }\n' +
  '      header { flex-direction: column; align-items: flex-start; gap: 14px; }\n' +
  '      .section-actions { flex-direction: column; }\n' +
  '      button { width: 100%; justify-content: center; }\n' +
  '      .stats-grid { grid-template-columns: 1fr; }\n' +
  '      .title-cell { max-width: 160px; }\n' +
  '      .links-col { gap: 4px; }\n' +
  '      .link-btn { font-size: 0.75rem; padding: 4px 8px; }\n' +
  '    }\n' +
  '  </style>\n' +
  '</head>\n' +
  '<body>\n' +
  '  <div class="container">\n' +
  '    <header>\n' +
  '      <div class="brand">\n' +
  '        <div class="live-dot" aria-label="live"></div>\n' +
  '        <h1>Facebook Supermarket <span>Monitor</span></h1>\n' +
  '      </div>\n' +
  '      <div class="status-pill" id="statusPill">\n' +
  '        <span class="live-dot" style="width:6px;height:6px;box-shadow:none;"></span>\n' +
  '        <span id="statusText">Initializing…</span>\n' +
  '      </div>\n' +
  '    </header>\n' +
  '\n' +
  '    <!-- Stats -->\n' +
  '    <div class="stats-grid">\n' +
  '      <div class="stat-card">\n' +
  '        <div class="stat-label">Total Tracked Posts</div>\n' +
  '        <div class="stat-value" id="statTotal">–</div>\n' +
  '        <div class="stat-sub">Across all 10 stores</div>\n' +
  '      </div>\n' +
  '      <div class="stat-card">\n' +
  '        <div class="stat-label">New Posts Today</div>\n' +
  '        <div class="stat-value" id="statToday">–</div>\n' +
  '        <div class="stat-sub">Last 24 hours</div>\n' +
  '      </div>\n' +
  '      <div class="stat-card">\n' +
  '        <div class="stat-label">Last Sync Time</div>\n' +
  '        <div class="stat-value" id="statLastSync">–</div>\n' +
  '        <div class="stat-sub">Cron runs every 5 min</div>\n' +
  '      </div>\n' +
  '      <div class="stat-card">\n' +
  '        <div class="stat-label">Avg Delay (24h)</div>\n' +
  '        <div class="stat-value" id="statLatency">–</div>\n' +
  '        <div class="stat-sub">Publish → Discovery</div>\n' +
  '      </div>\n' +
  '      <div class="stat-card">\n' +
  '        <div class="stat-label">Database Health</div>\n' +
  '        <div class="stat-value ok" id="statHealth">–</div>\n' +
  '        <div class="stat-sub">D1 SQLite at Edge</div>\n' +
  '      </div>\n' +
  '    </div>\n' +
  '\n' +
  '    <!-- Manual Sync -->\n' +
  '    <div class="section">\n' +
  '      <div class="section-head">\n' +
  '        <div class="section-title">🔄 Manual Sync</div>\n' +
  '        <div class="section-actions">\n' +
  '          <button id="btnSync" class="btn-primary">\n' +
  '            <span id="syncBtnLabel">Sync Now</span>\n' +
  '          </button>\n' +
  '          <button id="btnRefresh" class="btn-secondary">Refresh</button>\n' +
  '        </div>\n' +
  '      </div>\n' +
  '      <div class="section-body" style="padding:16px 24px;">\n' +
  '        <p style="font-size:0.85rem;color:var(--muted);">\n' +
  '          Trigger an immediate sync run to check all 10 Egyptian supermarket\n' +
  '          Facebook pages for new posts via the free Google Alerts feed.\n' +
  '        </p>\n' +
  '      </div>\n' +
  '    </div>\n' +
  '\n' +
  '    <!-- Recent Posts -->\n' +
  '    <div class="section">\n' +
  '      <div class="section-head">\n' +
  '        <div class="section-title">📦 Recent Posts</div>\n' +
  '      </div>\n' +
  '      <div class="section-body table-wrap">\n' +
  '        <table>\n' +
  '          <thead>\n' +
  '            <tr>\n' +
  '              <th style="width:140px;">Store</th>\n' +
  '              <th style="width:260px;">Title</th>\n' +
  '              <th style="width:130px;">Post ID</th>\n' +
  '              <th style="width:150px;">Discovered</th>\n' +
  '              <th style="width:150px;">Published Est.</th>\n' +
  '              <th style="width:90px;">Delay</th>\n' +
  '              <th>Links</th>\n' +
  '              <th style="width:140px;">Images</th>\n' +
  '            </tr>\n' +
  '          </thead>\n' +
  '          <tbody id="postsBody"></tbody>\n' +
  '        </table>\n' +
  '      </div>\n' +
  '    </div>\n' +
  '\n' +
  '    <!-- Sync Logs -->\n' +
  '    <div class="section">\n' +
  '      <div class="section-head">\n' +
  '        <div class="section-title">📋 Sync Logs (Last 10 Runs)</div>\n' +
  '      </div>\n' +
  '      <div class="section-body table-wrap">\n' +
  '        <table>\n' +
  '          <thead>\n' +
  '            <tr>\n' +
  '              <th style="width:170px;">Run At</th>\n' +
  '              <th style="width:110px;">Stores</th>\n' +
  '              <th style="width:110px;">New Posts</th>\n' +
  '              <th style="width:100px;">Status</th>\n' +
  '              <th>Error Message</th>\n' +
  '            </tr>\n' +
  '          </thead>\n' +
  '          <tbody id="logsBody"></tbody>\n' +
  '        </table>\n' +
  '      </div>\n' +
  '    </div>\n' +
  '  </div>\n' +
  '\n' +
  '  <div id="toast"></div>\n' +
  '\n' +
  '  <script>\n' +
  '    const API_KEY = (new URLSearchParams(location.search).get("key") || "");\n' +
  '    const BASE = location.pathname.replace(/\\/$/, "");\n' +
  '\n' +
  '    let isSyncing = false;\n' +
  '\n' +
  '    async function apiGet(path) {\n' +
  '      const res = await fetch(BASE + "/api/" + path + "?key=" + encodeURIComponent(API_KEY));\n' +
  '      if (res.status === 401) {\n' +
  '        showToast("Unauthorized: invalid dashboard key", false);\n' +
  '        throw new Error("Unauthorized");\n' +
  '      }\n' +
  '      if (!res.ok) throw new Error("API " + path + " failed: " + res.status);\n' +
  '      return res.json();\n' +
  '    }\n' +
  '\n' +
  '    async function apiPost(path) {\n' +
  '      const res = await fetch(BASE + "/api/" + path + "?key=" + encodeURIComponent(API_KEY), {\n' +
  '        method: "POST",\n' +
  '      });\n' +
  '      if (res.status === 401) {\n' +
  '        showToast("Unauthorized: invalid dashboard key", false);\n' +
  '        throw new Error("Unauthorized");\n' +
  '      }\n' +
  '      if (!res.ok) throw new Error("API " + path + " failed: " + res.status);\n' +
  '      return res.json();\n' +
  '    }\n' +
  '\n' +
  '    function fmtDate(iso) {\n' +
  '      if (!iso) return "–";\n' +
  '      try {\n' +
  '        return new Date(iso).toLocaleString(undefined, {\n' +
  '          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",\n' +
  '        });\n' +
  '      } catch { return iso; }\n' +
  '    }\n' +
  '\n' +
  '    function showToast(msg, ok = true) {\n' +
  '      const t = document.getElementById("toast");\n' +
  '      t.textContent = msg;\n' +
  '      t.className = "ok"; // base\n' +
  '      t.className = ok ? "show ok" : "show err";\n' +
  '      setTimeout(() => { t.classList.remove("show"); }, 4000);\n' +
  '    }\n' +
  '\n' +
  '    function statusBadge(status) {\n' +
  '      const ok = String(status).toUpperCase() === "SUCCESS";\n' +
  '      return ok\n' +
  '        ? \'<span class="status-pill ok">● SUCCESS</span>\'\n' +
  '        : \'<span class="status-pill err">● ERROR</span>\';\n' +
  '    }\n' +
  '\n' +
  '    async function loadStats() {\n' +
  '      try {\n' +
  '        const d = await apiGet("stats");\n' +
  '        document.getElementById("statTotal").textContent = d.total_posts ?? 0;\n' +
  '        document.getElementById("statToday").textContent = d.new_posts_today ?? 0;\n' +
  '        document.getElementById("statLastSync").textContent = d.last_sync_time ? fmtDate(d.last_sync_time) : "Never";\n' +
  '        const latEl = document.getElementById("statLatency");\n' +
  '        latEl.textContent = d.avg_latency_24h != null ? d.avg_latency_24h + " min" : "N/A";\n' +
  '        const healthEl = document.getElementById("statHealth");\n' +
  '        const healthy = d.db_health === "healthy";\n' +
  '        healthEl.textContent = healthy ? "Healthy" : "Degraded";\n' +
  '        healthEl.className = "stat-value " + (healthy ? "ok" : "err");\n' +
  '        document.getElementById("statusText").textContent = healthy ? "System operational" : "Degraded";\n' +
  '        document.getElementById("statusPill").className = "status-pill " + (healthy ? "ok" : "err");\n' +
  '      } catch (e) {\n' +
  '        console.error("loadStats", e);\n' +
  '      }\n' +
  '    }\n' +
  '\n' +
  '    async function loadPosts() {\n' +
  '      try {\n' +
  '        const posts = await apiGet("posts");\n' +
  '        const body = document.getElementById("postsBody");\n' +
  '        if (!posts || posts.length === 0) {\n' +
  '          body.innerHTML = \'<tr><td colspan="8" class="empty">No posts tracked yet. Run a sync to discover posts.</td></tr>\';\n' +
  '          return;\n' +
  '        }\n' +
  '        body.innerHTML = posts.map(function(p) {\n' +
  '          const images = p.images_json ? JSON.parse(p.images_json) : [];\n' +
  '          const imageCount = images.length;\n' +
  '          const thumbs = images.slice(0, 4).map(function(u) {\n' +
  '            return \'<img class="thumb" src="\' + escapeHtml(u) + \'" alt="thumb" loading="lazy">\';\n' +
  '          }).join("");\n' +
  '          const more = imageCount > 4 ? "+" + (imageCount - 4) : "";\n' +
  '          var sharedLink;\n' +
  '          if (p.shared_post_id) {\n' +
  '            sharedLink = \'<a class="link-btn" href="https://www.facebook.com/\' + p.shared_post_id + \'" target="_blank" rel="noopener">Shared Post ↗</a>\';\n' +
  '          } else {\n' +
  '            sharedLink = \'<span class="link-btn" style="color:var(--muted);border-color:transparent;cursor:default;">Not shared</span>\';\n' +
  '          }\n' +
  '          const originalLink = \'<a class="link-btn" href="\' + escapeHtml(p.post_url) + \'" target="_blank" rel="noopener">Original ↗</a>\';\n' +
  '          return \'<tr>\' +\n' +
  '            \'<td><div class="store-badge">\' + escapeHtml(p.store_name) + \'</div></td>\' +\n' +
  '            \'<td class="title-cell" title="\' + escapeHtml(p.post_title || "") + \'">\' + escapeHtml(p.post_title || "(no title)") + \'</td>\' +\n' +
  '            \'<td><span class="post-id">\' + escapeHtml(p.post_id) + \'</span></td>\' +\n' +
  '            \'<td class="date-cell">\' + fmtDate(p.discovered_at) + \'</td>\' +\n' +
  '            \'<td class="date-cell">\' + (p.post_published_at ? fmtDate(p.post_published_at) : "N/A") + \'</td>\' +\n' +
  '            \'<td class="date-cell">\' + (p.latency_minutes != null ? p.latency_minutes + " min" : "N/A") + \'</td>\' +\n' +
  '            \'<td><div class="links-col">\' + originalLink + sharedLink + \'</div></td>\' +\n' +
  '            \'<td><div class="image-chip">\' + imageCount + \' image\' + (imageCount !== 1 ? "s" : "") + \'</div>\' +\n' +
  '            \'<div class="thumb-list">\' + thumbs + (more ? \'<span class="no-images">\' + more + \'</span>\' : "") + \'</div>\' +\n' +
  '            (imageCount === 0 ? \'<div class="no-images">No images</div>\' : "") +\n' +
  '            \'</td></tr>\';\n' +
  '        }).join("");\n' +
  '      } catch (e) {\n' +
  '        console.error("loadPosts", e);\n' +
  '        document.getElementById("postsBody").innerHTML =\n' +
  '          \'<tr><td colspan="8" class="empty">Error loading posts.</td></tr>\';\n' +
  '      }\n' +
  '    }\n' +
  '\n' +
  '    async function loadLogs() {\n' +
  '      try {\n' +
  '        const logs = await apiGet("logs");\n' +
  '        const body = document.getElementById("logsBody");\n' +
  '        if (!logs || logs.length === 0) {\n' +
  '          body.innerHTML = \'<tr><td colspan="5" class="empty">No sync runs recorded yet.</td></tr>\';\n' +
  '          return;\n' +
  '        }\n' +
  '        body.innerHTML = logs.map(function(l) {\n' +
  '          return \'<tr>\' +\n' +
  '            \'<td class="date-cell">\' + fmtDate(l.run_at) + \'</td>\' +\n' +
  '            \'<td>\' + l.stores_checked + \'</td>\' +\n' +
  '            \'<td>\' + l.new_posts_found + \'</td>\' +\n' +
  '            \'<td>\' + statusBadge(l.status) + \'</td>\' +\n' +
  '            \'<td class="date-cell">\' + (l.error_message ? escapeHtml(l.error_message) : "–") + \'</td>\' +\n' +
  '            \'</tr>\';\n' +
  '        }).join("");\n' +
  '      } catch (e) {\n' +
  '        console.error("loadLogs", e);\n' +
  '        document.getElementById("logsBody").innerHTML =\n' +
  '          \'<tr><td colspan="5" class="empty">Error loading logs.</td></tr>\';\n' +
  '      }\n' +
  '    }\n' +
  '\n' +
  '    function escapeHtml(str) {\n' +
  '      if (typeof str !== "string") return "";\n' +
  '      return str\n' +
  '        .replace(/&/g, "&amp;")\n' +
  '        .replace(/</g, "&lt;")\n' +
  '        .replace(/>/g, "&gt;")\n' +
  '        .replace(/"/g, "&quot;")\n' +
  '        .replace(/\\x27/g, "&#039;");\n' +
  '    }\n' +
  '\n' +
  '    async function doSync() {\n' +
  '      if (isSyncing) return;\n' +
  '      isSyncing = true;\n' +
  '      const btn = document.getElementById("btnSync");\n' +
  '      const label = document.getElementById("syncBtnLabel");\n' +
  '      btn.disabled = true;\n' +
  '      btn.classList.add("btn-primary"); // ensure style\n' +
  '      label.textContent = "Syncing…";\n' +
  '      btn.insertAdjacentHTML("beforeend", \'<span class="btn-spinner" id="syncSpinner"></span>\');\n' +
  '\n' +
  '      try {\n' +
  '        const result = await apiPost("sync");\n' +
  '        if (result.status === "SUCCESS") {\n' +
  '          showToast("Sync complete — " + result.new_posts_found + " new post" + (result.new_posts_found !== 1 ? "s" : ""), true);\n' +
  '        } else {\n' +
  '          showToast("Sync error: " + (result.error_message || "unknown"), false);\n' +
  '        }\n' +
  '        await Promise.all([loadStats(), loadPosts(), loadLogs()]);\n' +
  '      } catch (e) {\n' +
  '        showToast("Sync request failed", false);\n' +
  '      } finally {\n' +
  '        isSyncing = false;\n' +
  '        btn.disabled = false;\n' +
  '        label.textContent = "Sync Now";\n' +
  '        const spinner = document.getElementById("syncSpinner");\n' +
  '        if (spinner) spinner.remove();\n' +
  '      }\n' +
  '    }\n' +
  '\n' +
  '    document.getElementById("btnSync").addEventListener("click", doSync);\n' +
  '    document.getElementById("btnRefresh").addEventListener("click", function() {\n' +
  '      Promise.all([loadStats(), loadPosts(), loadLogs()]);\n' +
  '      showToast("Data refreshed", true);\n' +
  '    });\n' +
  '\n' +
  '    // Initial load\n' +
  '    Promise.all([loadStats(), loadPosts(), loadLogs()]);\n' +
  '\n' +
  '    // Auto-refresh every 60 seconds\n' +
  '    setInterval(function() {\n' +
  '      Promise.all([loadStats(), loadPosts(), loadLogs()]);\n' +
  '    }, 60000);\n' +
  '  </script>\n' +
  '</body>\n' +
  '</html>\n';

/**
 * Renders the complete admin dashboard HTML.
 * The page is self-contained; it fetches its own data via the
 * /api/* JSON endpoints on load (and can auto-refresh).
 */
export function renderDashboard(): string {
  return DASHBOARD_HTML_CSS;
}

/**
 * Builds a JSON error response.
 */
export function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Builds a JSON success response.
 */
export function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Extracts the dashboard auth key from query string or Bearer header.
 */
export function extractAuthKey(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("key");
  if (fromQuery) return fromQuery;

  const auth = request.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

/**
 * Validates the request's auth key against the environment secret.
 * Returns a Response if unauthorized, otherwise null.
 */
export function requireAuth(request: Request, env: Env): Response | null {
  const key = extractAuthKey(request);
  if (!key || key !== env.DASHBOARD_AUTH_KEY) {
    return jsonError("Unauthorized", 401);
  }
  return null;
}