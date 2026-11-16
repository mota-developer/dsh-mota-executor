// dsh-mota-executor — browser half.
//
// A multi-Agent console: the sidebar footer opens a page with three tabs
// (Agents, usage/cost, logs). Every read/write goes through the plugin's own
// Host routes under /mota/api, so bindings, workers and statistics stay in the
// Host process and this bundle only renders them.
window.__ModuleLoader__.load({
  id: 'dsh-mota-executor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const PANEL_ID = 'dsh-mota-executor';
    const NS = 'mota';

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
      openPage: '在浏览器中打开完整设置页',
      tabsAgents: 'Agent',
      tabsUsage: '用量与费用',
      tabsLogs: '日志',
      addAgent: '新增 Agent',
      noAgents: '还没有配置 Agent。先点「新增 Agent」粘贴 Creator 的接入指令。',
      back: '返回列表',
      newAgent: '新增 Agent',
      editAgent: 'Agent 设置',
      name: '名称',
      nameHint: '留空则使用 Agent Code',
      queueUrl: 'Queue 地址',
      token: 'BOUND_PULL Agent Token（mpk_ 开头）',
      tokenKeep: '已保存，留空则沿用',
      position: '岗位',
      concurrency: '并发数',
      concurrencyHint: '同时执行的任务数（1–8）',
      save: '保存',
      saving: '保存中…',
      create: '创建 Agent',
      creating: '创建中…',
      test: '测试连接',
      testing: '测试中…',
      start: '启动',
      stop: '停止',
      delete: '删除',
      deleteConfirm: '确定删除这个 Agent？本机保存的 Token 与统计会一并删除。',
      enabled: '启用',
      disabledTag: '已停用',
      queueDepth: '队列深度',
      heartbeat: '心跳间隔',
      lastHeartbeat: '最近心跳',
      activeRuns: '执行中',
      idle: '空闲',
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
      pricingHint: '费用按插件配置的 priceInputPerMTok / priceOutputPerMTok（每百万 token）估算。',
      usageTitle: '用量与费用统计',
      usageEmpty: '暂无统计。任务回传后会自动累计。',
      logsTitle: 'Agent 日志',
      logsEmpty: '暂无日志。',
      logAgent: 'Agent',
      logLevel: '级别',
      all: '全部',
      levelInfo: '信息',
      levelWarn: '警告',
      levelError: '错误',
      refresh: '刷新',
      recentRuns: '最近任务',
      noRuns: '还没有执行过任务。',
      runId: 'Run ID',
      duration: '耗时',
      parse: '解析',
      parsing: '解析中…',
      receipt: '粘贴 Creator 的接入指令（可选，自动填 Queue / Token / 岗位）',
      receiptHint: 'Agent Code 与 Worker ID 会自动解析或生成。',
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
      status: '状态',
      lastError: '最近错误',
    };

    const EN = {
      title: 'MoTA Executor',
      nav: 'MoTA Executor',
      subtitle: 'Run multiple bound Pull Agents for MoTA Creator: each Agent keeps its own queue, concurrency, usage and cost.',
      openPage: 'Open the full setup page in a browser',
      tabsAgents: 'Agents',
      tabsUsage: 'Usage & cost',
      tabsLogs: 'Logs',
      addAgent: 'Add Agent',
      noAgents: 'No Agents yet. Use “Add Agent” and paste the Creator instruction.',
      back: 'Back to list',
      newAgent: 'New Agent',
      editAgent: 'Agent settings',
      name: 'Name',
      nameHint: 'Defaults to the Agent Code',
      queueUrl: 'Queue URL',
      token: 'BOUND_PULL Agent Token (starts with mpk_)',
      tokenKeep: 'Saved — leave blank to keep',
      position: 'Position',
      concurrency: 'Concurrency',
      concurrencyHint: 'Tasks in flight at once (1–8)',
      save: 'Save',
      saving: 'Saving…',
      create: 'Create Agent',
      creating: 'Creating…',
      test: 'Test connection',
      testing: 'Testing…',
      start: 'Start',
      stop: 'Stop',
      delete: 'Delete',
      deleteConfirm: 'Delete this Agent and its locally stored token and statistics?',
      enabled: 'Enabled',
      disabledTag: 'Disabled',
      queueDepth: 'Queue depth',
      heartbeat: 'Heartbeat',
      lastHeartbeat: 'Last heartbeat',
      activeRuns: 'Running',
      idle: 'Idle',
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
      pricingHint: 'Cost is estimated from priceInputPerMTok / priceOutputPerMTok.',
      usageTitle: 'Usage and cost',
      usageEmpty: 'No statistics yet. They accumulate after tasks are returned.',
      logsTitle: 'Agent logs',
      logsEmpty: 'No logs yet.',
      logAgent: 'Agent',
      logLevel: 'Level',
      all: 'All',
      levelInfo: 'Info',
      levelWarn: 'Warn',
      levelError: 'Error',
      refresh: 'Refresh',
      recentRuns: 'Recent runs',
      noRuns: 'No runs yet.',
      runId: 'Run ID',
      duration: 'Duration',
      parse: 'Parse',
      parsing: 'Parsing…',
      receipt: 'Paste the Creator instruction (optional; fills queue/token/position)',
      receiptHint: 'Agent Code and Worker ID are parsed or generated automatically.',
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
      status: 'Status',
      lastError: 'Last error',
    };

    const BRAND = '#FF5500';

    function MotaIcon({ size = 16, active = false }) {
      const white = '#FFFFFF';
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 40 40',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.82, flex: '0 0 auto' },
        },
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

    const labelStyle = {
      display: 'block',
      fontSize: 12,
      color: 'var(--dsw-alias-label-secondary)',
      marginBottom: 5,
    };

    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 13,
    };

    const buttonBase = {
      padding: '7px 14px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 13,
      cursor: 'pointer',
    };

    const primaryButton = {
      ...buttonBase,
      border: `1px solid ${BRAND}`,
      background: BRAND,
      color: '#fff',
      fontWeight: 600,
    };

    function Card({ children, style }) {
      return h(
        'section',
        {
          style: {
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 12,
            padding: '16px 18px',
            marginTop: 14,
            ...style,
          },
        },
        children,
      );
    }

    function Field({ label, hint, children }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        h('label', { style: labelStyle }, label),
        children,
        hint ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 } }, hint) : null,
      );
    }

    function Pill({ phase, t }) {
      const map = {
        online: ['var(--dsw-alias-state-success-primary)', t('phaseOnline')],
        connecting: ['var(--dsw-alias-state-warn-primary)', t('phaseConnecting')],
        error: ['var(--dsw-alias-state-error-primary)', t('phaseError')],
        stopped: ['var(--dsw-alias-state-idle-primary)', t('phaseStopped')],
      };
      const [color, text] = map[phase] ?? map.stopped;
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 9px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            color,
            border: `1px solid ${color}`,
            whiteSpace: 'nowrap',
          },
        },
        h('span', { style: { width: 6, height: 6, borderRadius: 999, background: color, display: 'inline-block' } }),
        text,
      );
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

    function Stat({ label, value, hint }) {
      return h(
        'div',
        { style: { minWidth: 0 } },
        h('div', { style: { ...labelStyle, marginBottom: 2 } }, label),
        h('div', { style: { fontSize: 13, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis' } }, value),
        hint ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, hint) : null,
      );
    }

    function AgentRow({ agent, t, onOpen }) {
      const status = agent.status ?? {};
      const cost = moneyText(agent.stats?.cost);
      return h(
        'button',
        {
          type: 'button',
          onClick: onOpen,
          style: {
            display: 'grid',
            gridTemplateColumns: 'minmax(150px, 1.2fr) minmax(110px, .8fr) minmax(90px, .6fr) auto',
            gap: 12,
            alignItems: 'center',
            width: '100%',
            padding: '12px 12px',
            marginTop: 8,
            borderRadius: 10,
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
          },
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h('span', { style: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, agent.name),
            h(Pill, { phase: status.phase ?? 'stopped', t }),
          ),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            `${agent.positionLabel ?? agent.positionType} · ${agent.agentCode}`),
        ),
        h(
          'div',
          { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', display: 'flex', flexDirection: 'column', gap: 2 } },
          h('span', null, `${t('queueDepth')}: ${status.queueDepth ?? '—'}`),
          h('span', null, `${t('concurrency')}: ${agent.concurrency}`),
        ),
        h(
          'div',
          { style: { textAlign: 'right', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', display: 'flex', flexDirection: 'column', gap: 2 } },
          h('span', null, `${fmtNumber(agent.stats?.totalTokens)} tokens`),
          h('span', null, cost ?? t('costUnset')),
        ),
      );
    }

    function AgentForm({ t, agent, mode, onDone, onTest, onAction, onDelete, setBusy, setError, setNote }) {
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
          if (editing) {
            const json = await request(`agents/${agent.id}`, { method: 'PATCH', body });
            setNote(t('saved'));
            onDone(json.agent);
          } else {
            const json = await request('agents', { method: 'POST', body });
            setNote(t('created'));
            onDone(json.agent);
          }
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
          Card,
          null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('h2', { style: { fontSize: 14, margin: 0, fontWeight: 650 } }, editing ? t('editAgent') : t('newAgent')),
            h('span', { style: { flex: 1 } }),
            editing && agent?.status ? h(Pill, { phase: agent.status.phase ?? 'stopped', t }) : null,
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 } },
            h(
              Field,
              { label: t('receipt'), hint: t('receiptHint') },
              h('textarea', {
                value: receipt,
                onChange: (event) => setReceipt(event.target.value),
                rows: 3,
                style: { ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
              }),
            ),
            h(
              'div',
              null,
              h(
                'button',
                { type: 'button', onClick: onParse, disabled: !receipt.trim(), style: buttonBase },
                t('parse'),
              ),
            ),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 } },
              h(Field, { label: t('name'), hint: t('nameHint') }, h('input', {
                value: form.name, onChange: (event) => set({ name: event.target.value }), style: inputStyle, spellCheck: false,
              })),
              h(Field, { label: t('queueUrl') }, h('input', {
                value: form.queueUrl, onChange: (event) => set({ queueUrl: event.target.value }), style: inputStyle, spellCheck: false,
              })),
              h(Field, { label: t('token'), hint: editing ? t('tokenKeep') : null }, h('input', {
                type: 'password', value: form.token, onChange: (event) => set({ token: event.target.value }),
                placeholder: editing ? '••••••••' : 'mpk_…', style: inputStyle, spellCheck: false, autoComplete: 'off',
              })),
              h(Field, { label: t('position') }, h(
                'select',
                { value: form.positionType, onChange: (event) => set({ positionType: event.target.value }), style: inputStyle },
                h('option', { value: '' }, '—'),
                ...POSITIONS.map(([value, label]) => h('option', { key: value, value }, `${label}（${value}）`)),
              )),
              h(Field, { label: t('concurrency'), hint: t('concurrencyHint') }, h('input', {
                type: 'number', min: 1, max: 8, value: form.concurrency,
                onChange: (event) => set({ concurrency: event.target.value }), style: inputStyle,
              })),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
              h(
                'button',
                { type: 'button', onClick: onSave, style: primaryButton },
                editing ? t('save') : t('create'),
              ),
              editing
                ? h('button', { type: 'button', onClick: () => onTest(), style: buttonBase }, t('test'))
                : null,
              editing
                ? h('button', { type: 'button', onClick: () => onAction(agent.enabled ? 'stop' : 'start'), style: buttonBase }, agent.enabled ? t('stop') : t('start'))
                : null,
              editing
                ? h('button', {
                    type: 'button',
                    onClick: () => onDelete(),
                    style: { ...buttonBase, color: 'var(--dsw-alias-state-error-primary)' },
                  }, t('delete'))
                : null,
            ),
          ),
        ),
        editing
          ? h(
              Card,
              null,
              h('h2', { style: { fontSize: 14, margin: '0 0 10px', fontWeight: 650 } }, t('stats')),
              h(
                'div',
                { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 } },
                h(Stat, { label: t('runs'), value: fmtNumber(agent.stats?.runs) }),
                h(Stat, { label: t('accepted'), value: fmtNumber(agent.stats?.accepted) }),
                h(Stat, { label: t('rejected'), value: fmtNumber(agent.stats?.rejected) }),
                h(Stat, { label: t('promptTokens'), value: fmtNumber(agent.stats?.promptTokens) }),
                h(Stat, { label: t('completionTokens'), value: fmtNumber(agent.stats?.completionTokens) }),
                h(Stat, { label: t('totalTokens'), value: fmtNumber(agent.stats?.totalTokens) }),
                h(Stat, { label: t('invocations'), value: fmtNumber(agent.stats?.invocations) }),
                h(Stat, { label: t('cost'), value: moneyText(agent.stats?.cost) ?? t('costUnset') }),
              ),
            )
          : null,
      );
    }

    // The form above needs the callbacks injected from the parent; wrap so the
    // component body stays readable.
    function AgentEditor({ t, agent, mode, onDone, onTest, onAction, onDelete, setBusy, setError, setNote }) {
      return h(AgentForm, {
        t,
        agent,
        mode,
        onDone,
        onTest,
        onAction,
        onDelete,
        setBusy,
        setError,
        setNote,
      });
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
      const [busy, setBusy] = useState('');

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
      }, []);

      useEffect(() => {
        void refresh();
        const timer = setInterval(() => {
          if (!document.hidden) void refresh();
        }, 3000);
        return () => clearInterval(timer);
      }, [refresh]);

      useEffect(() => {
        if (tab !== 'logs') return undefined;
        let stopped = false;
        const load = async () => {
          try {
            const query = `logs?agentId=${encodeURIComponent(logAgent)}&level=${encodeURIComponent(logLevel)}&limit=200`;
            const json = await request(query);
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

      const run = async (name, job) => {
        setBusy(name);
        setError('');
        setNote('');
        try {
          await job();
        } catch (err) {
          setError(String(err.message ?? err));
        } finally {
          setBusy('');
        }
      };

      const onSaveDone = (agent) => {
        setSelectedId(agent?.id ?? null);
        setCreating(false);
        void refresh();
      };

      const onTest = (agentId) =>
        run('test', async () => {
          const json = await request(`agents/${agentId}/action`, { method: 'POST', body: JSON.stringify({ action: 'test' }) });
          const probe = json.probe ?? {};
          setNote(t('testOk').replace('{depth}', String(probe.queueDepth ?? '—')).replace('{ms}', String(probe.latencyMs ?? '—')));
        });

      const onAction = (agentId, action) =>
        run(action, async () => {
          await request(`agents/${agentId}/action`, { method: 'POST', body: JSON.stringify({ action }) });
          await refresh();
        });

      const onDelete = (agent) => {
        if (!window.confirm(t('deleteConfirm'))) return;
        void run('delete', async () => {
          await request(`agents/${agent.id}`, { method: 'DELETE' });
          setSelectedId(null);
          setNote(t('deleted'));
          await refresh();
        });
      };

      const tabs = [
        ['agents', t('tabsAgents')],
        ['usage', t('tabsUsage')],
        ['logs', t('tabsLogs')],
      ];

      const online = agents.filter((agent) => agent.status?.phase === 'online').length;

      const header = h(
        'header',
        { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        h(MotaIcon, { size: 26, active: true }),
        h('h1', { style: { fontSize: 20, margin: 0, fontWeight: 650 } }, t('title')),
        h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('agentsCount').replace('{n}', String(agents.length))),
        online > 0
          ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, t('onlineCount').replace('{n}', String(online)))
          : null,
        h(
          'a',
          {
            href: '/mota',
            target: '_blank',
            rel: 'noreferrer',
            style: { marginLeft: 'auto', fontSize: 12, color: BRAND, textDecoration: 'none' },
          },
          t('openPage'),
        ),
      );

      let body = null;
      if (tab === 'agents') {
        if (creating || (selected && selected.id)) {
          body = h(
            'div',
            null,
            h(
              'button',
              { type: 'button', onClick: () => { setCreating(false); setSelectedId(null); }, style: { ...buttonBase, marginTop: 12 } },
              `← ${t('back')}`,
            ),
            h(AgentEditor, {
              t,
              agent: selected,
              mode: selected ? 'edit' : 'create',
              onDone: onSaveDone,
              onTest: selected ? () => onTest(selected.id) : () => {},
              onAction: selected ? (action) => onAction(selected.id, action) : () => {},
              onDelete: selected ? () => onDelete(selected) : () => {},
              setBusy,
              setError,
              setNote,
            }),
            selected
              ? h(
                  Card,
                  null,
                  h('h2', { style: { fontSize: 14, margin: '0 0 10px', fontWeight: 650 } }, t('recentRuns')),
                  (selected.status?.runs ?? []).length === 0
                    ? h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('noRuns'))
                    : h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                        ...(selected.status?.runs ?? []).map((run) =>
                          h(
                            'div',
                            {
                              key: `${run.runId}-${run.finishedAt}`,
                              style: { display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) auto auto', gap: 8, fontSize: 12, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 6 },
                            },
                            h('code', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, run.runId),
                            h('span', { style: { color: run.accepted ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } }, run.accepted ? t('accepted') : t('rejected')),
                            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, durationText(run.durationMs)),
                          ),
                        ),
                      ),
                )
              : null,
          );
        } else {
          body = h(
            'div',
            { style: { marginTop: 14 } },
            h(
              'button',
              { type: 'button', onClick: () => { setCreating(true); setSelectedId(null); }, style: primaryButton },
              `+ ${t('addAgent')}`,
            ),
            agents.length === 0
              ? h('p', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginTop: 14 } }, t('noAgents'))
              : h(
                  'div',
                  null,
                  ...agents.map((agent) => h(AgentRow, { key: agent.id, agent, t, onOpen: () => setSelectedId(agent.id) })),
                ),
          );
        }
      } else if (tab === 'usage') {
        body = h(
          Card,
          null,
          h('h2', { style: { fontSize: 14, margin: '0 0 4px', fontWeight: 650 } }, t('usageTitle')),
          h('p', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', margin: '0 0 10px' } }, t('pricingHint')),
          agents.length === 0
            ? h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('usageEmpty'))
            : h(
                'div',
                { style: { overflowX: 'auto' } },
                h(
                  'table',
                  { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      ...['Agent', t('runs'), t('accepted'), t('rejected'), t('promptTokens'), t('completionTokens'), t('totalTokens'), t('invocations'), t('cost')].map((label) =>
                        h('th', { key: label, style: { textAlign: 'left', padding: '6px 8px', color: 'var(--dsw-alias-label-secondary)', fontWeight: 500, whiteSpace: 'nowrap' } }, label),
                      ),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    ...agents.map((agent) =>
                      h(
                        'tr',
                        { key: agent.id, style: { borderTop: '1px solid var(--dsw-alias-border-l1)' } },
                        h('td', { style: { padding: '6px 8px', whiteSpace: 'nowrap' } }, agent.name),
                        h('td', { style: { padding: '6px 8px' } }, fmtNumber(agent.stats?.runs)),
                        h('td', { style: { padding: '6px 8px' } }, fmtNumber(agent.stats?.accepted)),
                        h('td', { style: { padding: '6px 8px' } }, fmtNumber(agent.stats?.rejected)),
                        h('td', { style: { padding: '6px 8px' } }, fmtNumber(agent.stats?.promptTokens)),
                        h('td', { style: { padding: '6px 8px' } }, fmtNumber(agent.stats?.completionTokens)),
                        h('td', { style: { padding: '6px 8px' } }, fmtNumber(agent.stats?.totalTokens)),
                        h('td', { style: { padding: '6px 8px' } }, fmtNumber(agent.stats?.invocations)),
                        h('td', { style: { padding: '6px 8px', whiteSpace: 'nowrap' } }, moneyText(agent.stats?.cost) ?? t('costUnset')),
                      ),
                    ),
                  ),
                ),
              ),
        );
      } else {
        body = h(
          Card,
          null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('h2', { style: { fontSize: 14, margin: 0, fontWeight: 650 } }, t('logsTitle')),
            h('span', { style: { flex: 1 } }),
            h('select', { value: logAgent, onChange: (event) => setLogAgent(event.target.value), style: { ...inputStyle, width: 'auto' } },
              h('option', { value: 'all' }, `${t('logAgent')}: ${t('all')}`),
              ...agents.map((agent) => h('option', { key: agent.id, value: agent.id }, agent.name)),
            ),
            h('select', { value: logLevel, onChange: (event) => setLogLevel(event.target.value), style: { ...inputStyle, width: 'auto' } },
              h('option', { value: 'all' }, `${t('logLevel')}: ${t('all')}`),
              h('option', { value: 'info' }, t('levelInfo')),
              h('option', { value: 'warn' }, t('levelWarn')),
              h('option', { value: 'error' }, t('levelError')),
            ),
          ),
          h(
            'div',
            { style: { marginTop: 10, maxHeight: 460, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 } },
            (logs.logs ?? []).length === 0
              ? h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, t('logsEmpty'))
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column' } },
                  ...(logs.logs ?? []).map((log, index) =>
                    h(
                      'div',
                      {
                        key: `${log.ts}-${index}`,
                        style: {
                          display: 'grid',
                          gridTemplateColumns: '130px 130px 52px minmax(0, 1fr)',
                          gap: 8,
                          padding: '3px 0',
                          borderTop: index === 0 ? 'none' : '1px solid var(--dsw-alias-border-l1)',
                        },
                      },
                      h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, timeText(log.ts)),
                      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, log.agentName),
                      h('span', { style: { color: log.level === 'error' ? 'var(--dsw-alias-state-error-primary)' : log.level === 'warn' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)' } }, log.level),
                      h('span', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, `${log.event}: ${log.message}`),
                    ),
                  ),
                ),
          ),
        );
      }

      return h(
        'div',
        { style: { height: '100%', overflow: 'auto', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' } },
        h(
          'main',
          { style: { maxWidth: 980, margin: '0 auto', padding: '26px 20px 56px' } },
          header,
          h('p', { style: { margin: '6px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('subtitle')),
          h(
            'div',
            { style: { display: 'flex', gap: 4, marginTop: 16, borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
            ...tabs.map(([id, label]) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  onClick: () => { setTab(id); setError(''); setNote(''); },
                  style: {
                    padding: '8px 14px',
                    border: 'none',
                    borderBottom: tab === id ? `2px solid ${BRAND}` : '2px solid transparent',
                    background: 'transparent',
                    color: tab === id ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                    font: 'inherit',
                    fontSize: 13,
                    fontWeight: tab === id ? 600 : 500,
                    cursor: 'pointer',
                    marginBottom: -1,
                  },
                },
                label,
              ),
            ),
          ),
          error
            ? h('div', { style: { marginTop: 12, padding: '9px 12px', borderRadius: 8, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', border: '1px solid var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap' } }, error)
            : null,
          note
            ? h('div', { style: { marginTop: 12, padding: '9px 12px', borderRadius: 8, fontSize: 12, color: 'var(--dsw-alias-state-success-primary)', border: '1px solid var(--dsw-alias-border-l1)' } }, note)
            : null,
          busy ? h('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, busy) : null,
          body,
          h('p', { style: { marginTop: 18, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
            pricing ? `${t('pricingHint')} ${pricing.currency} · in ${pricing.inputPerMTok}/M · out ${pricing.outputPerMTok}/M` : ''),
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
              // Above the usage rows in the same footer stack.
              { name: 'sidebar.footer.action', id: PANEL_ID, order: -20, label: () => t('nav'), locale: NS },
              () =>
                h(
                  'button',
                  {
                    type: 'button',
                    title: t('title'),
                    onClick: openMota,
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      borderRadius: 8,
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-secondary)',
                      font: 'inherit',
                      fontSize: 12,
                      cursor: 'pointer',
                      flex: '0 0 auto',
                      maxWidth: '100%',
                    },
                  },
                  h(MotaIcon, { size: 16, active: false }),
                  h('span', { style: { whiteSpace: 'nowrap' } }, t('nav')),
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
