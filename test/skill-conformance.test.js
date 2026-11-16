import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { TaskExecutor } from '../lib/executor.js';
import { buildFailureEnvelope, DISCLAIMERS } from '../lib/output.js';
import { MotaWorker } from '../lib/worker.js';

const TOKEN = 'mpk_testtoken123';

const connection = {
  token: TOKEN,
  queueUrl: 'https://queue.example.com/publics/bound/queue/q',
  agentCode: 'agent-test',
  positionType: 'FUNDAMENTAL_ANALYST',
  workerId: 'dsh-test-worker',
};

const validReply = JSON.stringify({
  payload_result: { assessments: [], summary: '无标的' },
  payload_info: '本轮没有可评估的标的。',
});

function fakeCtx({ replies = [], capture = [] } = {}) {
  let cursor = 0;
  const ctx = {
    get(name) {
      if (name === 'agents') return ctx.agents;
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) };
      }
      return undefined;
    },
    agents: {
      async create(options) {
        const events = [];
        const session = {
          get seq() { return events.length; },
          ownEvents: () => events,
        };
        options.setup?.({ systemPrompt: { section: () => {} } });
        const agent = {
          session,
          followup(message) {
            capture.push(message.content.map((b) => b.text ?? '').join('\n'));
          },
          async whenIdle() {
            const text = replies[cursor++];
            if (text === undefined) throw new Error('no reply queued');
            events.push({
              seq: events.length,
              type: 'assistant/message',
              message: { role: 'assistant', content: [{ type: 'text', text }] },
              usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 },
            });
          },
          cancel() {},
        };
        return { agent, async dispose() {} };
      },
    },
  };
  return ctx;
}

test('executor scrubs credentials and allowlists runtimeContext before the model sees them', async () => {
  const capture = [];
  const executor = new TaskExecutor({ ctx: fakeCtx({ replies: [validReply], capture }), config: { language: 'zh' }, logger: null });
  const task = {
    runId: 'run-redact',
    agentCode: 'agent-test',
    positionType: 'FUNDAMENTAL_ANALYST',
    templateInputData: [
      { name: 'access_token', value: 'sk-should-not-leak' },
      { name: 'facts', value: { api_key: 'k-should-not-leak', price: 42 } },
    ],
    runtimeContext: { accountId: 'acc-1', positions: [], password: 'p-should-not-leak', secretField: 's-should-not-leak' },
    taskBrief: `评估，注意 ${TOKEN} 不应出现`,
  };
  const { envelope } = await executor.execute({ connection, task, signal: undefined });
  assert.equal(envelope.contract_version, 'V2');
  const prompt = capture.join('\n');
  for (const secret of ['sk-should-not-leak', 'k-should-not-leak', 'p-should-not-leak', 's-should-not-leak', TOKEN]) {
    assert.equal(prompt.includes(secret), false, `prompt leaked ${secret.slice(0, 6)}…`);
  }
  assert.ok(prompt.includes('acc-1'));
  assert.ok(prompt.includes('42'));
  assert.equal(prompt.includes('secretField'), false);
});

test('executor rejects missing/null templateInputData as a contract failure', async () => {
  const executor = new TaskExecutor({ ctx: fakeCtx({ replies: [validReply] }), config: {}, logger: null });
  for (const bad of [null, undefined, 'x']) {
    await assert.rejects(
      executor.execute({ connection, task: { runId: 'r', agentCode: 'agent-test', positionType: 'FUNDAMENTAL_ANALYST', templateInputData: bad }, signal: undefined }),
      (error) => error.code === 'TASK_SHAPE_INVALID',
    );
  }
});

test('executor forwards expectedOutputFormat and targetMarkets as additive constraints', async () => {
  const capture = [];
  const executor = new TaskExecutor({ ctx: fakeCtx({ replies: [validReply], capture }), config: {}, logger: null });
  await executor.execute({
    connection,
    task: {
      runId: 'run-fmt',
      agentCode: 'agent-test',
      positionType: 'FUNDAMENTAL_ANALYST',
      templateInputData: [],
      globalParameters: { targetMarkets: ['HK', 'US'] },
      taskBrief: { expectedOutputFormat: { type: 'object', properties: { payload_result: { type: 'object' } } } },
    },
    signal: undefined,
  });
  const prompt = capture.join('\n');
  assert.ok(prompt.includes('expectedOutputFormat'));
  assert.ok(prompt.includes('HK / US'));
  assert.ok(prompt.includes('附加'));
});

