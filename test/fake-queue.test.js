import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { PullTransport, WorkerStopped, assertQueueUrl } from '../lib/transport.js';
import { assembleCompletion } from '../lib/output.js';

const TOKEN = 'mpk_testtoken123';
const QUEUE_PATH = '/publics/bound/queue/q-test';
const RUN_ID = 'run-test-1';

const usage = { totalTokens: 64, promptTokens: 50, completionTokens: 14, invocationCount: 1 };

function envelope() {
  return assembleCompletion(
    'FUNDAMENTAL_ANALYST',
    { payload_result: { assessments: [] }, payload_info: '假队列端到端测试。' },
    usage,
  );
}

function task() {
  return {
    schemaVersion: '1.0',
    runId: RUN_ID,
    agentCode: 'agent-test',
    positionType: 'FUNDAMENTAL_ANALYST',
    templateInputData: [],
    taskBrief: '假队列任务',
    leaseExpireAt: Date.now() + 300_000,
  };
}

let server;
let base;
const state = {
  heartbeatCalls: [],
  completeBodies: [],
  renewHeaders: [],
  claimCount: 0,
  failCompleteOnce: false,
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/');
    const action = parts.at(-1);
    const token = url.searchParams.get('token');
    const workerId = url.searchParams.get('workerId');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (url.pathname === '/creator/bound/skill') {
        return token === TOKEN ? json(res, 200, { success: true, code: 'OK' }) : json(res, 401, { success: false, code: 'AGENT_TOKEN_UNAUTHORIZED' });
      }
      if (!url.pathname.startsWith(QUEUE_PATH)) return json(res, 404, { success: false, code: 'NOT_FOUND' });
      if (token !== TOKEN) return json(res, 200, { success: false, code: '000002', message: '参数错误' });

      if (action === 'heartbeat') {
        state.heartbeatCalls.push({ workerId, body: raw });
        return json(res, 200, {
          success: true,
          code: 'OK',
          queueDepth: 0,
          heartbeatIntervalSeconds: 5,
          selfCheckRequired: false,
        });
      }
      if (action === 'claim') {
        state.claimCount += 1;
        if (state.claimCount === 1) return json(res, 200, task());
        res.writeHead(204);
        return res.end();
      }
      if (action === 'renew') {
        state.renewHeaders.push(req.headers['x-mota-run-id']);
        if (req.headers['x-mota-run-id'] !== RUN_ID) return json(res, 409, { success: false, code: 'BOUND_CLAIM_CONFLICT' });
        return json(res, 200, { success: true, code: 'OK', leaseExpireAt: Date.now() + 300_000 });
      }
      if (action === 'complete') {
        state.completeBodies.push({ raw, runId: req.headers['x-mota-run-id'], workerId });
        if (state.failCompleteOnce) {
          state.failCompleteOnce = false;
          return json(res, 503, { success: false, code: 'SERVER_BUSY' });
        }
        return json(res, 200, { success: true, code: 'OK', accepted: true, runStatus: 'ACCEPTED' });
      }
      return json(res, 404, { success: false, code: 'NOT_FOUND' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

function transport() {
  return new PullTransport({
    queueUrl: `${base}${QUEUE_PATH}`,
    token: TOKEN,
    workerId: 'dsh-test-worker',
    allowInsecureLoopback: true,
  });
}

test('assertQueueUrl requires https unless the loopback escape hatch is enabled', () => {
  assert.throws(() => assertQueueUrl('http://127.0.0.1:19100/publics/bound/queue/q'), /https/);
  assert.equal(assertQueueUrl('https://queue.example.com/publics/bound/queue/q').queueId, 'q');
  assert.equal(assertQueueUrl(`${base}${QUEUE_PATH}`, { allowInsecureLoopback: true }).queueId, 'q-test');
  assert.throws(() => assertQueueUrl('https://queue.example.com/somewhere/else'), /publics\/bound\/queue/);
  assert.throws(() => assertQueueUrl('https://queue.example.com/publics/bound/queue/q?token=x'), /query/);
});

test('heartbeat sends workerId as a query parameter and validates queueDepth', async () => {
  const reply = await transport().heartbeat();
  assert.equal(reply.queueDepth, 0);
  assert.equal(reply.heartbeatIntervalSeconds, 5);
  assert.equal(state.heartbeatCalls.at(-1).workerId, 'dsh-test-worker');
});

test('claim long-polls: task on 200, null on 204', async () => {
  const t = transport();
  const claimed = await t.claim();
  assert.equal(claimed.runId, RUN_ID);
  assert.ok(Array.isArray(claimed.templateInputData));
  assert.equal(await t.claim(), null);
});

test('renew sends X-MoTA-Run-ID and keeps the claim workerId', async () => {
  const t = transport();
  const reply = await t.renew(RUN_ID);
  assert.ok(reply.leaseExpireAt > Date.now());
  assert.equal(state.renewHeaders.at(-1), RUN_ID);
});

test('complete carries runId in the header only and the four-key envelope in the body', async () => {
  const t = transport();
  const body = envelope();
  const receipt = await t.complete(RUN_ID, body);
  assert.equal(receipt.accepted, true);
  const sent = state.completeBodies.at(-1);
  assert.equal(sent.runId, RUN_ID);
  assert.equal(sent.workerId, null);
  const parsed = JSON.parse(sent.raw);
  assert.deepEqual(Object.keys(parsed).sort(), ['contract_version', 'payload_info', 'payload_result', 'usage']);
  assert.equal('runId' in parsed, false);
});

test('complete retries with byte-identical bytes after a retryable 5xx', async () => {
  const t = transport();
  state.failCompleteOnce = true;
  const before = state.completeBodies.length;
  const receipt = await t.complete(RUN_ID, envelope(), { maxAttempts: 3 });
  assert.equal(receipt.accepted, true);
  const attempts = state.completeBodies.slice(before);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].raw, attempts[1].raw);
});

test('a missing token is a parameter error (000002), not an empty queue', async () => {
  const t = new PullTransport({
    queueUrl: `${base}${QUEUE_PATH}`,
    token: 'mpk_wrongtoken',
    workerId: 'dsh-test-worker',
    allowInsecureLoopback: true,
  });
  await assert.rejects(() => t.heartbeat(), (error) => {
    assert.ok(error instanceof WorkerStopped);
    assert.equal(error.code, '000002');
    return true;
  });
});
