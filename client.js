// dsh-mota-executor — browser half.
//
// Adds a MoTA row to the global sidebar panel list and an in-app page keyed by
// the same id. The page talks to the Host half through the plugin's own local
// routes on the DSH web server (/mota/api/*), so the binding, the worker and
// the credentials record all stay in one place.
window.__ModuleLoader__.load({
  id: 'dsh-mota-executor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

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
      nav: 'MoTA',
      title: 'MoTA 执行器',
      subtitle: '把本机 DeepSeek Harness 接入 MoTA Creator，作为绑定式 Pull Worker 接收并回传任务。',
      openPage: '在浏览器中打开完整设置页',
      status: '运行状态',
      phaseStopped: '未连接',
      phaseConnecting: '连接中',
      phaseOnline: '在线',
      phaseError: '出错',
      queueDepth: '队列深度',
      heartbeat: '心跳间隔',
      lastHeartbeat: '最近心跳',
      activeRun: '执行中',
      idleRun: '空闲',
      lastResult: '最近回传',
      noResult: '暂无回传记录',
      lastError: '最近错误',
      binding: '绑定信息',
      connectedAs: '已绑定',
      maskedToken: 'Token',
      test: '测试连接',
      disconnect: '断开并清除',
      disconnectConfirm: '确定断开并清除本机保存的绑定吗？',
      formTitle: '接入配置',
      formHint: '粘贴 Creator 给出的接入指令可自动解析，也可以手动填写。Token 只保存在 DSH credentials 中。',
      receipt: '接入指令或绑定回执',
      parse: '解析',
      queueUrl: 'Queue 地址',
      token: 'BOUND_PULL Agent Token（mpk_ 开头）',
      tokenKeep: '已保存，留空则沿用',
      agentCode: 'Agent Code',
      position: '岗位',
      workerId: 'Worker ID',
      workerHint: '留空时自动生成，同一任务的心跳与续租必须一致',
      save: '保存并连接',
      saving: '保存中…',
      testing: '测试中…',
      parsing: '解析中…',
      cleared: '已断开并清除本机绑定。',
      saved: '已保存并开始连接。',
      testOk: '心跳正常：队列深度 {depth}，延迟 {ms} ms。',
      missing: '还需要补充：{fields}',
      parsed: '已从文本中解析出绑定字段。',
      runs: '最近任务',
      noRuns: '还没有执行过任务。',
      runId: 'Run ID',
      accepted: '已接受',
      rejected: '未接受',
      duration: '耗时',
      emptyQueue: '队列空闲',
    };

    const EN = {
      nav: 'MoTA',
      title: 'MoTA executor',
      subtitle: 'Run this DeepSeek Harness agent as a bound Pull worker for MoTA Creator.',
      openPage: 'Open the full setup page in a browser',
      status: 'Status',
      phaseStopped: 'Not connected',
      phaseConnecting: 'Connecting',
      phaseOnline: 'Online',
      phaseError: 'Error',
      queueDepth: 'Queue depth',
      heartbeat: 'Heartbeat',
      lastHeartbeat: 'Last heartbeat',
      activeRun: 'Running',
      idleRun: 'Idle',
      lastResult: 'Last receipt',
      noResult: 'No receipts yet',
      lastError: 'Last error',
      binding: 'Binding',
      connectedAs: 'Bound',
      maskedToken: 'Token',
      test: 'Test connection',
      disconnect: 'Disconnect',
      disconnectConfirm: 'Disconnect and clear the binding stored on this machine?',
      formTitle: 'Connection',
      formHint: 'Paste the instruction from Creator to fill the fields, or type them. The token is stored in DSH credentials only.',
      receipt: 'Instruction or binding receipt',
      parse: 'Parse',
      queueUrl: 'Queue URL',
      token: 'BOUND_PULL Agent Token (starts with mpk_)',
      tokenKeep: 'Saved — leave blank to keep',
      agentCode: 'Agent Code',
      position: 'Position',
      workerId: 'Worker ID',
      workerHint: 'Generated when left blank; claim and renew must use the same id',
      save: 'Save and connect',
      saving: 'Saving…',
      testing: 'Testing…',
      parsing: 'Parsing…',
      cleared: 'Disconnected and cleared the local binding.',
      saved: 'Saved — connecting now.',
      testOk: 'Heartbeat OK: queue depth {depth}, latency {ms} ms.',
      missing: 'Still missing: {fields}',
      parsed: 'Parsed the binding fields from the text.',
      runs: 'Recent runs',
      noRuns: 'No runs yet.',
      runId: 'Run ID',
      accepted: 'Accepted',
      rejected: 'Rejected',
      duration: 'Duration',
      emptyQueue: 'Queue is empty',
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
          style: { display: 'block', opacity: active ? 1 : 0.82 },
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

    function Card({ children, style }) {
      return h(
        'section',
        {
          style: {
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 12,
            padding: '18px 20px',
            marginTop: 16,
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
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color,
            border: `1px solid ${color}`,
          },
        },
        h('span', { style: { width: 7, height: 7, borderRadius: 999, background: color, display: 'inline-block' } }),
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

    function errorText(error) {
      return String(error?.message ?? error ?? '').slice(0, 300);
    }

    function Panel({ t }) {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [note, setNote] = useState('');
      const [busy, setBusy] = useState('');
      const [probe, setProbe] = useState(null);
      const [receipt, setReceipt] = useState('');
      const [form, setForm] = useState({
        token: '',
        queueUrl: '',
        agentCode: '',
        positionType: '',
        workerId: '',
      });
      const dirty = useRef(false);

      const connection = data?.connection ?? null;
      const status = data?.status ?? null;

      const refresh = useCallback(async () => {
        try {
          const res = await fetch('/mota/api/state', { headers: { accept: 'application/json' } });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || 'state unavailable');
          setData(json);
          setError('');
        } catch (err) {
          setError(errorText(err));
        }
      }, []);

      useEffect(() => {
        void refresh();
        const timer = setInterval(() => {
          if (!document.hidden) void refresh();
        }, 3000);
        return () => clearInterval(timer);
      }, [refresh]);

      // Prefill from the saved binding until the user edits the form.
      useEffect(() => {
        if (!connection || dirty.current) return;
        setForm((current) => ({
          ...current,
          queueUrl: connection.queueUrl || '',
          agentCode: connection.agentCode || '',
          positionType: connection.positionType || current.positionType,
          workerId: connection.workerId || current.workerId,
        }));
      }, [connection]);

      function edit(patch) {
        dirty.current = true;
        setForm((current) => ({ ...current, ...patch }));
      }

      async function request(path, body) {
        const res = await fetch(`/mota/api/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        const json = await res.json().catch(() => ({ ok: false, error: 'invalid response' }));
        if (!json.ok) throw new Error(json.error || 'request failed');
        return json;
      }

      async function run(name, job) {
        setBusy(name);
        setError('');
        setNote('');
        try {
          await job();
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy('');
        }
      }

      const onParse = () =>
        run('parse', async () => {
          const json = await request('parse', { text: receipt });
          const found = json.found ?? {};
          const patch = {};
          for (const key of ['token', 'queueUrl', 'agentCode', 'positionType', 'workerId']) {
            if (found[key]) patch[key] = found[key];
          }
          if (Object.keys(patch).length > 0) {
            dirty.current = true;
            setForm((current) => ({ ...current, ...patch }));
          }
          const missing = json.missing ?? [];
          setNote(
            missing.length > 0
              ? t('missing').replace('{fields}', missing.join(', '))
              : t('parsed'),
          );
        });

      const onConnect = () =>
        run('connect', async () => {
          const json = await request('connect', form);
          dirty.current = false;
          setNote(t('saved'));
          setProbe(null);
          setData((current) => ({
            ...(current ?? {}),
            ok: true,
            connection: json.connection ?? null,
            status: json.status ?? current?.status ?? null,
            config: current?.config,
          }));
        });

      const onTest = () =>
        run('test', async () => {
          const json = await request('test', form);
          const result = json.probe ?? {};
          setProbe(result);
          setNote(
            t('testOk')
              .replace('{depth}', String(result.queueDepth ?? '—'))
              .replace('{ms}', String(result.latencyMs ?? '—')),
          );
        });

      const onDisconnect = () => {
        if (!window.confirm(t('disconnectConfirm'))) return;
        void run('disconnect', async () => {
          const json = await request('disconnect');
          setProbe(null);
          setNote(t('cleared'));
          setData((current) => ({
            ...(current ?? {}),
            ok: true,
            connection: null,
            status: json.status ?? { phase: 'stopped', message: '', runs: [] },
          }));
        });
      };

      const phase = status?.phase ?? 'stopped';
      const runs = Array.isArray(status?.runs) ? status.runs : [];

      return h(
        'div',
        {
          style: {
            height: '100%',
            overflow: 'auto',
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
          },
        },
        h(
          'main',
          { style: { maxWidth: 920, margin: '0 auto', padding: '28px 20px 56px' } },
          h(
            'header',
            { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
            h(MotaIcon, { size: 26, active: true }),
            h('h1', { style: { fontSize: 20, margin: 0, fontWeight: 650 } }, t('title')),
            h(Pill, { phase, t }),
            h(
              'a',
              {
                href: '/mota',
                target: '_blank',
                rel: 'noreferrer',
                style: { marginLeft: 'auto', fontSize: 12, color: 'var(--dsw-alias-brand-primary)', textDecoration: 'none' },
              },
              t('openPage'),
            ),
          ),
          h('p', { style: { margin: '8px 0 0', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, t('subtitle')),

          error
            ? h(
                'div',
                {
                  style: {
                    marginTop: 14,
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    color: 'var(--dsw-alias-state-error-primary)',
                    border: '1px solid var(--dsw-alias-state-error-primary)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    whiteSpace: 'pre-wrap',
                  },
                },
                error,
              )
            : null,
          note
            ? h(
                'div',
                {
                  style: {
                    marginTop: 14,
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    color: 'var(--dsw-alias-state-success-primary)',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                  },
                },
                note,
              )
            : null,

          h(
            Card,
            null,
            h('h2', { style: { fontSize: 14, margin: '0 0 12px', fontWeight: 650 } }, t('status')),
            h(
              'div',
              {
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 12,
                  fontSize: 13,
                },
              },
              h('div', null, h('div', { style: labelStyle }, t('queueDepth')), String(status?.queueDepth ?? '—')),
              h(
                'div',
                null,
                h('div', { style: labelStyle }, t('heartbeat')),
                status?.heartbeatIntervalSeconds ? `${status.heartbeatIntervalSeconds} s` : '—',
              ),
              h('div', null, h('div', { style: labelStyle }, t('lastHeartbeat')), timeText(status?.lastHeartbeatAt)),
              h(
                'div',
                null,
                h('div', { style: labelStyle }, t('activeRun')),
                status?.activeRunId ? h('code', { style: { fontSize: 12 } }, status.activeRunId) : t('idleRun'),
              ),
              h(
                'div',
                null,
                h('div', { style: labelStyle }, t('lastResult')),
                status?.lastResult
                  ? h(
                      'span',
                      { style: { color: status.lastResult.accepted ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } },
                      `${status.lastResult.accepted ? t('accepted') : t('rejected')}${status.lastResult.runStatus ? ` · ${status.lastResult.runStatus}` : ''}`,
                    )
                  : t('noResult'),
              ),
              status?.activeRunId && status?.startedAt
                ? h('div', null, h('div', { style: labelStyle }, t('duration')), durationText(Date.now() - Date.parse(status.startedAt)))
                : null,
            ),
            status?.lastError
              ? h(
                  'div',
                  {
                    style: {
                      marginTop: 12,
                      fontSize: 12,
                      color: 'var(--dsw-alias-state-error-primary)',
                      whiteSpace: 'pre-wrap',
                    },
                  },
                  `${t('lastError')}: ${status.lastError}`,
                )
              : null,
          ),

          connection
            ? h(
                Card,
                null,
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' } },
                  h('h2', { style: { fontSize: 14, margin: '0 0 12px', fontWeight: 650 } }, t('binding')),
                  h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, t('connectedAs')),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 10,
                      fontSize: 12,
                    },
                  },
                  h('div', null, h('div', { style: labelStyle }, t('queueUrl')), h('code', { style: { wordBreak: 'break-all' } }, connection.queueUrl ?? '—')),
                  h('div', null, h('div', { style: labelStyle }, t('agentCode')), h('code', null, connection.agentCode ?? '—')),
                  h('div', null, h('div', { style: labelStyle }, t('position')), connection.positionLabel ?? connection.positionType ?? '—'),
                  h('div', null, h('div', { style: labelStyle }, t('workerId')), h('code', null, connection.workerId ?? '—')),
                  h('div', null, h('div', { style: labelStyle }, t('maskedToken')), h('code', null, connection.tokenMasked ?? '—')),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 } },
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: busy !== '',
                      onClick: onTest,
                      style: {
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--dsw-alias-border-l1)',
                        background: 'transparent',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: 13,
                        cursor: 'pointer',
                      },
                    },
                    busy === 'test' ? t('testing') : t('test'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: busy !== '',
                      onClick: onDisconnect,
                      style: {
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--dsw-alias-border-l1)',
                        background: 'transparent',
                        color: 'var(--dsw-alias-state-error-primary)',
                        fontSize: 13,
                        cursor: 'pointer',
                      },
                    },
                    t('disconnect'),
                  ),
                ),
              )
            : null,

          h(
            Card,
            null,
            h('h2', { style: { fontSize: 14, margin: '0 0 4px', fontWeight: 650 } }, t('formTitle')),
            h('p', { style: { margin: '0 0 14px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('formHint')),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              h(
                Field,
                { label: t('receipt') },
                h('textarea', {
                  value: receipt,
                  onChange: (event) => setReceipt(event.target.value),
                  rows: 4,
                  style: { ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
                }),
              ),
              h(
                'div',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: busy !== '' || receipt.trim() === '',
                    onClick: onParse,
                    style: {
                      padding: '7px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l1)',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 13,
                      cursor: 'pointer',
                    },
                  },
                  busy === 'parse' ? t('parsing') : t('parse'),
                ),
              ),
              h(
                'div',
                { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 } },
                h(
                  Field,
                  { label: t('queueUrl') },
                  h('input', {
                    value: form.queueUrl,
                    onChange: (event) => edit({ queueUrl: event.target.value }),
                    placeholder: 'https://…/publics/bound/queue/…',
                    style: inputStyle,
                    spellCheck: false,
                  }),
                ),
                h(
                  Field,
                  { label: t('agentCode') },
                  h('input', {
                    value: form.agentCode,
                    onChange: (event) => edit({ agentCode: event.target.value }),
                    style: inputStyle,
                    spellCheck: false,
                  }),
                ),
                h(
                  Field,
                  { label: t('token'), hint: connection ? t('tokenKeep') : null },
                  h('input', {
                    type: 'password',
                    value: form.token,
                    onChange: (event) => edit({ token: event.target.value }),
                    placeholder: connection ? '••••••••' : 'mpk_…',
                    style: inputStyle,
                    spellCheck: false,
                    autoComplete: 'off',
                  }),
                ),
                h(
                  Field,
                  { label: t('position') },
                  h(
                    'select',
                    { value: form.positionType, onChange: (event) => edit({ positionType: event.target.value }), style: inputStyle },
                    h('option', { value: '' }, '—'),
                    ...POSITIONS.map(([value, label]) => h('option', { key: value, value }, `${label}（${value}）`)),
                  ),
                ),
                h(
                  Field,
                  { label: t('workerId'), hint: t('workerHint') },
                  h('input', {
                    value: form.workerId,
                    onChange: (event) => edit({ workerId: event.target.value }),
                    style: inputStyle,
                    spellCheck: false,
                  }),
                ),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: busy !== '',
                    onClick: onConnect,
                    style: {
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-brand-primary)',
                      background: 'var(--dsw-alias-brand-primary)',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    },
                  },
                  busy === 'connect' ? t('saving') : t('save'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: busy !== '',
                    onClick: onTest,
                    style: {
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l1)',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 13,
                      cursor: 'pointer',
                    },
                  },
                  busy === 'test' ? t('testing') : t('test'),
                ),
                probe
                  ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, `${t('queueDepth')}: ${probe.queueDepth ?? '—'}`)
                  : null,
              ),
            ),
          ),

          h(
            Card,
            null,
            h('h2', { style: { fontSize: 14, margin: '0 0 12px', fontWeight: 650 } }, t('runs')),
            runs.length === 0
              ? h('p', { style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, t('noRuns'))
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  ...runs.map((entry) =>
                    h(
                      'div',
                      {
                        key: `${entry.runId}-${entry.finishedAt}`,
                        style: {
                          display: 'grid',
                          gridTemplateColumns: 'minmax(180px, 1fr) auto auto auto',
                          gap: 10,
                          alignItems: 'center',
                          padding: '8px 0',
                          borderTop: '1px solid var(--dsw-alias-border-l1)',
                          fontSize: 12,
                        },
                      },
                      h('code', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.runId),
                      h(
                        'span',
                        { style: { color: entry.accepted ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } },
                        entry.accepted ? t('accepted') : t('rejected'),
                      ),
                      h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, entry.runStatus ?? ''),
                      h('span', { style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'right' } }, durationText(entry.durationMs)),
                    ),
                  ),
                ),
          ),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'mota: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.effect(() => {
          const disposers = [];
          disposers.push(
            ctx.slots.register(
              {
                name: 'main',
                key: PANEL_ID,
                locale: NS,
                inject: () => ({ t }),
              },
              (props) => h(Panel, { t: props?.t ?? t }),
            ),
          );
          const dropRow = ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 30,
                label: () => t('nav'),
                locale: NS,
              },
              (owner) => h(MotaIcon, { size: owner?.size ?? 16, active: owner?.active === true }),
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
