import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskExecutor } from '../lib/executor.js';
import { validateCompletion } from '../lib/schema.js';

const connection = {
  token: 'mpk_testtoken123',
  queueUrl: 'https://queue.example.com/publics/bound/queue/q',
  agentCode: 'agent-test',
  positionType: 'FUNDAMENTAL_ANALYST',
  workerId: 'dsh-test-worker',
};

const task = {
  schemaVersion: '1.0',
  runId: 'run-1',
  agentCode: 'agent-test',
  positionType: 'FUNDAMENTAL_ANALYST',
  templateInputData: [],
  taskBrief: '评估 AAPL',
};

const validReply = JSON.stringify({
  payload_result: { assessments: [], summary: '无标的' },
  payload_info: '本轮没有可评估的标的，已按失败路径返回空数组。',
});

/**
 * A fake DSH host: `agents.create` hands back an agent whose replies are the
 * queued strings, emitting assistant/message events with fixed usage the same
 * way the real session event firehose does.
 */
function fakeCtx({ replies, usageFor = () => ({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 }) }) {
  let cursor = 0;
  const emitted = [];
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
        const sections = [];
        const events = [];
        const session = {
          get seq() { return events.length; },
          ownEvents: () => events,
        };
        const childCtx = {
          systemPrompt: { section: (section) => sections.push(section) },
        };
        options.setup?.(childCtx);
        const agent = {
          session,
          followup() {},
          async whenIdle() {
            const text = replies[cursor++];
            const event = {
              seq: events.length,
              type: 'assistant/message',
              message: { role: 'assistant', content: [{ type: 'text', text }] },
              usage: usageFor(text),
            };
            events.push(event);
            emitted.push(event);
          },
          cancel() {},
        };
        return { agent, async dispose() {} };
      },
    },
  };
  return { ctx, emitted };
}

function executorFor(host, config = {}) {
  return new TaskExecutor({
    ctx: host.ctx,
    config: { language: 'zh', taskTimeoutSeconds: 30, ...config },
    logger: { warn() {} },
  });
}

test('executes one turn and returns a validated envelope with measured usage', async () => {
  const host = fakeCtx({ replies: [validReply] });
  const executor = executorFor(host);
  const result = await executor.execute({ connection, task });
  assert.equal(validateCompletion('FUNDAMENTAL_ANALYST', result.envelope).ok, true);
  assert.equal(result.usage.totalTokens, 130);
  assert.equal(result.usage.promptTokens, 110);
  assert.equal(result.usage.completionTokens, 20);
  assert.equal(result.usage.cachedInputTokens, 10);
  assert.equal(result.usage.invocationCount, 1);
});

test('repairs a non-JSON reply with the contract problems as the next prompt', async () => {
  const host = fakeCtx({ replies: ['我先想一想。', validReply] });
  const executor = executorFor(host);
  const result = await executor.execute({ connection, task });
  assert.equal(validateCompletion('FUNDAMENTAL_ANALYST', result.envelope).ok, true);
  assert.equal(result.usage.invocationCount, 2);
});

test('fails the task when the provider reports no usage instead of inventing one', async () => {
  const host = fakeCtx({ replies: [validReply, validReply, validReply, validReply], usageFor: () => undefined });
  const executor = executorFor(host);
  await assert.rejects(() => executor.execute({ connection, task }), /RUNTIME_USAGE_MISSING/);
});

test('rejects a task whose positionType does not match the registered role', async () => {
  const host = fakeCtx({ replies: [validReply] });
  const executor = executorFor(host);
  await assert.rejects(
    () => executor.execute({ connection, task: { ...task, positionType: 'NOT_A_ROLE' } }),
    /未注册的 positionType/,
  );
});

test('rejects a task whose agentCode does not match the connection', async () => {
  const host = fakeCtx({ replies: [validReply] });
  const executor = executorFor(host);
  await assert.rejects(
    () => executor.execute({ connection, task: { ...task, agentCode: 'someone-else' } }),
    /不一致/,
  );
});

test('stops after MAX_REPAIR_ROUNDS invalid generations and leaves the task unreturned', async () => {
  const host = fakeCtx({ replies: ['nope', 'nope', 'nope', 'nope', 'nope'] });
  const executor = executorFor(host);
  await assert.rejects(() => executor.execute({ connection, task }), /不是合法 JSON/);
});

test('probe reports a failed self check instead of throwing', async () => {
  const host = fakeCtx({ replies: [validReply] });
  const executor = executorFor(host);
  const result = await executor.probe({ timeoutMs: 5_000 });
  assert.equal(typeof result.pass, 'boolean');
  assert.equal(typeof result.latencyMs, 'number');
});
