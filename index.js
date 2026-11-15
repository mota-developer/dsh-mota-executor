// dsh-mota-executor — Multi-Agent connector for MoTA Creator.
//
// One plugin instance owns a list of Agents. Each Agent has its own binding
// (Creator queue + BOUND_PULL token + Agent Code + position), its own
// concurrency, its own resident worker, and its own persisted usage counters.
// The Host serves the setup/console API at /mota; the browser half renders it.
import {
  agentKey,
  agentView,
  createAgentFromInput,
  deleteAgent as deleteAgentRecord,
  DEFAULT_CONCURRENCY,
  listAgents,
  migrateLegacyConnection,
  saveAgent,
  updateAgentFromInput,
} from './lib/agents.js';
import { ConnectionError, parseBindingText, publicConnection } from './lib/connection.js';
import { TaskExecutor } from './lib/executor.js';
import { createSetupPageHandler } from './lib/setup-page.js';
import { MotaWorker } from './lib/worker.js';

export const name = 'mota';

const MAX_LOGS_PER_AGENT = 400;

const DEFAULTS = {
  language: 'zh',
  taskTimeoutSeconds: 600,
  selfCheckTimeoutSeconds: 60,
  allowInsecureLoopback: false,
  autoStart: true,
  concurrency: DEFAULT_CONCURRENCY,
  priceInputPerMTok: 0,
  priceOutputPerMTok: 0,
  currency: 'CNY',
};

const EMPTY_STATUS = {
  phase: 'stopped',
  message: '未连接',
  queueDepth: null,
  heartbeatIntervalSeconds: null,
  lastHeartbeatAt: null,
  lastError: null,
  activeRunIds: [],
  lastResult: null,
  runs: [],
};

function stoppedStatus() {
  return { ...EMPTY_STATUS, activeRunIds: [], runs: [] };
}

