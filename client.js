// dsh-mota-executor — browser half.
//
// A multi-Agent console designed after Apple's Human Interface Guidelines:
// grouped inset lists, a segmented control, hairline separators, SF-style
// type ramp, semantic status colors, and a light/dark material system that
// follows the host theme. Every read/write goes through the plugin's own Host
// routes under /mota/api; this bundle only renders.
window.__ModuleLoader__.load({
  id: 'dsh-mota-executor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const PANEL_ID = 'dsh-mota-executor';
    const NS = 'mota';
    const BRAND = '#FF5500';

    const POSITIONS = [
      ['FUNDAMENTAL_ANALYST', '基本面分析师'],
      ['TECHNICAL_ANALYST', '技术分析师'],
      ['STRATEGIST', '策略师'],
      ['PORTFOLIO_MANAGER', '组合经理'],
      ['RISK_MANAGER', '风控经理'],
      ['EXECUTION_TRADER', '执行交易员'],
    ];

    const ZH = {
      title: 'MoTA Executor',
      nav: 'MoTA Executor',
      subtitle: '在本机运行多个 MoTA Creator 绑定式 Pull Agent：每个 Agent 独立队列、独立并发、独立用量与费用。',
      openPage: '在浏览器中打开',
      tabsAgents: 'Agent',
      tabsUsage: '用量与费用',
      tabsLogs: '日志',
      addAgent: '新增 Agent',
      noAgents: '还没有配置 Agent。点「新增 Agent」，粘贴 Creator 的接入指令即可开始。',
      back: '返回',
      newAgent: '新增 Agent',
      editAgent: 'Agent 设置',
      name: '名称',
      nameHint: '留空则使用 Agent Code',
      queueUrl: 'Queue 地址',
      token: 'Agent Token（BOUND_PULL，mpk_ 开头）',
      tokenKeep: '已安全保存，留空则沿用',
      position: '岗位',
      concurrency: '并发数',
      concurrencyHint: '同时执行的任务数（1–8）',
      save: '保存',
      create: '创建 Agent',
      test: '测试连接',
      start: '启动',
      stop: '停止',
      delete: '删除',
      deleteConfirm: '确定删除这个 Agent？本机保存的 Token 与统计会一并删除。',
      disabledTag: '已停用',
      queueDepth: '队列深度',
      concurrencyShort: '并发',
      activeRuns: '执行中',
      stats: '统计',
      runs: '任务数',
      accepted: '已接受',
      rejected: '未接受',
      promptTokens: '输入 tokens',
      completionTokens: '输出 tokens',
      totalTokens: '总 tokens',
      invocations: '模型调用',
      cost: '费用',
      costUnset: '未配置单价',
      pricingHint: '费用按插件配置的单价（每百万 token）估算。',
      usageTitle: '用量与费用',
      usageEmpty: '暂无统计。任务回传后会自动累计。',
      logsTitle: '日志',
      logsEmpty: '暂无日志。',
      logAgent: 'Agent',
      logLevel: '级别',
      all: '全部',
      levelInfo: '信息',
      levelWarn: '警告',
      levelError: '错误',
      recentRuns: '最近任务',
      noRuns: '还没有执行过任务。',
      duration: '耗时',
      parse: '解析',
      receipt: '接入指令',
      receiptHint: '粘贴 Creator 的整段接入指令，自动填好 Queue、Token 与岗位；Agent Code 与 Worker ID 在后台解析或生成。',
      parsed: '已从文本中解析出绑定字段。',
      missing: '还缺：{fields}',
      saved: '已保存。',
      created: 'Agent 已创建。',
      deleted: 'Agent 已删除。',
      testOk: '心跳正常：队列深度 {depth}，延迟 {ms} ms。',
      phaseStopped: '未连接',
      phaseConnecting: '连接中',
      phaseOnline: '在线',
      phaseError: '出错',
      agentsCount: '{n} 个 Agent',
      onlineCount: '{n} 在线',
      lastError: '最近错误',
      tokens: 'tokens',
    };

    const EN = {
      title: 'MoTA Executor',
      nav: 'MoTA Executor',
      subtitle: 'Run several bound Pull Agents for MoTA Creator: each with its own queue, concurrency, usage and cost.',
      openPage: 'Open in browser',
      tabsAgents: 'Agents',
      tabsUsage: 'Usage & Cost',
      tabsLogs: 'Logs',
      addAgent: 'Add Agent',
      noAgents: 'No Agents yet. Use “Add Agent” and paste the Creator instruction.',
      back: 'Back',
      newAgent: 'New Agent',
      editAgent: 'Agent Settings',
      name: 'Name',
      nameHint: 'Defaults to the Agent Code',
      queueUrl: 'Queue URL',
      token: 'Agent Token (BOUND_PULL, starts with mpk_)',
      tokenKeep: 'Stored securely — leave blank to keep',
      position: 'Position',
      concurrency: 'Concurrency',
      concurrencyHint: 'Tasks in flight at once (1–8)',
      save: 'Save',
      create: 'Create Agent',
      test: 'Test Connection',
      start: 'Start',
      stop: 'Stop',
      delete: 'Delete',
      deleteConfirm: 'Delete this Agent and its locally stored token and statistics?',
      disabledTag: 'Disabled',
      queueDepth: 'Queue depth',
      concurrencyShort: 'Concurrency',
      activeRuns: 'Running',
      stats: 'Statistics',
      runs: 'Runs',
      accepted: 'Accepted',
      rejected: 'Rejected',
      promptTokens: 'Prompt tokens',
      completionTokens: 'Completion tokens',
      totalTokens: 'Total tokens',
      invocations: 'Model calls',
      cost: 'Cost',
      costUnset: 'No price set',
      pricingHint: 'Cost is estimated from the configured per-million-token prices.',
      usageTitle: 'Usage & Cost',
      usageEmpty: 'No statistics yet. They accumulate after tasks are returned.',
      logsTitle: 'Logs',
      logsEmpty: 'No logs yet.',
      logAgent: 'Agent',
      logLevel: 'Level',
      all: 'All',
      levelInfo: 'Info',
      levelWarn: 'Warn',
      levelError: 'Error',
      recentRuns: 'Recent Runs',
      noRuns: 'No runs yet.',
      duration: 'Duration',
      parse: 'Parse',
      receipt: 'Creator instruction',
      receiptHint: 'Paste the full Creator instruction; queue, token and position are filled automatically. Agent Code and Worker ID are parsed or generated behind the scenes.',
      parsed: 'Parsed the binding fields from the text.',
      missing: 'Still missing: {fields}',
      saved: 'Saved.',
      created: 'Agent created.',
      deleted: 'Agent deleted.',
      testOk: 'Heartbeat OK: queue depth {depth}, latency {ms} ms.',
      phaseStopped: 'Not connected',
      phaseConnecting: 'Connecting',
      phaseOnline: 'Online',
      phaseError: 'Error',
      agentsCount: '{n} Agents',
      onlineCount: '{n} online',
      lastError: 'Last error',
      tokens: 'tokens',
    };

    // ------------------------------------------------------------------
    // Design system — Apple-style materials, type ramp, and controls.
    // Light/dark palettes are scoped to .mota-root and selected from the
    // host theme; the sidebar entry uses host tokens directly.
    // ------------------------------------------------------------------
    const STYLE = `
.mota-root{
  --m-bg:#f5f5f7; --m-card:#ffffff; --m-inset:#fbfbfd;
  --m-text:#1d1d1f; --m-text2:#6e6e73; --m-text3:#86868b;
  --m-sep:rgba(0,0,0,.08); --m-sep2:rgba(0,0,0,.05);
  --m-fill:rgba(120,120,128,.12); --m-fill2:rgba(120,120,128,.2);
  --m-seg-sel:#ffffff;
  --m-tint:${BRAND}; --m-tint-press:#e04b00; --m-ring:rgba(255,85,0,.22);
  --m-green:#248a3d; --m-red:#d70015; --m-orange:#c93400; --m-idle:#8e8e93;
  --m-green-bg:rgba(52,199,89,.12); --m-red-bg:rgba(255,59,48,.1);
  --m-shadow:0 1px 2px rgba(0,0,0,.04),0 6px 24px rgba(0,0,0,.05);
  height:100%; overflow:auto; background:var(--m-bg); color:var(--m-text);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:14px; line-height:1.45; -webkit-font-smoothing:antialiased;
}
.mota-root[data-theme="dark"]{
  --m-bg:#1c1c1e; --m-card:#2c2c2e; --m-inset:#232325;
  --m-text:#f5f5f7; --m-text2:#98989d; --m-text3:#636366;
  --m-sep:rgba(255,255,255,.1); --m-sep2:rgba(255,255,255,.06);
  --m-fill:rgba(120,120,128,.24); --m-fill2:rgba(120,120,128,.34);
  --m-seg-sel:#636366;
  --m-tint-press:#ff6a1a; --m-ring:rgba(255,85,0,.32);
  --m-green:#30d158; --m-red:#ff453a; --m-orange:#ff9f0a; --m-idle:#8e8e93;
  --m-green-bg:rgba(48,209,88,.14); --m-red-bg:rgba(255,69,58,.14);
  --m-shadow:0 1px 2px rgba(0,0,0,.35);
}
.mota-root *{box-sizing:border-box}
.mota-root ::selection{background:var(--m-ring)}
.mota-wrap{max-width:960px;margin:0 auto;padding:28px 24px 64px}
.mota-head{display:flex;align-items:center;gap:12px}
.mota-title{font-size:26px;font-weight:700;letter-spacing:-.02em;margin:0}
.mota-count{font-size:13px;color:var(--m-text2);font-weight:500}
.mota-online{font-size:13px;color:var(--m-green);font-weight:600}
.mota-link{margin-left:auto;font-size:13px;color:var(--m-tint);text-decoration:none;font-weight:500}
.mota-link:hover{text-decoration:underline}
.mota-sub{margin:6px 0 0;font-size:13px;color:var(--m-text2);max-width:640px}
.mota-seg{display:inline-flex;background:var(--m-fill);border-radius:9px;padding:2px;gap:2px;margin:20px 0 16px}
.mota-seg button{border:0;background:transparent;border-radius:7px;padding:5px 16px;font:inherit;font-size:13px;font-weight:500;color:var(--m-text2);cursor:pointer;transition:background .18s ease,color .18s ease}
.mota-seg button:hover{color:var(--m-text)}
.mota-seg button[aria-selected="true"]{background:var(--m-seg-sel);color:var(--m-text);box-shadow:0 1px 4px rgba(0,0,0,.14)}
.mota-group{background:var(--m-card);border-radius:12px;box-shadow:var(--m-shadow);overflow:hidden;margin-top:14px}
.mota-group-head{display:flex;align-items:center;gap:10px;padding:14px 16px 10px}
.mota-group-title{font-size:15px;font-weight:600;margin:0;letter-spacing:-.01em}
.mota-row{display:flex;align-items:center;gap:14px;width:100%;padding:13px 16px;border:0;border-top:1px solid var(--m-sep2);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .15s ease}
.mota-group > .mota-row:first-child,.mota-group-head + .mota-row{border-top:0}
.mota-row:hover{background:var(--m-fill)}
.mota-row-static{cursor:default}
.mota-row-static:hover{background:transparent}
.mota-row-main{flex:1;min-width:0}
.mota-row-name{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;letter-spacing:-.01em}
.mota-row-name .mota-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mota-row-sub{margin-top:2px;font-size:12px;color:var(--m-text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mota-row-mid{display:flex;gap:18px;font-size:12px;color:var(--m-text2);white-space:nowrap}
.mota-row-mid b{color:var(--m-text);font-weight:600;font-variant-numeric:tabular-nums}
.mota-row-end{text-align:right;font-size:12px;color:var(--m-text2);white-space:nowrap;font-variant-numeric:tabular-nums}
.mota-row-end b{display:block;color:var(--m-text);font-weight:600}
.mota-chev{color:var(--m-text3);font-size:16px;font-weight:600}
.mota-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:0 0 auto}
.mota-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;white-space:nowrap}
.mota-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border:0;border-radius:8px;background:var(--m-fill);color:var(--m-text);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s ease,opacity .15s ease;white-space:nowrap}
.mota-btn:hover{background:var(--m-fill2)}
.mota-btn:disabled{opacity:.45;cursor:default}
.mota-btn-primary{background:var(--m-tint);color:#fff;font-weight:600}
.mota-btn-primary:hover{background:var(--m-tint-press)}
.mota-btn-plain{background:transparent;color:var(--m-text2)}
.mota-btn-plain:hover{background:var(--m-fill);color:var(--m-text)}
.mota-btn-danger{background:transparent;color:var(--m-red)}
.mota-btn-danger:hover{background:var(--m-red-bg)}
.mota-btn-lg{height:36px;padding:0 18px;font-size:14px;border-radius:9px}
.mota-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px}
.mota-field{display:flex;flex-direction:column;gap:5px;padding:12px 16px;border-top:1px solid var(--m-sep2)}
.mota-field:first-child{border-top:0}
.mota-label{font-size:12px;font-weight:500;color:var(--m-text2)}
.mota-hint{font-size:11px;color:var(--m-text3)}
.mota-input,.mota-select,.mota-textarea{width:100%;border:1px solid var(--m-sep);border-radius:8px;background:var(--m-inset);color:var(--m-text);font:inherit;font-size:14px;padding:8px 10px;transition:border-color .15s ease,box-shadow .15s ease}
.mota-textarea{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px;resize:vertical;min-height:72px}
.mota-input:focus,.mota-select:focus,.mota-textarea:focus{outline:none;border-color:var(--m-tint);box-shadow:0 0 0 3px var(--m-ring)}
.mota-select{width:auto;padding:6px 8px;font-size:13px;border-radius:8px}
.mota-grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
@media (max-width:720px){.mota-grid2{grid-template-columns:1fr}}
.mota-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1px;background:var(--m-sep2)}
.mota-stat{background:var(--m-card);padding:12px 16px}
.mota-stat-label{font-size:11px;color:var(--m-text2);font-weight:500}
.mota-stat-value{margin-top:2px;font-size:17px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.mota-banner{margin-top:14px;padding:10px 14px;border-radius:10px;font-size:13px;white-space:pre-wrap}
.mota-banner-error{background:var(--m-red-bg);color:var(--m-red)}
.mota-banner-ok{background:var(--m-green-bg);color:var(--m-green)}
.mota-empty{padding:36px 20px;text-align:center;color:var(--m-text2);font-size:13px}
.mota-table{width:100%;border-collapse:collapse;font-size:13px}
.mota-table th{font-size:11px;font-weight:500;color:var(--m-text2);text-align:right;padding:10px 12px;border-bottom:1px solid var(--m-sep)}
.mota-table th:first-child{text-align:left}
.mota-table td{padding:10px 12px;text-align:right;border-top:1px solid var(--m-sep2);font-variant-numeric:tabular-nums;white-space:nowrap}
.mota-table td:first-child{text-align:left;font-weight:500}
.mota-table tr:first-child td{border-top:0}
.mota-logs{max-height:480px;overflow:auto;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11.5px}
.mota-log{display:grid;grid-template-columns:132px 128px 52px minmax(0,1fr);gap:10px;padding:6px 16px;border-top:1px solid var(--m-sep2);align-items:baseline}
.mota-log:first-child{border-top:0}
.mota-log-time{color:var(--m-text3)}
.mota-log-agent{color:var(--m-text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mota-log-msg{color:var(--m-text);white-space:pre-wrap;word-break:break-word}
.mota-foot{margin-top:18px;font-size:11px;color:var(--m-text3)}
.mota-root::-webkit-scrollbar,.mota-logs::-webkit-scrollbar{width:8px}
.mota-root::-webkit-scrollbar-thumb,.mota-logs::-webkit-scrollbar-thumb{background:var(--m-fill2);border-radius:4px}
.mota-root::-webkit-scrollbar-track,.mota-logs::-webkit-scrollbar-track{background:transparent}
@media (prefers-reduced-motion:reduce){.mota-root *{transition:none!important}}
/* Sidebar entry — lives outside .mota-root, so it uses host theme tokens. */
.mota-nav{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;cursor:pointer;flex:0 0 auto;max-width:100%;transition:background .15s ease,color .15s ease}
.mota-nav:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary)}
.mota-nav span{white-space:nowrap}
`;

    let styleInjected = false;
    function ensureStyle() {
      if (styleInjected || typeof document === 'undefined') return;
      const el = document.createElement('style');
      el.id = 'mota-design';
      el.textContent = STYLE;
      document.head.appendChild(el);
      styleInjected = true;
    }

    /** Follow the host theme by sampling its background token's luminance. */
    function detectTheme() {
      try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim();
        const match = raw.match(/rgba?\(([^)]+)\)/);
        if (match) {
          const [r, g, b] = match[1].split(',').map((v) => parseFloat(v));
          if ([r, g, b].every((v) => Number.isFinite(v))) {
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5 ? 'dark' : 'light';
          }
        }
        if (raw.startsWith('#')) {
          const hex = raw.slice(1);
          const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
          const n = parseInt(full.slice(0, 6), 16);
          if (Number.isFinite(n)) {
            const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5 ? 'dark' : 'light';
          }
        }
      } catch {
        // fall through to media query
      }
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        return 'dark';
      }
    }

    function MotaIcon({ size = 16 }) {
      const white = '#FFFFFF';
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 40 40', fill: 'none', 'aria-hidden': true, style: { display: 'block', flex: '0 0 auto', borderRadius: size * 0.22 } },
        h('path', { d: 'M0 4C0 1.79086 1.79086 0 4 0H36C38.2091 0 40 1.79086 40 4V36C40 38.2091 38.2091 40 36 40H4C1.79086 40 0 38.2091 0 36V4Z', fill: BRAND }),
        h('rect', { x: '12.8008', y: '24.3438', width: '3.2', height: '11.6571', fill: white }),
        h('rect', { x: '18.7422', y: '4', width: '3.2', height: '14.8571', fill: white }),
        h('rect', { x: '29.2578', y: '7.19922', width: '3.2', height: '8.45714', fill: white }),
        h('rect', { x: '18.7422', y: '7.19922', width: '3.2', height: '13.7143', transform: 'rotate(-90 18.7422 7.19922)', fill: white }),
        h('rect', { x: '24.6855', y: '18.8594', width: '3.2', height: '7.77143', transform: 'rotate(-90 24.6855 18.8594)', fill: white }),
        h('path', { d: 'M25.056 32.8008H31.3322V36.0008H23.9922L25.056 32.8008Z', fill: white }),
        h('path', { d: 'M33.1426 36.002H29.4727L25.5996 25.041L21.7266 36.002H18.0566L23.3066 21.1445H27.8926L33.1426 36.002Z', fill: white }),
        h('path', { d: 'M12.8008 7.19922H16.0008V18.8564H12.8008L12.8008 7.19922Z', fill: white }),
        h('rect', { x: '6.85742', y: '4', width: '3.2', height: '14.8571', fill: white }),
        h('path', { d: 'M6.85742 21.1445H16.0003V24.3445H6.85742V21.1445Z', fill: white }),
      );
    }

    function Status({ phase, t }) {
      const map = {
        online: ['var(--m-green)', t('phaseOnline')],
        connecting: ['var(--m-orange)', t('phaseConnecting')],
        error: ['var(--m-red)', t('phaseError')],
        stopped: ['var(--m-idle)', t('phaseStopped')],
      };
      const [color, text] = map[phase] ?? map.stopped;
      return h('span', { className: 'mota-status', style: { color } }, h('span', { className: 'mota-dot', style: { background: color } }), text);
    }

    function timeText(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      return date.toLocaleString('zh-CN', { hour12: false });
    }

    function durationText(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
      if (ms < 1000) return `${Math.round(ms)} ms`;
      return `${(ms / 1000).toFixed(1)} s`;
    }

    function moneyText(cost) {
      if (!cost || !cost.configured) return null;
      const amount = Number(cost.amount ?? 0);
      return `${cost.currency ?? 'CNY'} ${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
    }

    function fmtNumber(value) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number)) return '0';
      return number.toLocaleString('en-US');
    }

    async function request(path, init) {
      const res = await fetch(`/mota/api/${path}`, {
        headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
        ...init,
      });
      const json = await res.json().catch(() => ({ ok: false, error: 'invalid response' }));
      if (!json.ok) throw new Error(json.error || '请求失败');
      return json;
    }

    function Field({ label, hint, children }) {
      return h(
        'div',
        { className: 'mota-field' },
        h('label', { className: 'mota-label' }, label),
        children,
        hint ? h('span', { className: 'mota-hint' }, hint) : null,
      );
    }

    function AgentRow({ agent, t, onOpen }) {
      const status = agent.status ?? {};
      const cost = moneyText(agent.stats?.cost);
      return h(
        'button',
        { type: 'button', className: 'mota-row', onClick: onOpen },
        h(
          'div',
          { className: 'mota-row-main' },
          h('div', { className: 'mota-row-name' }, h('span', { className: 'mota-ellipsis' }, agent.name), h(Status, { phase: status.phase ?? 'stopped', t })),
          h('div', { className: 'mota-row-sub' }, `${agent.positionLabel ?? agent.positionType} · ${agent.agentCode}`),
        ),
        h(
          'div',
          { className: 'mota-row-mid' },
          h('span', null, t('queueDepth'), ' ', h('b', null, status.queueDepth ?? '—')),
          h('span', null, t('concurrencyShort'), ' ', h('b', null, agent.concurrency)),
        ),
        h(
          'div',
          { className: 'mota-row-end' },
          h('b', null, `${fmtNumber(agent.stats?.totalTokens)} ${t('tokens')}`),
          cost ?? t('costUnset'),
        ),
        h('span', { className: 'mota-chev', 'aria-hidden': true }, '›'),
      );
    }

    function AgentForm({ t, agent, mode, onDone, onTest, onAction, onDelete, setError, setNote }) {
      const [form, setForm] = useState({
        name: agent?.name ?? '',
        queueUrl: agent?.queueUrl ?? '',
        token: '',
        positionType: agent?.positionType ?? '',
        concurrency: agent?.concurrency ?? 1,
        agentCode: agent?.agentCode ?? '',
        workerId: agent?.workerId ?? '',
      });
      const [receipt, setReceipt] = useState('');
      const [busy, setBusy] = useState('');
      const editing = mode === 'edit';
      const set = (patch) => setForm((current) => ({ ...current, ...patch }));

      const onParse = async () => {
        setBusy('parse');
        setError('');
        try {
          const json = await request('parse', { method: 'POST', body: JSON.stringify({ text: receipt }) });
          const found = json.found ?? {};
          set({
            queueUrl: found.queueUrl ?? form.queueUrl,
            token: found.token ?? form.token,
            positionType: found.positionType ?? form.positionType,
            agentCode: found.agentCode ?? form.agentCode,
            workerId: found.workerId ?? form.workerId,
          });
          const missing = json.missing ?? [];
          setNote(missing.length ? t('missing').replace('{fields}', missing.join(', ')) : t('parsed'));
        } catch (error) {
          setError(String(error.message ?? error));
        } finally {
          setBusy('');
        }
      };

      const onSave = async () => {
        setBusy('save');
        setError('');
        setNote('');
        try {
          const body = JSON.stringify({
            name: form.name,
            queueUrl: form.queueUrl,
            token: form.token,
            positionType: form.positionType,
            concurrency: Number(form.concurrency) || 1,
            agentCode: form.agentCode,
            workerId: form.workerId,
          });
          const json = editing
            ? await request(`agents/${agent.id}`, { method: 'PATCH', body })
            : await request('agents', { method: 'POST', body });
          setNote(editing ? t('saved') : t('created'));
          onDone(json.agent);
        } catch (error) {
          setError(String(error.message ?? error));
        } finally {
          setBusy('');
        }
      };

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'mota-group' },
          h(
            'div',
            { className: 'mota-group-head' },
            h('h2', { className: 'mota-group-title' }, editing ? t('editAgent') : t('newAgent')),
            h('span', { style: { flex: 1 } }),
            editing && agent?.status ? h(Status, { phase: agent.status.phase ?? 'stopped', t }) : null,
          ),
          h(Field, { label: t('receipt'), hint: t('receiptHint') },
            h('textarea', { className: 'mota-textarea', value: receipt, onChange: (event) => setReceipt(event.target.value), rows: 3 }),
          ),
          h('div', { className: 'mota-field' },
            h('button', { type: 'button', className: 'mota-btn', onClick: onParse, disabled: !receipt.trim() || busy === 'parse' }, t('parse')),
          ),
          h(
            'div',
            { className: 'mota-grid2' },
            h(Field, { label: t('name'), hint: t('nameHint') }, h('input', { className: 'mota-input', value: form.name, onChange: (event) => set({ name: event.target.value }), spellCheck: false })),
            h(Field, { label: t('queueUrl') }, h('input', { className: 'mota-input', value: form.queueUrl, onChange: (event) => set({ queueUrl: event.target.value }), spellCheck: false })),
            h(Field, { label: t('token'), hint: editing ? t('tokenKeep') : null }, h('input', { className: 'mota-input', type: 'password', value: form.token, onChange: (event) => set({ token: event.target.value }), placeholder: editing ? '••••••••' : 'mpk_…', spellCheck: false, autoComplete: 'off' })),
            h(Field, { label: t('position') }, h(
              'select',
              { className: 'mota-input', value: form.positionType, onChange: (event) => set({ positionType: event.target.value }) },
              h('option', { value: '' }, '—'),
              ...POSITIONS.map(([value, label]) => h('option', { key: value, value }, `${label}（${value}）`)),
            )),
            h(Field, { label: t('concurrency'), hint: t('concurrencyHint') }, h('input', { className: 'mota-input', type: 'number', min: 1, max: 8, value: form.concurrency, onChange: (event) => set({ concurrency: event.target.value }) })),
          ),
          h(
            'div',
            { className: 'mota-field' },
            h(
              'div',
              { className: 'mota-toolbar', style: { marginTop: 0 } },
              h('button', { type: 'button', className: 'mota-btn mota-btn-primary', onClick: onSave, disabled: busy === 'save' }, editing ? t('save') : t('create')),
              editing ? h('button', { type: 'button', className: 'mota-btn', onClick: onTest }, t('test')) : null,
              editing ? h('button', { type: 'button', className: 'mota-btn', onClick: () => onAction(agent.enabled ? 'stop' : 'start') }, agent.enabled ? t('stop') : t('start')) : null,
              editing ? h('button', { type: 'button', className: 'mota-btn mota-btn-danger', onClick: onDelete }, t('delete')) : null,
            ),
          ),
        ),
        editing
          ? h(
              'div',
              { className: 'mota-group' },
              h('div', { className: 'mota-group-head' }, h('h2', { className: 'mota-group-title' }, t('stats'))),
              h(
                'div',
                { className: 'mota-stats' },
                ...[
                  [t('runs'), fmtNumber(agent.stats?.runs)],
                  [t('accepted'), fmtNumber(agent.stats?.accepted)],
                  [t('rejected'), fmtNumber(agent.stats?.rejected)],
                  [t('promptTokens'), fmtNumber(agent.stats?.promptTokens)],
                  [t('completionTokens'), fmtNumber(agent.stats?.completionTokens)],
                  [t('totalTokens'), fmtNumber(agent.stats?.totalTokens)],
                  [t('invocations'), fmtNumber(agent.stats?.invocations)],
                  [t('cost'), moneyText(agent.stats?.cost) ?? t('costUnset')],
                ].map(([label, value]) => h('div', { className: 'mota-stat', key: label }, h('div', { className: 'mota-stat-label' }, label), h('div', { className: 'mota-stat-value' }, value))),
              ),
            )
          : null,
      );
    }

    function Panel({ t }) {
      const [data, setData] = useState(null);
      const [tab, setTab] = useState('agents');
      const [selectedId, setSelectedId] = useState(null);
      const [creating, setCreating] = useState(false);
      const [logs, setLogs] = useState({ logs: [], total: 0 });
      const [logAgent, setLogAgent] = useState('all');
      const [logLevel, setLogLevel] = useState('all');
      const [error, setError] = useState('');
      const [note, setNote] = useState('');
      const [theme, setTheme] = useState(() => detectTheme());
      const rootRef = useRef(null);

      const agents = data?.agents ?? [];
      const pricing = data?.pricing;
      const selected = agents.find((agent) => agent.id === selectedId) ?? null;

      const refresh = useCallback(async () => {
        try {
          const json = await request('state');
          setData(json);
          setError('');
        } catch (err) {
          setError(String(err.message ?? err));
        }
        setTheme(detectTheme());
      }, []);

      useEffect(() => {
        ensureStyle();
        void refresh();
        const timer = setInterval(() => {
          if (!document.hidden) void refresh();
        }, 3000);
        const observer = new MutationObserver(() => setTheme(detectTheme()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
        return () => {
          clearInterval(timer);
          observer.disconnect();
        };
      }, [refresh]);

      useEffect(() => {
        if (tab !== 'logs') return undefined;
        let stopped = false;
        const load = async () => {
          try {
            const json = await request(`logs?agentId=${encodeURIComponent(logAgent)}&level=${encodeURIComponent(logLevel)}&limit=200`);
            if (!stopped) setLogs({ logs: json.logs ?? [], total: json.total ?? 0 });
          } catch (err) {
            if (!stopped) setError(String(err.message ?? err));
          }
        };
        void load();
        const timer = setInterval(() => {
          if (!document.hidden) void load();
        }, 3000);
        return () => {
          stopped = true;
          clearInterval(timer);
        };
      }, [tab, logAgent, logLevel]);

      const run = async (job) => {
        setError('');
        setNote('');
        try {
          await job();
        } catch (err) {
          setError(String(err.message ?? err));
        }
      };

      const onSaveDone = (agent) => {
        setSelectedId(agent?.id ?? null);
        setCreating(false);
        void refresh();
      };

      const onTest = (agentId) =>
        run(async () => {
          const json = await request(`agents/${agentId}/action`, { method: 'POST', body: JSON.stringify({ action: 'test' }) });
          const probe = json.probe ?? {};
          setNote(t('testOk').replace('{depth}', String(probe.queueDepth ?? '—')).replace('{ms}', String(probe.latencyMs ?? '—')));
        });

      const onAction = (agentId, action) =>
        run(async () => {
          await request(`agents/${agentId}/action`, { method: 'POST', body: JSON.stringify({ action }) });
          await refresh();
        });

      const onDelete = (agent) => {
        if (!window.confirm(t('deleteConfirm'))) return;
        void run(async () => {
          await request(`agents/${agent.id}`, { method: 'DELETE' });
          setSelectedId(null);
          setNote(t('deleted'));
          await refresh();
        });
      };

      const online = agents.filter((agent) => agent.status?.phase === 'online').length;
      const tabs = [
        ['agents', t('tabsAgents')],
        ['usage', t('tabsUsage')],
        ['logs', t('tabsLogs')],
      ];

      let body = null;
      if (tab === 'agents') {
        if (creating || selected) {
          body = h(
            'div',
            null,
            h('div', { className: 'mota-toolbar' },
              h('button', { type: 'button', className: 'mota-btn mota-btn-plain', onClick: () => { setCreating(false); setSelectedId(null); } }, `‹ ${t('back')}`),
            ),
            h(AgentForm, {
              t,
              agent: selected,
              mode: selected ? 'edit' : 'create',
              onDone: onSaveDone,
              onTest: selected ? () => onTest(selected.id) : () => {},
              onAction: selected ? (action) => onAction(selected.id, action) : () => {},
              onDelete: selected ? () => onDelete(selected) : () => {},
              setError,
              setNote,
            }),
            selected
              ? h(
                  'div',
                  { className: 'mota-group' },
                  h('div', { className: 'mota-group-head' }, h('h2', { className: 'mota-group-title' }, t('recentRuns'))),
                  (selected.status?.runs ?? []).length === 0
                    ? h('div', { className: 'mota-empty' }, t('noRuns'))
                    : h(
                        'div',
                        null,
                        ...(selected.status?.runs ?? []).map((run) =>
                          h(
                            'div',
                            { className: 'mota-row mota-row-static', key: `${run.runId}-${run.finishedAt}` },
                            h('div', { className: 'mota-row-main' },
                              h('div', { className: 'mota-row-sub', style: { fontFamily: 'ui-monospace,"SF Mono",Menlo,monospace' } }, run.runId),
                            ),
                            h('span', { style: { fontSize: 12, fontWeight: 600, color: run.accepted ? 'var(--m-green)' : 'var(--m-red)' } }, run.accepted ? t('accepted') : t('rejected')),
                            h('span', { style: { fontSize: 12, color: 'var(--m-text2)' } }, durationText(run.durationMs)),
                          ),
                        ),
                      ),
                )
              : null,
          );
        } else {
          body = h(
            'div',
            null,
            h('div', { className: 'mota-toolbar' },
              h('button', { type: 'button', className: 'mota-btn mota-btn-primary mota-btn-lg', onClick: () => { setCreating(true); setSelectedId(null); } }, `+ ${t('addAgent')}`),
            ),
            h(
              'div',
              { className: 'mota-group' },
              agents.length === 0
                ? h('div', { className: 'mota-empty' }, t('noAgents'))
                : agents.map((agent) => h(AgentRow, { key: agent.id, agent, t, onOpen: () => setSelectedId(agent.id) })),
            ),
          );
        }
      } else if (tab === 'usage') {
        body = h(
          'div',
          { className: 'mota-group' },
          h('div', { className: 'mota-group-head' },
            h('h2', { className: 'mota-group-title' }, t('usageTitle')),
            h('span', { style: { flex: 1 } }),
            h('span', { className: 'mota-hint' }, t('pricingHint')),
          ),
          agents.length === 0
            ? h('div', { className: 'mota-empty' }, t('usageEmpty'))
            : h(
                'div',
                { style: { overflowX: 'auto' } },
                h(
                  'table',
                  { className: 'mota-table' },
                  h('thead', null, h('tr', null,
                    h('th', null, 'Agent'),
                    ...[t('runs'), t('accepted'), t('rejected'), t('promptTokens'), t('completionTokens'), t('totalTokens'), t('invocations'), t('cost')].map((label) => h('th', { key: label }, label)),
                  )),
                  h('tbody', null, ...agents.map((agent) =>
                    h('tr', { key: agent.id },
                      h('td', null, agent.name),
                      h('td', null, fmtNumber(agent.stats?.runs)),
                      h('td', null, fmtNumber(agent.stats?.accepted)),
                      h('td', null, fmtNumber(agent.stats?.rejected)),
                      h('td', null, fmtNumber(agent.stats?.promptTokens)),
                      h('td', null, fmtNumber(agent.stats?.completionTokens)),
                      h('td', null, fmtNumber(agent.stats?.totalTokens)),
                      h('td', null, fmtNumber(agent.stats?.invocations)),
                      h('td', null, moneyText(agent.stats?.cost) ?? t('costUnset')),
                    ),
                  )),
                ),
              ),
        );
      } else {
        body = h(
          'div',
          { className: 'mota-group' },
          h(
            'div',
            { className: 'mota-group-head' },
            h('h2', { className: 'mota-group-title' }, t('logsTitle')),
            h('span', { style: { flex: 1 } }),
            h('select', { className: 'mota-select', value: logAgent, onChange: (event) => setLogAgent(event.target.value), 'aria-label': t('logAgent') },
              h('option', { value: 'all' }, `${t('logAgent')} · ${t('all')}`),
              ...agents.map((agent) => h('option', { key: agent.id, value: agent.id }, agent.name)),
            ),
            h('select', { className: 'mota-select', value: logLevel, onChange: (event) => setLogLevel(event.target.value), 'aria-label': t('logLevel') },
              h('option', { value: 'all' }, `${t('logLevel')} · ${t('all')}`),
              h('option', { value: 'info' }, t('levelInfo')),
              h('option', { value: 'warn' }, t('levelWarn')),
              h('option', { value: 'error' }, t('levelError')),
            ),
          ),
          h(
            'div',
            { className: 'mota-logs' },
            (logs.logs ?? []).length === 0
              ? h('div', { className: 'mota-empty' }, t('logsEmpty'))
              : (logs.logs ?? []).map((log, index) =>
                  h(
                    'div',
                    { className: 'mota-log', key: `${log.ts}-${index}` },
                    h('span', { className: 'mota-log-time' }, timeText(log.ts)),
                    h('span', { className: 'mota-log-agent' }, log.agentName),
                    h('span', { style: { color: log.level === 'error' ? 'var(--m-red)' : log.level === 'warn' ? 'var(--m-orange)' : 'var(--m-text3)', fontWeight: 600 } }, log.level),
                    h('span', { className: 'mota-log-msg' }, `${log.event}: ${log.message}`),
                  ),
                ),
          ),
        );
      }

      return h(
        'div',
        { className: 'mota-root', 'data-theme': theme, ref: rootRef },
        h(
          'main',
          { className: 'mota-wrap' },
          h(
            'header',
            { className: 'mota-head' },
            h(MotaIcon, { size: 30 }),
            h('h1', { className: 'mota-title' }, t('title')),
            h('span', { className: 'mota-count' }, t('agentsCount').replace('{n}', String(agents.length))),
            online > 0 ? h('span', { className: 'mota-online' }, t('onlineCount').replace('{n}', String(online))) : null,
            h('a', { className: 'mota-link', href: '/mota', target: '_blank', rel: 'noreferrer' }, t('openPage')),
          ),
          h('p', { className: 'mota-sub' }, t('subtitle')),
          h(
            'div',
            { className: 'mota-seg', role: 'tablist' },
            ...tabs.map(([id, label]) =>
              h('button', {
                key: id,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === id,
                onClick: () => { setTab(id); setError(''); setNote(''); },
              }, label),
            ),
          ),
          error ? h('div', { className: 'mota-banner mota-banner-error' }, error) : null,
          note ? h('div', { className: 'mota-banner mota-banner-ok' }, note) : null,
          body,
          pricing
            ? h('p', { className: 'mota-foot' }, `${t('pricingHint')} ${pricing.currency} · in ${pricing.inputPerMTok}/M · out ${pricing.outputPerMTok}/M`)
            : null,
        ),
      );
    }

    return {
      // Client services used through property access must be declared here.
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'mota: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.effect(() => {
          ensureStyle();
          const disposers = [];
          disposers.push(
            ctx.slots.register(
              { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t }) },
              (props) => h(Panel, { t: props?.t ?? t }),
            ),
          );
          const dropSection = ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'mota', order: 25, label: () => t('title'), locale: NS, inject: () => ({ t }) },
              (props) => h(Panel, { t: props?.t ?? t }),
            ),
          );
          if (typeof dropSection === 'function') disposers.push(dropSection);

          const openMota = () => {
            const layout = ctx.get('layout');
            layout?.selectPanel?.(PANEL_ID);
          };
          const dropRow = ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: PANEL_ID, order: -20, label: () => t('nav'), locale: NS },
              () =>
                h(
                  'button',
                  { type: 'button', className: 'mota-nav', title: t('title'), onClick: openMota },
                  h(MotaIcon, { size: 16 }),
                  h('span', null, t('nav')),
                ),
            ),
          );
          if (typeof dropRow === 'function') disposers.push(dropRow);

          return () => {
            for (const dispose of disposers) {
              try {
                dispose();
              } catch {
                // best effort
              }
            }
          };
        }, 'mota: mounts');
      },
    };
  },
});
