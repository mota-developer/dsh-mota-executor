// Execute one claimed MoTA task with a fresh child DSH Agent.
//
// One agent per task, one turn per generation, at most MAX_REPAIR_ROUNDS
// repair generations (runtime-adapter.md). Usage is measured from
// `assistant/message` session events of the child session; it is never
// synthesized. Nothing here writes to the session of the user who installed
// the plugin — the child session is its own isolated session.
import { randomUUID } from 'node:crypto';
import { POSITION_TO_SCHEMA, validateCompletion } from './schema.js';
import { buildRepairMessage, buildSystemPrompt, buildTaskMessage, SELF_CHECK_PROMPT } from './prompt.js';
import { assembleCompletion, OutputContractError, parseAgentJson } from './output.js';
import { allowRuntimeContext, scrubTask } from './redact.js';

export const MAX_REPAIR_ROUNDS = 3;

function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'mota' },
  };
}

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

export class TaskExecutor {
  constructor({ ctx, config, logger }) {
    this.ctx = ctx;
    this.config = config;
    this.logger = logger;
  }

  #modelOptions() {
    if (this.config.provider && this.config.model) {
      return {
        provider: this.config.provider,
        model: this.config.model,
        ...(this.config.reasoningEffort ? { reasoningEffort: this.config.reasoningEffort } : {}),
      };
    }
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.();
    if (selection?.provider && selection?.model) {
      return {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
      };
    }
    throw new Error('未找到可用的模型路由：请在插件配置里设置 provider/model，或先设置 DSH 的默认模型');
  }

  async #openAgent({ signal, systemPrompt }) {
    const agents = this.ctx.get('agents');
    if (!agents?.create) {
      throw new Error('DSH agents 服务不可用，无法创建执行任务的子 Agent');
    }
    const sessionId = randomUUID();
    return agents.create({
      sessionId,
      meta: { origin: 'subagent', delegationDepth: 1 },
      agentOptions: this.#modelOptions(),
      signal,
      setup: (childCtx) => {
        childCtx.systemPrompt.section({ name: 'mota-role-contract', order: 10_000, text: systemPrompt });
      },
    });
  }

  /**
   * Read the child session log — the source of truth — for assistant messages
   * produced since `startSeq`. This does not depend on event-listener delivery,
   * so a missed subscription can never turn real usage into "no usage".
   */
  #collect(agent, startSeq) {
    const session = agent?.session;
    const events = typeof session?.ownEvents === 'function' ? session.ownEvents() : [];
    return events.filter((event) => (
      event
      && event.type === 'assistant/message'
      && typeof event.seq === 'number'
      && event.seq >= startSeq
    ));
  }

  #usageMeter() {
    const meter = {
      invocations: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      hasAny: false,
    };
    return {
      meter,
      seen: new Set(),
      add(event) {
        if (event.type !== 'assistant/message' || !event.usage) return;
        if (typeof event.seq === 'number') {
          if (this.seen.has(event.seq)) return;
          this.seen.add(event.seq);
        }
        const u = event.usage;
        meter.invocations += 1;
        meter.hasAny = true;
        meter.input += Number.isFinite(u.inputTokens) ? u.inputTokens : 0;
        meter.output += Number.isFinite(u.outputTokens) ? u.outputTokens : 0;
        meter.cacheRead += Number.isFinite(u.cacheReadTokens) ? u.cacheReadTokens : 0;
        meter.cacheWrite += Number.isFinite(u.cacheWriteTokens) ? u.cacheWriteTokens : 0;
        meter.reasoning += Number.isFinite(u.reasoningTokens) ? u.reasoningTokens : 0;
      },
      measured() {
        if (!meter.hasAny) return undefined;
        const promptTokens = meter.input + meter.cacheRead + meter.cacheWrite;
        return {
          totalTokens: promptTokens + meter.output,
          promptTokens,
          completionTokens: meter.output,
          ...(meter.cacheRead + meter.cacheWrite > 0 ? { cachedInputTokens: meter.cacheRead + meter.cacheWrite } : {}),
          ...(meter.reasoning > 0 ? { reasoningTokens: meter.reasoning } : {}),
          invocationCount: meter.invocations,
        };
      },
    };
  }

  /**
   * Run one turn on the child agent and return the assistant messages it
   * produced, read back from the session log.
   */
  async #turn(agent, text, { timeoutMs, signal }) {
    const startSeq = agent.session?.seq ?? 0;
    let timer;
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => {
        agent.cancel({ kind: 'hook', reason: 'mota-cancelled' });
        reject(new Error('LEASE_LOST_OR_CANCELLED'));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        agent.cancel({ kind: 'hook', reason: 'mota-task-timeout' });
        reject(new Error('TASK_TIMEOUT'));
      }, timeoutMs);
    });
    // A losing race must not surface as an unhandled rejection.
    aborted.catch(() => {});
    try {
      agent.followup(userMessage(text));
      await Promise.race([agent.whenIdle(), aborted]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
    return this.#collect(agent, startSeq);
  }

  /**
   * Execute a claimed task. Resolves {envelope, business, usage}; throws on
   * anything that must leave the task unreturned (lease loss, no real usage,
   * contract violations surviving every repair round).
   */
  /** Executor readiness gate: claim must stay disabled until this passes. */
  ready() {
    const agents = this.ctx.get('agents');
    if (!agents?.create) return { ok: false, reason: 'DSH agents 服务不可用' };
    try {
      this.#modelOptions();
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    }
    return { ok: true, reason: null };
  }

  async execute({ connection, task, signal }) {
    const positionType = task.positionType ?? connection.positionType;
    if (!POSITION_TO_SCHEMA[positionType]) {
      const error = new Error(`任务携带未注册的 positionType：${positionType}`);
      error.code = 'TASK_IDENTITY_INVALID';
      throw error;
    }
    if (task.agentCode && task.agentCode !== connection.agentCode) {
      const error = new Error(`任务 agentCode（${task.agentCode}）与当前连接（${connection.agentCode}）不一致`);
      error.code = 'TASK_IDENTITY_INVALID';
      throw error;
    }
    // runtime-adapter.md: the current task's templateInputData is a required
    // array (often []); missing/null is a contract failure, never coerced.
    if (!Array.isArray(task.templateInputData)) {
      const error = new Error('templateInputData 缺失或不是数组（当前任务契约要求数组，常为 []）');
      error.code = 'TASK_SHAPE_INVALID';
      throw error;
    }
    const language = this.config.language === 'en' ? 'en' : 'zh';
    const systemPrompt = buildSystemPrompt(positionType, { language });
    // Credential redaction + runtimeContext allowlist, wired per the official
    // taskForExecutor helper; the worker token is scrubbed defensively.
    const safeTask = scrubTask(task, [connection.token]);
    safeTask.runtimeContext = allowRuntimeContext(safeTask.runtimeContext);
    const boundedTask = buildTaskMessage({
      task: { ...safeTask, positionType },
      connection,
      language,
    });

    const replies = [];
    const usage = this.#usageMeter();
    let handle;
    try {
      handle = await this.#openAgent({ signal, systemPrompt });
      const agent = handle.agent;
      const timeoutMs = Math.max(30, this.config.taskTimeoutSeconds ?? 600) * 1000;
      let prompt = boundedTask;
      let lastProblems = [];
      for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
        if (round > 0) prompt = buildRepairMessage(lastProblems);
        const before = replies.length;
        const produced = await this.#turn(agent, prompt, { timeoutMs, signal });
        for (const event of produced) {
          usage.add(event);
          const text = textOf(event.message);
          if (text.trim() !== '') replies.push(text);
        }
        const fresh = replies.slice(before);
        if (fresh.length === 0) {
          throw new Error('模型本轮没有产生任何回复（可能是上游 LLM 错误），任务未回传');
        }
        const reply = fresh[fresh.length - 1];
        let business;
        try {
          business = parseAgentJson(reply);
        } catch (error) {
          lastProblems = error.problems ?? [error.message];
          if (round === MAX_REPAIR_ROUNDS) throw error;
          continue;
        }
        try {
          const envelope = assembleCompletion(positionType, business, usage.measured(), language);
          return { envelope, business, usage: envelope.usage };
        } catch (error) {
          if (!(error instanceof OutputContractError)) throw error;
          lastProblems = error.problems;
          if (round === MAX_REPAIR_ROUNDS) {
            throw new OutputContractError(lastProblems);
          }
        }
      }
      throw new OutputContractError(lastProblems.length ? lastProblems : ['未得到可接受的结果']);
    } catch (error) {
      // Failure reporting still owes the platform every real measured token.
      if (error && typeof error === 'object') error.usage = usage.measured();
      throw error;
    } finally {
      if (handle) {
        await handle.dispose().catch((error) => this.logger?.warn?.(`dispose child agent failed: ${error?.message ?? error}`));
      }
    }
  }

  /** Shortest real end-to-end self check required by the heartbeat protocol. */
  async probe({ signal, timeoutMs = 60_000 }) {
    const started = Date.now();
    let handle;
    try {
      handle = await this.#openAgent({
        signal,
        systemPrompt: '你只做连通性自检：不要调用任何工具，只按用户要求回复。',
      });
      const agent = handle.agent;
      await this.#turn(agent, SELF_CHECK_PROMPT, { timeoutMs, signal });
      const ok = true;
      return { pass: ok, latencyMs: Date.now() - started, error: null };
    } catch (error) {
      return { pass: false, latencyMs: Date.now() - started, error: String(error?.message ?? error).slice(0, 300) };
    } finally {
      if (handle) await handle.dispose().catch(() => {});
    }
  }
}