function errorText(error) {
  return String(error?.message ?? error ?? '').slice(0, 500);
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) };
  const logger = ctx.logger?.(name) ?? {
    info: (...args) => console.log('[mota]', ...args),
    warn: (...args) => console.warn('[mota]', ...args),
    debug: () => {},
  };

  ctx.inject(['credentials', 'webServer'], (child) => {
    const credentials = child.get('credentials');
    const webServer = child.get('webServer');
    const executor = new TaskExecutor({ ctx, config: cfg, logger });

    /** @type {Map<string, {agent: any, worker: any, logs: any[]}>} */
    const runtimes = new Map();
    let opQueue = Promise.resolve();
    const enqueue = (task) => {
      const run = opQueue.then(task, task);
      opQueue = run.catch(() => {});
      return run;
    };

    const pricing = () => ({
      inputPerMTok: Number(cfg.priceInputPerMTok) || 0,
      outputPerMTok: Number(cfg.priceOutputPerMTok) || 0,
      currency: typeof cfg.currency === 'string' && cfg.currency ? cfg.currency : 'CNY',
    });

    function pushLog(agentId, entry) {
      const runtime = agentId ? runtimes.get(agentId) : null;
      if (!runtime) return;
      const record = {
        ts: new Date().toISOString(),
        level: entry.level ?? 'info',
        event: entry.event ?? 'log',
        message: entry.message ?? '',
        detail: entry.detail ?? null,
      };
      runtime.logs.push(record);
      if (runtime.logs.length > MAX_LOGS_PER_AGENT) runtime.logs.splice(0, runtime.logs.length - MAX_LOGS_PER_AGENT);
    }

    function allLogs() {
      const merged = [];
      for (const [agentId, runtime] of runtimes) {
        for (const log of runtime.logs) merged.push({ ...log, agentId, agentName: runtime.agent.name });
      }
      merged.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
      return merged;
    }

    function viewOf(runtime) {
      return {
        ...agentView(runtime.agent, pricing()),
        status: runtime.worker?.getStatus() ?? stoppedStatus(),
      };
    }

    function findRuntime(id) {
      const runtime = runtimes.get(String(id ?? ''));
      if (!runtime) throw new ConnectionError('id', `找不到 Agent「${id}」`);
      return runtime;
    }

    async function persistStats(runtime, result) {
      const agent = runtime.agent;
      const stats = { ...(agent.stats ?? {}) };
      const usage = result?.usage;
      if (usage) {
        stats.promptTokens = (stats.promptTokens ?? 0) + (Number(usage.promptTokens) || 0);
        stats.completionTokens = (stats.completionTokens ?? 0) + (Number(usage.completionTokens) || 0);
        stats.totalTokens = (stats.totalTokens ?? 0) + (Number(usage.totalTokens) || 0);
        stats.cachedTokens = (stats.cachedTokens ?? 0) + (Number(usage.cachedInputTokens) || 0);
        stats.reasoningTokens = (stats.reasoningTokens ?? 0) + (Number(usage.reasoningTokens) || 0);
        stats.invocations = (stats.invocations ?? 0) + (Number(usage.invocationCount) || 0);
      }
      stats.runs = (stats.runs ?? 0) + 1;
      if (result?.accepted) stats.accepted = (stats.accepted ?? 0) + 1;
      else stats.rejected = (stats.rejected ?? 0) + 1;
      runtime.agent = { ...agent, stats };
      try {
        await credentials.modifyRecord(agentKey(agent.id), async (current) => {
          const payload = current?.kind === 'grant' && current.payload && typeof current.payload === 'object'
            ? current.payload
            : runtime.agent;
          return { kind: 'grant', payload: { ...payload, stats, updatedAt: new Date().toISOString() } };
        });
      } catch (error) {
        logger.warn(`save stats for ${agent.id} failed: ${errorText(error)}`);
      }
    }

    async function stopAgent(runtime, reason) {
      if (!runtime.worker) return;
      const worker = runtime.worker;
      runtime.worker = null;
      await worker.stop({ reason }).catch((error) => logger.warn(`stop worker failed: ${errorText(error)}`));
    }

    async function startAgent(runtime) {
      if (!runtime.agent.enabled) {
        pushLog(runtime.agent.id, { level: 'info', event: 'start-skipped', message: 'Agent 已停用，未启动 Worker' });
        return;
      }
      await stopAgent(runtime, 'restart');
      const worker = new MotaWorker({
        ctx,
        config: cfg,
        executor,
        logger,
        concurrency: runtime.agent.concurrency,
        onLog: (entry) => pushLog(runtime.agent.id, entry),
        onChange: () => {},
        onTaskDone: (result) => {
          void persistStats(runtime, result).then(() => {
            pushLog(runtime.agent.id, {
              level: result?.accepted ? 'info' : 'warn',
              event: 'usage',
              message: `任务 ${result?.runId ?? ''} 用量：总计 ${result?.usage?.totalTokens ?? 0} tokens${result?.accepted ? '（已接受）' : '（未接受）'}`,
            });
          });
        },
      });
      runtime.worker = worker;
      try {
        await worker.start(runtime.agent);
      } catch (error) {
        // Keep the worker so its error phase and logs stay visible.
        throw error;
      }
    }

    async function loadRuntime(agent) {
      const runtime = { agent, worker: null, logs: [] };
      runtimes.set(agent.id, runtime);
      if (cfg.autoStart !== false && agent.enabled) {
        try {
          await startAgent(runtime);
        } catch (error) {
          logger.warn(`agent ${agent.agentCode} did not start: ${errorText(error)}`);
        }
      }
      return runtime;
    }

    async function bootstrap() {
      await migrateLegacyConnection(credentials, { allowInsecureLoopback: cfg.allowInsecureLoopback === true });
      const agents = await listAgents(credentials);
      for (const agent of agents) await loadRuntime(agent);
      if (agents.length === 0) logger.info('no MoTA agents configured yet');
    }

    const actions = {
      async state() {
        const first = [...runtimes.values()][0] ?? null;
        return {
          agents: [...runtimes.values()].map(viewOf),
          pricing: pricing(),
          config: {
            language: cfg.language,
            taskTimeoutSeconds: cfg.taskTimeoutSeconds,
            allowInsecureLoopback: cfg.allowInsecureLoopback === true,
            concurrencyLimit: 8,
          },
          // Legacy fields read by the standalone /mota page.
          connection: first ? publicConnection(first.agent) : null,
          status: first?.worker?.getStatus() ?? stoppedStatus(),
        };
      },

      async parse(text) {
        return parseBindingText(text);
      },

      async createAgent(body) {
        return enqueue(async () => {
          const agent = createAgentFromInput(body ?? {}, {
            allowInsecureLoopback: cfg.allowInsecureLoopback === true,
            existingCount: runtimes.size,
          });
          await saveAgent(credentials, agent);
          const runtime = await loadRuntime(agent);
          pushLog(agent.id, { level: 'info', event: 'agent-created', message: `已创建 Agent「${agent.name}」` });
          return { agent: viewOf(runtime) };
        });
      },

      async updateAgent(id, body) {
        return enqueue(async () => {
          const runtime = findRuntime(id);
          const next = updateAgentFromInput(runtime.agent, body ?? {}, {
            allowInsecureLoopback: cfg.allowInsecureLoopback === true,
          });
          const saved = await saveAgent(credentials, next);
          runtime.agent = saved;
          pushLog(saved.id, { level: 'info', event: 'agent-updated', message: '配置已更新' });
          const shouldRestart =
            runtime.agent.enabled &&
            (runtime.worker == null ||
              runtime.worker.concurrency !== saved.concurrency ||
              runtime.worker.connection?.queueUrl !== saved.queueUrl ||
              runtime.worker.connection?.agentCode !== saved.agentCode);
          if (!saved.enabled) {
            await stopAgent(runtime, 'disabled');
          } else if (shouldRestart) {
            try {
              await startAgent(runtime);
            } catch (error) {
              pushLog(saved.id, { level: 'error', event: 'connect-failed', message: errorText(error) });
            }
          }
          return { agent: viewOf(runtime) };
        });
      },

      async deleteAgent(id) {
        return enqueue(async () => {
          const runtime = findRuntime(id);
          await stopAgent(runtime, 'deleted');
          await deleteAgentRecord(credentials, runtime.agent.id);
          runtimes.delete(runtime.agent.id);
          return { ok: true };
        });
      },

      async agentAction(id, action) {
        return enqueue(async () => {
          const runtime = findRuntime(id);
          if (action === 'start') {
            runtime.agent = await saveAgent(credentials, { ...runtime.agent, enabled: true });
            await startAgent(runtime);
          } else if (action === 'stop') {
            runtime.agent = await saveAgent(credentials, { ...runtime.agent, enabled: false });
            await stopAgent(runtime, 'stopped');
          } else if (action === 'test') {
            const probe = await MotaWorker.probe(runtime.agent, {
              allowInsecureLoopback: cfg.allowInsecureLoopback === true,
            });
            pushLog(runtime.agent.id, {
              level: 'info',
              event: 'test',
              message: `心跳测试成功：队列深度 ${probe.queueDepth}，延迟 ${probe.latencyMs}ms`,
            });
            return { probe, agent: viewOf(runtime) };
          } else {
            throw new ConnectionError('action', `未知操作「${action}」`);
          }
          return { agent: viewOf(runtime) };
        });
      },

      async logs(query = {}) {
        const agentId = typeof query.agentId === 'string' && query.agentId !== 'all' ? query.agentId : null;
        const level = typeof query.level === 'string' && query.level !== 'all' ? query.level : null;
        const limit = Math.min(500, Math.max(1, Number(query.limit) || 200));
        let logs = allLogs();
        if (agentId) logs = logs.filter((entry) => entry.agentId === agentId);
        if (level) logs = logs.filter((entry) => entry.level === level);
        return { logs: logs.slice(0, limit), total: logs.length };
      },

      // ---- legacy single-connection routes (standalone /mota page) ----------
      async legacyState() {
        const runtime = [...runtimes.values()][0] ?? null;
        return {
          connection: runtime ? publicConnection(runtime.agent) : null,
          status: runtime?.worker?.getStatus() ?? stoppedStatus(),
          config: {
            language: cfg.language,
            taskTimeoutSeconds: cfg.taskTimeoutSeconds,
            allowInsecureLoopback: cfg.allowInsecureLoopback === true,
          },
        };
      },

      async legacyConnect(body) {
        return enqueue(async () => {
          const runtime = [...runtimes.values()][0];
          if (runtime) {
            const next = updateAgentFromInput(runtime.agent, body ?? {}, {
              allowInsecureLoopback: cfg.allowInsecureLoopback === true,
            });
            runtime.agent = await saveAgent(credentials, next);
            await startAgent(runtime).catch((error) => logger.warn(`legacy connect start failed: ${errorText(error)}`));
            return { connection: publicConnection(runtime.agent), status: runtime.worker?.getStatus() ?? stoppedStatus() };
          }
          const agent = createAgentFromInput(body ?? {}, {
            allowInsecureLoopback: cfg.allowInsecureLoopback === true,
            existingCount: 0,
          });
          await saveAgent(credentials, agent);
          const created = await loadRuntime(agent);
          return { connection: publicConnection(created.agent), status: created.worker?.getStatus() ?? stoppedStatus() };
        });
      },

      async legacyTest(body) {
        const runtime = [...runtimes.values()][0];
        const agent = runtime
          ? updateAgentFromInput(runtime.agent, body ?? {}, { allowInsecureLoopback: cfg.allowInsecureLoopback === true })
          : createAgentFromInput(body ?? {}, { allowInsecureLoopback: cfg.allowInsecureLoopback === true, existingCount: 0 });
        const probe = await MotaWorker.probe(agent, { allowInsecureLoopback: cfg.allowInsecureLoopback === true });
        return { probe };
      },

      async legacyDisconnect() {
        return enqueue(async () => {
          const runtime = [...runtimes.values()][0];
          if (runtime) {
            await stopAgent(runtime, 'disconnect');
            await deleteAgentRecord(credentials, runtime.agent.id);
            runtimes.delete(runtime.agent.id);
          }
          return { connection: null, status: stoppedStatus() };
        });
      },
    };

    child.effect(() => {
      const disposers = [
        webServer.register({ kind: 'prefix', path: '/mota', handler: createSetupPageHandler({ actions }) }),
      ];
      return async () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            // best effort
          }
        }
        await Promise.allSettled([...runtimes.values()].map((runtime) => stopAgent(runtime, 'plugin-disposed')));
      };
    });

    void enqueue(bootstrap).catch((error) => logger.warn(`bootstrap failed: ${errorText(error)}`));
  });
}
