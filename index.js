// dsh-mota-executor — connect this DeepSeek Harness agent to MoTA Creator as a
// bound Pull worker, using the BOUND_PULL Agent Token from Creator.
//
// Runtime shape: the plugin serves its own setup page on the DSH web server
// (/mota), stores the whole binding in one credentials record, and keeps one
// resident worker alive: heartbeat loop + claim loop + lease renewal, with a
// fresh child Agent per claimed task.
import {
  clearConnection,
  CONNECTION_KEY,
  ConnectionError,
  normalizeConnection,
  parseBindingText,
  publicConnection,
  readConnection,
  writeConnection,
} from './lib/connection.js';
import { TaskExecutor } from './lib/executor.js';
import { createSetupPageHandler } from './lib/setup-page.js';
import { MotaWorker } from './lib/worker.js';

export const name = 'mota';

const DEFAULTS = {
  language: 'zh',
  taskTimeoutSeconds: 600,
  selfCheckTimeoutSeconds: 60,
  allowInsecureLoopback: false,
  autoStart: true,
};

function stoppedStatus() {
  return { phase: 'stopped', message: '未连接', runs: [] };
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

    let worker = null;
    let connection = null;
    let opQueue = Promise.resolve();
    const enqueue = (task) => {
      const run = opQueue.then(task, task);
      opQueue = run.catch(() => {});
      return run;
    };

    const status = () => worker?.getStatus() ?? stoppedStatus();

    async function stopWorker(reason) {
      if (!worker) return;
      const previous = worker;
      worker = null;
      await previous.stop({ reason }).catch((error) => logger.warn(`stop worker failed: ${error?.message ?? error}`));
    }

    async function startWorker() {
      if (!connection) return;
      await stopWorker('restart');
      const next = new MotaWorker({ ctx, config: cfg, executor, logger });
      worker = next;
      try {
        await next.start(connection);
      } catch (error) {
        // The worker is kept so its `error` phase (message, lastError) stays
        // visible on the setup page; it is not running and claims nothing.
        throw error;
      }
    }

    async function reload(reason) {
      connection = await readConnection(credentials);
      await stopWorker(reason);
      if (connection && cfg.autoStart !== false) {
        try {
          await startWorker();
        } catch (error) {
          logger.warn(`mota worker did not start: ${error?.message ?? error}`);
        }
      }
    }

    async function requireExistingToken(input) {
      if (typeof input?.token === 'string' && input.token.trim() !== '') return input;
      const existing = connection ?? (await readConnection(credentials));
      if (!existing?.token) throw new ConnectionError('token', '请填写 BOUND_PULL Agent Token（mpk_ 开头）');
      return { ...input, token: existing.token };
    }

    const actions = {
      async state() {
        return {
          connection: publicConnection(connection),
          status: status(),
          config: {
            language: cfg.language,
            taskTimeoutSeconds: cfg.taskTimeoutSeconds,
            allowInsecureLoopback: cfg.allowInsecureLoopback === true,
          },
        };
      },

      async parse(text) {
        return parseBindingText(text);
      },

      async connect(body) {
        return enqueue(async () => {
          const input = await requireExistingToken(body ?? {});
          const normalized = normalizeConnection(input, { allowInsecureLoopback: cfg.allowInsecureLoopback === true });
          connection = await writeConnection(credentials, normalized);
          await startWorker();
          return { connection: publicConnection(connection), status: status() };
        });
      },

      async test(body) {
        return enqueue(async () => {
          const input = await requireExistingToken(body ?? {});
          const normalized = normalizeConnection(input, { allowInsecureLoopback: cfg.allowInsecureLoopback === true });
          const probe = await MotaWorker.probe(normalized, { allowInsecureLoopback: cfg.allowInsecureLoopback === true });
          return { probe };
        });
      },

      async disconnect() {
        return enqueue(async () => {
          await stopWorker('disconnect');
          await clearConnection(credentials);
          connection = null;
          return { connection: null, status: status() };
        });
      },
    };

    child.effect(() => {
      const disposers = [
        webServer.register({ kind: 'prefix', path: '/mota', handler: createSetupPageHandler({ actions }) }),
        child.on('credentials/record-updated', (key) => {
          if (String(key) !== CONNECTION_KEY) return;
          void enqueue(async () => {
            const before = connection?.token;
            connection = await readConnection(credentials);
            if (before !== connection?.token) await reload('credentials-changed');
          }).catch((error) => logger.warn(`reload after credential change failed: ${error?.message ?? error}`));
        }),
      ];
      return async () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            // disposal is best effort
          }
        }
        await stopWorker('plugin-disposed');
      };
    });

    void enqueue(async () => {
      connection = await readConnection(credentials);
      if (connection) {
        try {
          await startWorker();
        } catch (error) {
          logger.warn(`mota worker not started: ${error?.message ?? error}`);
        }
      }
    });
  });
}
