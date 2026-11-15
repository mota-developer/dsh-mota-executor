// The plugin's own local setup page, served by the DSH web server at /mota.
// Vanilla HTML/CSS/JS: no client bundle, no build step, no external assets.
import { POSITION_LABELS, POSITION_TO_SCHEMA } from './schema.js';
import { maskToken } from './connection.js';

const MAX_BODY = 512 * 1024;

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

export function setupPageHtml() {
  const positionOptions = Object.keys(POSITION_TO_SCHEMA)
    .map((key) => `<option value="${key}">${POSITION_LABELS[key]}（${key}）</option>`)
    .join('\n        ');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MoTA 连接 · DeepSeek Harness</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --panel: #ffffff; --text: #1d2129; --muted: #6b7280;
    --line: #e5e7eb; --accent: #2563eb; --ok: #047857; --warn: #b45309; --bad: #b91c1c;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#111318; --panel:#181b22; --text:#e5e7eb; --muted:#9ca3af; --line:#2a2f3a; --accent:#60a5fa; --ok:#34d399; --warn:#fbbf24; --bad:#f87171; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
  main { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:6px; }
  h1 { font-size:22px; margin:0; font-weight:650; }
  .sub { color:var(--muted); font-size:13px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; margin-top:18px; }
  .card h2 { font-size:15px; margin:0 0 14px; font-weight:650; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
  .grid .wide { grid-column: 1 / -1; }
  label { display:block; font-size:12px; color:var(--muted); margin-bottom:5px; }
  input, select, textarea { width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; font:inherit; }
  textarea { min-height:96px; font-family:var(--mono); font-size:12px; }
  input:focus, select:focus, textarea:focus { outline:2px solid color-mix(in oklab, var(--accent) 40%, transparent); outline-offset:1px; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:16px; }
  button { padding:9px 16px; border-radius:8px; border:1px solid var(--line); background:var(--panel); color:inherit; font:inherit; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  button.danger { color:var(--bad); }
  button:disabled { opacity:.55; cursor:not-allowed; }
  .status { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .badge { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; border:1px solid var(--line); }
  .badge.online { color:var(--ok); border-color:color-mix(in oklab, var(--ok) 45%, var(--line)); }
  .badge.error, .badge.stopped { color:var(--bad); border-color:color-mix(in oklab, var(--bad) 45%, var(--line)); }
  .badge.connecting { color:var(--warn); border-color:color-mix(in oklab, var(--warn) 45%, var(--line)); }
  dl.kv { display:grid; grid-template-columns: 140px 1fr; gap:8px 14px; margin:14px 0 0; }
  dl.kv dt { color:var(--muted); font-size:12px; }
  dl.kv dd { margin:0; font-family:var(--mono); font-size:12px; word-break:break-all; }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12px; }
  th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:500; }
  td.mono { font-family:var(--mono); }
  .notice { margin-top:12px; font-size:12px; color:var(--muted); }
  .notice.error { color:var(--bad); }
  .notice.ok { color:var(--ok); }
  .hidden { display:none !important; }
  code { font-family:var(--mono); background:color-mix(in oklab, var(--line) 55%, transparent); padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>MoTA 连接</h1>
    <span class="sub">把本机 DeepSeek Harness 作为「绑定式 Pull Worker」接入 MoTA Creator · BOUND_PULL</span>
  </header>

  <section class="card" aria-labelledby="status-title">
    <h2 id="status-title">连接状态</h2>
    <div class="status">
      <span id="phase" class="badge stopped">未连接</span>
      <span id="phase-msg" class="sub">在下面填写或粘贴 Creator 的绑定信息。</span>
    </div>
    <dl class="kv" id="status-kv"></dl>
    <p id="error" class="notice error hidden"></p>
  </section>

  <section class="card" aria-labelledby="form-title">
    <h2 id="form-title">绑定信息</h2>
    <div class="grid">
      <div class="wide">
        <label for="receipt">粘贴 Creator 的绑定说明（可只粘贴整段文字，点「解析」自动提取）</label>
        <textarea id="receipt" placeholder="包含 Queue 地址、Agent Token（mpk_…）、Agent Code、岗位"></textarea>
        <div class="row" style="margin-top:8px">
          <button id="parse">解析绑定说明</button>
          <span class="notice" id="parse-msg"></span>
        </div>
      </div>
      <div class="wide">
        <label for="token">BOUND_PULL Agent Token（mpk_…）</label>
        <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="mpk_…（留空表示沿用已保存的 Token）">
      </div>
      <div class="wide">
        <label for="queueUrl">Queue 地址（Creator 回执里签发）</label>
        <input id="queueUrl" type="url" spellcheck="false" placeholder="https://…/publics/bound/queue/…">
      </div>
      <div>
        <label for="agentCode">Agent Code</label>
        <input id="agentCode" spellcheck="false" placeholder="Creator 页面上的 Agent Code">
      </div>
      <div>
        <label for="positionType">岗位（positionType）</label>
        <select id="positionType">
          <option value="">按 Creator 注册的岗位选择</option>
          ${positionOptions}
        </select>
      </div>
      <div class="wide">
        <label for="workerId">Worker ID（稳定标识，claim 与 renew 必须一致；留空自动生成）</label>
        <input id="workerId" spellcheck="false" placeholder="dsh-…（同一个 Worker 不要频繁变更）">
      </div>
    </div>
    <div class="row">
      <button class="primary" id="connect">保存并连接</button>
      <button id="test">测试连接（心跳）</button>
      <button class="danger" id="disconnect">断开并清除</button>
      <span class="notice" id="action-msg"></span>
    </div>
    <p class="notice">
      Token 保存到 DSH 凭据库（记录 <code>mota/connection</code>），不写入插件配置或日志。保存后 Worker 自动开始心跳与取任务。
      真实队列只接受 <code>https</code>；本地假队列请在插件配置中开启 <code>allowInsecureLoopback</code>。
    </p>
  </section>

  <section class="card" aria-labelledby="runs-title">
    <h2 id="runs-title">最近任务</h2>
    <p class="sub" id="runs-empty">暂无任务。连上后，Creator 派发的任务会在这里显示结果。</p>
    <table id="runs" class="hidden">
      <thead><tr><th>runId</th><th>结果</th><th>耗时</th><th>时间</th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let savedMasked = '';
  let busy = false;

  const esc = (value) => String(value ?? '');
  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
  const fmtMs = (ms) => ms == null ? '—' : (ms > 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms');

  function setNotice(el, text, kind) {
    el.textContent = text || '';
    el.className = 'notice' + (kind ? ' ' + kind : '');
    el.classList.toggle('hidden', !text);
  }

  function renderState(state) {
    const status = state.status || {};
    const conn = state.connection;
    const phaseMap = { online: ['已连接', 'online'], connecting: ['连接中', 'connecting'], error: ['连接异常', 'error'], stopped: ['未连接', 'stopped'] };
    const [label, cls] = phaseMap[status.phase] || ['未连接', 'stopped'];
    $('phase').textContent = label;
    $('phase').className = 'badge ' + cls;
    $('phase-msg').textContent = status.message || '';
    setNotice($('error'), status.lastError || '', 'error');

    if (status.phase === 'online' || status.lastHeartbeatAt) {
      $('phase-msg').textContent = status.message || '';
    }

    const kv = [];
    const add = (k, v) => kv.push('<dt>' + k + '</dt><dd>' + esc(v || '—') + '</dd>');
    if (conn) {
      add('Queue', conn.queueUrl);
      add('Agent Code', conn.agentCode);
      add('岗位', conn.positionLabel || conn.positionType);
      add('Worker ID', conn.workerId);
      add('Token', conn.tokenMasked);
      add('保存时间', fmtTime(conn.savedAt));
    }
    add('队列深度', status.queueDepth == null ? '—' : status.queueDepth);
    add('心跳间隔', status.heartbeatIntervalSeconds == null ? '—' : status.heartbeatIntervalSeconds + ' s');
    add('最近心跳', fmtTime(status.lastHeartbeatAt));
    if (status.activeRunId) add('正在执行', status.activeRunId);
    if (status.lastCompleteAt) add('最近回传', fmtTime(status.lastCompleteAt));
    $('status-kv').innerHTML = kv.join('');

    const runs = Array.isArray(status.runs) ? status.runs : [];
    $('runs-empty').classList.toggle('hidden', runs.length > 0);
    $('runs').classList.toggle('hidden', runs.length === 0);
    const tbody = $('runs').querySelector('tbody');
    tbody.innerHTML = runs.map((r) => {
      const result = r.accepted ? '已接受' : (r.runStatus || '未回传');
      const msg = r.runMsg ? ' · ' + r.runMsg : '';
      return '<tr><td class="mono">' + esc(r.runId) + '</td><td>' + esc(result + msg) + '</td><td class="mono">' + fmtMs(r.durationMs) + '</td><td class="mono">' + fmtTime(r.finishedAt) + '</td></tr>';
    }).join('');

    if (conn) {
      $('queueUrl').value = conn.queueUrl || '';
      $('agentCode').value = conn.agentCode || '';
      $('positionType').value = conn.positionType || '';
      $('workerId').value = conn.workerId || '';
      savedMasked = conn.tokenMasked || '';
      $('token').placeholder = savedMasked ? ('已保存 ' + savedMasked + '，留空表示沿用') : 'mpk_…（Creator 签发）';
    }
    $('disconnect').disabled = !conn || busy;
  }

  async function api(path, payload) {
    const res = await fetch(path, payload === undefined ? { headers: { accept: 'application/json' } } : {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false, error: '响应不是 JSON' }));
    if (!res.ok || data.ok === false) throw new Error(data.error || ('请求失败（HTTP ' + res.status + '）'));
    return data;
  }

  async function refresh() {
    try {
      const data = await api('/mota/api/state');
      renderState(data);
    } catch (error) {
      setNotice($('error'), '无法读取状态：' + error.message, 'error');
    }
  }

  function formPayload() {
    return {
      token: $('token').value.trim(),
      queueUrl: $('queueUrl').value.trim(),
      agentCode: $('agentCode').value.trim(),
      positionType: $('positionType').value,
      workerId: $('workerId').value.trim(),
    };
  }

  async function run(label, fn) {
    if (busy) return;
    busy = true;
    setNotice($('action-msg'), label + '…');
    document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await fn();
    } catch (error) {
      setNotice($('action-msg'), error.message, 'error');
    } finally {
      busy = false;
      document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      await refresh();
    }
  }

  $('parse').addEventListener('click', () => {
    const text = $('receipt').value;
    if (!text.trim()) { setNotice($('parse-msg'), '请先粘贴绑定说明', 'error'); return; }
    run('解析中', async () => {
      const data = await api('/mota/api/parse', { text });
      const found = data.found || {};
      if (found.token) $('token').value = found.token;
      if (found.queueUrl) $('queueUrl').value = found.queueUrl;
      if (found.agentCode) $('agentCode').value = found.agentCode;
      if (found.positionType) $('positionType').value = found.positionType;
      if (found.workerId) $('workerId').value = found.workerId;
      const missing = data.missing || [];
      setNotice($('parse-msg'), missing.length ? ('已提取，还缺：' + missing.join('、')) : '已提取全部字段，确认后点「保存并连接」', missing.length ? '' : 'ok');
      setNotice($('action-msg'), '');
    });
  });

  $('connect').addEventListener('click', () => run('正在保存并验证连接', async () => {
    const data = await api('/mota/api/connect', formPayload());
    $('token').value = '';
    setNotice($('action-msg'), '已保存并连接' + (data.probe ? ('，心跳成功（队列深度 ' + data.probe.queueDepth + '）') : ''), 'ok');
  }));

  $('test').addEventListener('click', () => run('正在测试连接', async () => {
    const data = await api('/mota/api/test', formPayload());
    setNotice($('action-msg'), '心跳成功：队列深度 ' + data.probe.queueDepth + '，心跳间隔 ' + data.probe.heartbeatIntervalSeconds + ' s', 'ok');
  }));

  $('disconnect').addEventListener('click', () => {
    if (!confirm('确定断开 MoTA 并清除本机保存的 Token 与连接信息？')) return;
    run('正在断开', async () => {
      await api('/mota/api/disconnect', {});
      setNotice($('action-msg'), '已断开，本机凭据已清除', 'ok');
    });
  });

  refresh();
  setInterval(refresh, 2500);
})();
</script>
</body>
</html>`;
}

/**
 * Build the /mota route handler. `actions` owns the real work; this module only
 * routes HTTP, reads bounded JSON, and renders the page.
 */
export function createSetupPageHandler({ actions }) {
  return async function handleMotaRequest(req, res) {
    const url = new URL(req.url ?? '/mota', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    try {
      if (url.pathname === '/mota' || url.pathname === '/mota/' || url.pathname === '/mota/index.html') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return send(res, 200, 'text/html; charset=utf-8', setupPageHtml());
      }
      if (url.pathname === '/mota/api/state' && method === 'GET') {
        return sendJson(res, 200, { ok: true, ...(await actions.state()) });
      }
      if (url.pathname === '/mota/api/parse' && method === 'POST') {
        const body = await readJson(req);
        return sendJson(res, 200, { ok: true, ...(await actions.parse(body.text)) });
      }
      if (url.pathname === '/mota/api/connect' && method === 'POST') {
        const body = await readJson(req);
        return sendJson(res, 200, { ok: true, ...(await actions.connect(body)) });
      }
      if (url.pathname === '/mota/api/test' && method === 'POST') {
        const body = await readJson(req);
        return sendJson(res, 200, { ok: true, ...(await actions.test(body)) });
      }
      if (url.pathname === '/mota/api/disconnect' && method === 'POST') {
        await readJson(req);
        return sendJson(res, 200, { ok: true, ...(await actions.disconnect()) });
      }
      return sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error?.message ?? error).slice(0, 400) });
    }
  };
}
