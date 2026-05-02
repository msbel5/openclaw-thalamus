#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { runBenchmark } from "./benchmark.js";
import { buildContextPacket } from "./context.js";
import { DASHBOARD_HOST, DASHBOARD_PORT, STATE_DIR } from "./config.js";
import { getHealth } from "./health.js";
import { ensureDirs, redact } from "./system.js";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alcyone Thalamus</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --ink: #1b2430;
      --muted: #647184;
      --line: #d9dee8;
      --ok: #087f5b;
      --bad: #c92a2a;
      --warn: #b7791f;
      --accent: #0b7285;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    header {
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    main { padding: 18px; display: grid; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .wide { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 16px; }
    section, .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-width: 0;
    }
    h1 { margin: 0; font-size: 18px; }
    h2 { margin: 0 0 10px; font-size: 15px; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .value { margin-top: 4px; font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
    .ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); }
    button, input {
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
      color: var(--ink);
      padding: 0 10px;
      font: inherit;
    }
    button { cursor: pointer; }
    button.primary { background: var(--accent); color: white; border-color: var(--accent); }
    .row { display: flex; gap: 8px; align-items: center; }
    input { flex: 1; min-width: 0; }
    pre {
      margin: 0;
      padding: 12px;
      border-radius: 7px;
      background: #0f1720;
      color: #d9e5f2;
      max-height: 440px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    table { width: 100%; border-collapse: collapse; }
    td, th { border-bottom: 1px solid var(--line); text-align: left; padding: 7px; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; }
    @media (max-width: 920px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .wide { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .grid { grid-template-columns: 1fr; }
      header { align-items: flex-start; height: auto; padding: 12px; gap: 8px; flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Alcyone Thalamus</h1>
    <div class="row">
      <button onclick="refresh()">Refresh</button>
      <button onclick="runBenchmark(false)">Context Benchmark</button>
      <button class="primary" onclick="runBenchmark(true)">Hailo Benchmark</button>
    </div>
  </header>
  <main>
    <div class="grid">
      <div class="stat"><div class="label">Hailo</div><div id="s-hailo" class="value">...</div></div>
      <div class="stat"><div class="label">OpenClaw</div><div id="s-openclaw" class="value">...</div></div>
      <div class="stat"><div class="label">Trading Bot</div><div id="s-trading" class="value">...</div></div>
      <div class="stat"><div class="label">Atoms</div><div id="s-atoms" class="value">...</div></div>
    </div>
    <section>
      <h2>Context Packet</h2>
      <div class="row">
        <input id="task" value="Build Sprint 5 magic system with proof and no fabrication" />
        <button class="primary" onclick="makePacket()">Build Packet</button>
      </div>
    </section>
    <div class="wide">
      <section>
        <h2>Packet / Benchmark</h2>
        <pre id="packet">Loading...</pre>
      </section>
      <section>
        <h2>System Detail</h2>
        <table id="detail"></table>
      </section>
    </div>
  </main>
  <script>
    const cls = (ok) => ok ? "ok" : "bad";
    async function getJson(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    function setStatus(id, ok, text) {
      const el = document.getElementById(id);
      el.className = "value " + cls(ok);
      el.textContent = text;
    }
    function renderDetail(health) {
      const rows = [
        ["Generated", health.generated_at],
        ["Host", health.hostname],
        ["Hailo arch", health.hailo?.identify?.architecture || "?"],
        ["Hailo firmware", health.hailo?.identify?.firmware || "?"],
        ["Gateway PID", health.openclaw?.gateway?.props?.MainPID || "?"],
        ["OpenClaw version", health.openclaw?.version || "?"],
        ["MCP servers", (health.openclaw?.mcp_servers || []).join(", ")],
        ["Disk", health.disk?.df_home || "?"]
      ];
      document.getElementById("detail").innerHTML = rows.map(([k,v]) => "<tr><th>" + k + "</th><td>" + String(v) + "</td></tr>").join("");
    }
    async function refresh() {
      const health = await getJson("/api/health");
      setStatus("s-hailo", health.status.hailo, health.status.hailo ? "online" : "bad");
      setStatus("s-openclaw", health.status.openclaw, health.status.openclaw ? "online" : "bad");
      setStatus("s-trading", health.status.trading_bot, health.status.trading_bot ? "active" : "bad");
      setStatus("s-atoms", health.status.atom_memory, String(health.atom_memory?.count || 0));
      renderDetail(health);
      const latest = await getJson("/api/latest");
      document.getElementById("packet").textContent = JSON.stringify(latest.latest_packet || health.status, null, 2);
    }
    async function makePacket() {
      const task = encodeURIComponent(document.getElementById("task").value);
      const packet = await getJson("/api/context?task=" + task);
      document.getElementById("packet").textContent = JSON.stringify(packet, null, 2);
      refresh();
    }
    async function runBenchmark(runHailo) {
      document.getElementById("packet").textContent = "Running benchmark...";
      const report = await getJson("/api/benchmark?runHailo=" + (runHailo ? "1" : "0"));
      document.getElementById("packet").textContent = JSON.stringify(report, null, 2);
      refresh();
    }
    refresh().catch(err => document.getElementById("packet").textContent = err.stack || String(err));
  </script>
</body>
</html>`;

async function readLatest() {
  const latest = {};
  for (const key of ["latest_packet", "latest_benchmark", "latest_health"]) {
    try {
      latest[key] = JSON.parse(await fs.readFile(path.join(STATE_DIR, `${key}.json`), "utf8"));
    } catch {
      latest[key] = null;
    }
  }
  return latest;
}

async function sendJson(res, value) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(value, null, 2));
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204, { "cache-control": "max-age=3600" });
      res.end();
      return;
    }
    if (url.pathname === "/api/health") {
      const health = await getHealth();
      await fs.writeFile(path.join(STATE_DIR, "latest_health.json"), JSON.stringify(health, null, 2));
      await sendJson(res, health);
      return;
    }
    if (url.pathname === "/api/latest") {
      await sendJson(res, await readLatest());
      return;
    }
    if (url.pathname === "/api/context") {
      const task = url.searchParams.get("task") || "Summarize Alcyone Thalamus state";
      await sendJson(res, await buildContextPacket(task, { topK: 5, budgetTokens: 4000 }));
      return;
    }
    if (url.pathname === "/api/benchmark") {
      await sendJson(res, await runBenchmark({ runHailo: url.searchParams.get("runHailo") === "1", noRemote: true }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: redact(error.stack || String(error)) }, null, 2));
  }
}

await ensureDirs();
const server = http.createServer(handle);
server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
  console.log(`Alcyone Thalamus dashboard listening on http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
});
