import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { apply } from '../index.js';
import { AGENT_KEY_PREFIX } from '../lib/agents.js';

const TOKEN = 'mpk_testtoken123';
const QUEUE_PATH = '/publics/bound/queue/q-plugin';

let queueServer;
let queueBase;
let pluginServer;
let pluginBase;
let store;
let routes;
let disposers = [];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

before(async () => {
  queueServer = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const action = url.pathname.split('/').at(-1);
    req.resume();
    req.on('end', () => {
      if (url.searchParams.get('token') !== TOKEN) return json(res, 200, { success: false, code: '000002', message: '参数错误' });
      if (action === 'heartbeat') {
        return json(res, 200, { success: true, code: 'OK', queueDepth: 0, heartbeatIntervalSeconds: 5, selfCheckRequired: false });
      }
      if (action === 'claim') {
        // emulate the 30s long poll with a short hold, then an empty queue
        setTimeout(() => {
          res.writeHead(204);
          res.end();
        }, 150);
        return;
      }
      return json(res, 404, { success: false, code: 'NOT_FOUND' });
    });
  });
  await new Promise((resolve) => queueServer.listen(0, '127.0.0.1', resolve));
  queueBase = `http://127.0.0.1:${queueServer.address().port}`;

  // The fake Host: only the services index.js asks for via ctx.inject.
  store = new Map();
  routes = [];
  const credentials = {
    async readRecord(key) {
      return store.get(key) ?? null;
    },
    async modifyRecord(key, mutate) {
      const next = await mutate(store.get(key) ?? null);
      store.set(key, next);
      return next;
    },
    async deleteRecord(key) {
      store.delete(key);
    },
    async listRecords() {
      return [...store.keys()].map((key) => ({ key }));
    },
  };
  const webServer = {
    register(route) {
      routes.push(route);
      return () => {};
    },
  };
  const services = { credentials, webServer };
  const childCtx = {
    get: (name) => services[name],
    on: () => () => {},
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => {};
    },
  };
  const ctx = {
    logger: () => ({ info() {}, warn() {}, debug() {} }),
    get: (name) => services[name],
    inject: (_deps, callback) => callback(childCtx),
  };
  apply(ctx, { allowInsecureLoopback: true, language: 'zh', taskTimeoutSeconds: 30 });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, '/mota');

  pluginServer = createServer((req, res) => routes[0].handler(req, res));
  await new Promise((resolve) => pluginServer.listen(0, '127.0.0.1', resolve));
  pluginBase = `http://127.0.0.1:${pluginServer.address().port}`;
});

after(async () => {
  for (const dispose of disposers ?? []) {
    try {
      await dispose();
    } catch {
      // best effort: tests still close the servers below
    }
  }
  pluginServer.closeAllConnections?.();
  queueServer.closeAllConnections?.();
  pluginServer.close();
  queueServer.close();
});

