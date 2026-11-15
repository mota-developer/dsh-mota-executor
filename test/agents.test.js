import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentKey,
  agentView,
  AGENT_KEY_PREFIX,
  createAgentFromInput,
  deleteAgent,
  LEGACY_CONNECTION_KEY,
  listAgents,
  migrateLegacyConnection,
  saveAgent,
  updateAgentFromInput,
} from '../lib/agents.js';

const TOKEN = 'mpk_testtoken123';
const QUEUE = 'http://127.0.0.1:59999/publics/bound/queue/q-test';

function fakeCredentials() {
  const store = new Map();
  return {
    store,
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
}

function input(overrides = {}) {
  return {
    token: TOKEN,
    queueUrl: QUEUE,
    agentCode: 'agent-test',
    positionType: 'FUNDAMENTAL_ANALYST',
    ...overrides,
  };
}

test('createAgentFromInput validates the binding and fills defaults', () => {
  const agent = createAgentFromInput(input({ concurrency: 99 }), { allowInsecureLoopback: true });
  assert.equal(agent.name, 'agent-test');
  assert.equal(agent.concurrency, 8);
  assert.equal(agent.enabled, true);
  assert.equal(agent.stats.totalTokens, 0);
  assert.throws(() => createAgentFromInput(input({ token: 'sk-nope' }), { allowInsecureLoopback: true }), /mpk_/);
});

test('saves, lists and deletes Agent records', async () => {
  const credentials = fakeCredentials();
  const first = createAgentFromInput(input(), { allowInsecureLoopback: true });
  const second = createAgentFromInput(input({ agentCode: 'agent-b', name: '二号' }), { allowInsecureLoopback: true });
  await saveAgent(credentials, first);
  await saveAgent(credentials, second);
  assert.ok(credentials.store.has(agentKey(first.id)));

  const agents = await listAgents(credentials);
  assert.equal(agents.length, 2);
  assert.deepEqual(agents.map((agent) => agent.agentCode).sort(), ['agent-b', 'agent-test']);

  await deleteAgent(credentials, first.id);
  assert.equal((await listAgents(credentials)).length, 1);
  assert.equal([...credentials.store.keys()].every((key) => key.startsWith(AGENT_KEY_PREFIX)), true);
});

test('updateAgentFromInput keeps the stored token for a blank edit', async () => {
  const credentials = fakeCredentials();
  const agent = createAgentFromInput(input(), { allowInsecureLoopback: true });
  await saveAgent(credentials, agent);

  const updated = updateAgentFromInput(
    agent,
    { token: '', queueUrl: QUEUE, agentCode: 'agent-test', positionType: 'STRATEGIST', concurrency: 3, name: '策略' },
    { allowInsecureLoopback: true },
  );
  assert.equal(updated.token, TOKEN);
  assert.equal(updated.positionType, 'STRATEGIST');
  assert.equal(updated.concurrency, 3);
  assert.equal(updated.name, '策略');

  await saveAgent(credentials, updated);
  const [reread] = await listAgents(credentials);
  assert.equal(reread.positionType, 'STRATEGIST');
  assert.equal(reread.concurrency, 3);
});

test('agentView masks the token and derives cost from pricing', async () => {
  const agent = createAgentFromInput(input(), { allowInsecureLoopback: true });
  agent.stats = { ...agent.stats, promptTokens: 1_000_000, completionTokens: 500_000, totalTokens: 1_500_000, runs: 2, accepted: 2 };

  const free = agentView(agent, { inputPerMTok: 0, outputPerMTok: 0, currency: 'CNY' });
  assert.equal(free.tokenMasked.includes(TOKEN), false);
  assert.equal(free.stats.cost.configured, false);

  const priced = agentView(agent, { inputPerMTok: 1, outputPerMTok: 2, currency: 'CNY' });
  assert.equal(priced.stats.cost.configured, true);
  assert.equal(priced.stats.cost.amount, 2);
  assert.equal(priced.stats.cost.currency, 'CNY');
  assert.equal(priced.positionLabel, '基本面分析师');
});

test('migrates the legacy single-connection record once', async () => {
  const credentials = fakeCredentials();
  credentials.store.set(LEGACY_CONNECTION_KEY, {
    kind: 'grant',
    payload: {
      token: TOKEN,
      queueUrl: QUEUE,
      agentCode: 'legacy-agent',
      positionType: 'RISK_MANAGER',
      workerId: 'dsh-legacy-worker',
      savedAt: '2026-11-15T10:00:00.000Z',
    },
  });

  const migrated = await migrateLegacyConnection(credentials, { allowInsecureLoopback: true });
  assert.equal(migrated.agentCode, 'legacy-agent');
  assert.equal(migrated.workerId, 'dsh-legacy-worker');
  assert.equal(migrated.concurrency, 1);
  assert.equal(credentials.store.has(LEGACY_CONNECTION_KEY), false);
  assert.equal((await listAgents(credentials)).length, 1);

  // A second run is a no-op: the legacy record is gone.
  assert.equal(await migrateLegacyConnection(credentials), null);
});