test('failure envelope is honest: disclaimer appended, real usage only when measured', () => {
  const without = buildFailureEnvelope('FUNDAMENTAL_ANALYST', { language: 'zh', reason: 'TASK_SHAPE_INVALID', runId: 'run-x' });
  assert.equal('usage' in without.envelope, false);
  assert.ok(without.envelope.payload_info.endsWith(DISCLAIMERS.zh));
  assert.equal(without.envelope.contract_version, 'V2');
  assert.equal(without.validation.ok, false); // expected: platform will reject/classify

  const measured = { totalTokens: 120, promptTokens: 100, completionTokens: 20, invocationCount: 1 };
  const withUsage = buildFailureEnvelope('FUNDAMENTAL_ANALYST', { language: 'zh', reason: 'OUTPUT_CONTRACT_INVALID', runId: 'run-y', measuredUsage: measured });
  assert.equal(withUsage.envelope.usage.totalTokens, 120);
  assert.equal(withUsage.envelope.usage.estimated, false);
});

// ---- worker-level end-to-end against a fake queue -------------------------
let queue;
let queueBase;
const completed = [];
let claimsByWorker = {};
let dispatchOnce = true;

before(async () => {
  queue = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const action = url.pathname.split('/').at(-1);
    const workerId = url.searchParams.get('workerId') ?? '';
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (url.searchParams.get('token') !== TOKEN) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, code: '000002' }));
        return;
      }
      if (action === 'heartbeat') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, code: 'OK', queueDepth: 0, heartbeatIntervalSeconds: 5, selfCheckRequired: false }));
        return;
      }
      if (action === 'claim') {
        claimsByWorker[workerId] = (claimsByWorker[workerId] ?? 0) + 1;
        if (dispatchOnce && workerId === 'dsh-failure-worker') {
          dispatchOnce = false;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            code: 'OK',
            runId: 'run-fail-1',
            agentCode: 'agent-other',
            positionType: 'FUNDAMENTAL_ANALYST',
            templateInputData: [],
            leaseExpireAt: Date.now() + 300_000,
          }));
          return;
        }
        setTimeout(() => { res.writeHead(204); res.end(); }, 100);
        return;
      }
      if (action === 'complete') {
        completed.push({ runId: req.headers['x-mota-run-id'], body: JSON.parse(body || '{}') });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, code: 'OK', accepted: false, runStatus: 'RUNTIME_USAGE_MISSING', runMsg: 'classified failure' }));
        return;
      }
      if (action === 'renew') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, code: 'OK', leaseExpireAt: Date.now() + 300_000 }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((resolve) => queue.listen(0, '127.0.0.1', resolve));
  queueBase = `http://127.0.0.1:${queue.address().port}`;
});

after(() => {
  queue.closeAllConnections?.();
  queue.close();
});

test('worker completes an honest failure envelope for a failing task instead of abandoning the lease', async () => {
  const executor = new TaskExecutor({ ctx: fakeCtx({ replies: [] }), config: { language: 'zh' }, logger: null });
  const reports = [];
  const worker = new MotaWorker({
    ctx: fakeCtx({}),
    config: { allowInsecureLoopback: true, language: 'zh' },
    executor,
    logger: null,
    concurrency: 1,
    onTaskDone: (result) => reports.push(result),
  });
  await worker.start({ ...connection, queueUrl: `${queueBase}/publics/bound/queue/q-fail`, workerId: 'dsh-failure-worker' });
  const deadline = Date.now() + 8000;
  while (reports.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  await worker.stop({ reason: 'test-done' });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].failureReported, true);
  assert.equal(reports[0].accepted, false);
  const sent = completed.find((entry) => entry.runId === 'run-fail-1');
  assert.ok(sent, 'failure envelope was completed');
  assert.equal(sent.body.contract_version, 'V2');
  assert.ok(sent.body.payload_info.endsWith(DISCLAIMERS.zh));
  assert.equal('usage' in sent.body, false, 'no model ran, so no usage is manufactured');
  const status = worker.getStatus();
  assert.equal(status.runs[0].note, 'failure-reported');
  assert.ok(status.completedRunIds.includes('run-fail-1'));
});

test('claim stays disabled while the executor is not ready; heartbeat stays alive', async () => {
  const executor = new TaskExecutor({ ctx: fakeCtx({}), config: {}, logger: null });
  executor.ready = () => ({ ok: false, reason: 'no model route' });
  const worker = new MotaWorker({
    ctx: fakeCtx({}),
    config: { allowInsecureLoopback: true },
    executor,
    logger: null,
    concurrency: 1,
  });
  await worker.start({ ...connection, queueUrl: `${queueBase}/publics/bound/queue/q-notready`, workerId: 'dsh-notready-worker' });
  await new Promise((r) => setTimeout(r, 700));
  const status = worker.getStatus();
  assert.equal(status.phase, 'online');
  assert.equal(status.executorReady, false);
  assert.ok(status.message.includes('claim 未启动'));
  assert.equal(claimsByWorker['dsh-notready-worker'] ?? 0, 0);
  await worker.stop({ reason: 'test-done' });
});