async function api(path, body, method) {
  const res = await fetch(`${pluginBase}${path}`, body === undefined && method === undefined ? {} : {
    method: method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function bindingReceipt() {
  return `接入方式：绑定式（BOUND_PULL）
Agent Code：agent-test
Queue 地址：${queueBase}${QUEUE_PATH}
Agent Token：${TOKEN}
岗位：基本面分析师（FUNDAMENTAL_ANALYST）`;
}

test('serves the setup page on /mota', async () => {
  const res = await fetch(`${pluginBase}/mota`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /MoTA 5 Agent/);
  assert.match(html, /保存并连接/);
});

test('reports an empty state before any connection exists', async () => {
  const { status, data } = await api('/mota/api/state');
  assert.equal(status, 200);
  assert.equal(data.connection, null);
  assert.equal(data.status.phase, 'stopped');
  assert.deepEqual(data.agents, []);
});

test('parses a pasted binding receipt into connect fields', async () => {
  const { data } = await api('/mota/api/parse', { text: bindingReceipt() });
  assert.equal(data.found.token, TOKEN);
  assert.equal(data.found.queueUrl, `${queueBase}${QUEUE_PATH}`);
  assert.equal(data.found.agentCode, 'agent-test');
  assert.equal(data.found.positionType, 'FUNDAMENTAL_ANALYST');
  assert.deepEqual(data.missing, []);
});

test('rejects a token that is not a BOUND_PULL mpk_ credential', async () => {
  const { status, data } = await api('/mota/api/connect', {
    token: 'sk-not-a-mota-token',
    queueUrl: `${queueBase}${QUEUE_PATH}`,
    agentCode: 'agent-test',
    positionType: 'FUNDAMENTAL_ANALYST',
  });
  assert.equal(status, 400);
  assert.match(data.error, /mpk_/);
});

test('connects against the queue, stores one credentials record, and goes online', async () => {
  const { data } = await api('/mota/api/connect', {
    token: TOKEN,
    queueUrl: `${queueBase}${QUEUE_PATH}`,
    agentCode: 'agent-test',
    positionType: 'FUNDAMENTAL_ANALYST',
  });
  assert.equal(data.connection.agentCode, 'agent-test');
  assert.equal(data.connection.tokenMasked.includes(TOKEN), false);
  assert.equal(data.status.phase, 'online');

  const agentKeys = [...store.keys()].filter((key) => key.startsWith(AGENT_KEY_PREFIX));
  assert.equal(agentKeys.length, 1);
  const record = store.get(agentKeys[0]);
  assert.equal(record.kind, 'grant');
  assert.equal(record.payload.token, TOKEN);
  assert.equal(record.payload.positionType, 'FUNDAMENTAL_ANALYST');

  const state = await api('/mota/api/state');
  assert.equal(state.data.agents.length, 1);
  assert.equal(state.data.agents[0].status.phase, 'online');
  assert.equal(state.data.agents[0].status.queueDepth, 0);
});

test('test-connection performs a heartbeat without restarting the worker', async () => {
  const { data } = await api('/mota/api/test', {
    queueUrl: `${queueBase}${QUEUE_PATH}`,
    agentCode: 'agent-test',
    positionType: 'FUNDAMENTAL_ANALYST',
  });
  assert.equal(data.probe.queueDepth, 0);
  assert.equal(data.probe.heartbeatIntervalSeconds, 5);
});

test('disconnect clears the credentials record and stops the worker', async () => {
  const { data } = await api('/mota/api/disconnect', {});
  assert.equal(data.connection, null);
  assert.equal([...store.keys()].filter((key) => key.startsWith(AGENT_KEY_PREFIX)).length, 0);
  const state = await api('/mota/api/state');
  assert.equal(state.data.status.phase, 'stopped');
  assert.deepEqual(state.data.agents, []);
});

test('creates, lists, updates, logs and deletes multiple Agents', async () => {
  const base = {
    token: TOKEN,
    queueUrl: `${queueBase}${QUEUE_PATH}`,
    agentCode: 'agent-a',
    positionType: 'FUNDAMENTAL_ANALYST',
    concurrency: 2,
  };
  const first = await api('/mota/api/agents', base);
  assert.equal(first.status, 200);
  assert.equal(first.data.agent.name, 'agent-a');
  assert.equal(first.data.agent.concurrency, 2);
  assert.equal(first.data.agent.tokenMasked.includes(TOKEN), false);

  const second = await api('/mota/api/agents', { ...base, agentCode: 'agent-b', name: '研究二号', positionType: 'STRATEGIST' });
  assert.equal(second.status, 200);
  assert.equal(second.data.agent.name, '研究二号');

  const state = await api('/mota/api/state');
  assert.equal(state.data.agents.length, 2);
  const ids = state.data.agents.map((agent) => agent.id);
  assert.equal(new Set(ids).size, 2);

  const patched = await api(`/mota/api/agents/${first.data.agent.id}`, { concurrency: 3, name: '基本面一号' }, 'PATCH');
  assert.equal(patched.status, 200);
  assert.equal(patched.data.agent.concurrency, 3);
  assert.equal(patched.data.agent.name, '基本面一号');

  const logs = await api(`/mota/api/logs?agentId=${first.data.agent.id}&level=all`);
  assert.equal(logs.status, 200);
  assert.ok(Array.isArray(logs.data.logs));
  assert.ok(logs.data.logs.length >= 1);
  assert.ok(logs.data.logs.every((entry) => entry.agentId === first.data.agent.id));

  const removed = await api(`/mota/api/agents/${second.data.agent.id}`, undefined, 'DELETE');
  assert.equal(removed.status, 200);
  const afterDelete = await api('/mota/api/state');
  assert.equal(afterDelete.data.agents.length, 1);
});
