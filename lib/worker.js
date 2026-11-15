// The resident worker for ONE MoTA Agent: independent heartbeat loop plus a
// configurable number of claim loops (one in-flight task each), per-task lease
// renewal, and a single completion per claimed run. Usage and outcomes are
// reported through hooks so the Agent runtime can persist statistics and logs.
import {
  LeaseLost,
  PullTransport,
  Retryable,
  WorkerStopped,
  sleep,
} from './transport.js';

const MAX_RUN_HISTORY = 10;
const AUTH_STOP_CODES = new Set([
  'AGENT_TOKEN_REVOKED',
  'AGENT_TOKEN_EXPIRED',
  'AGENT_TOKEN_UNAUTHORIZED',
  'FORBIDDEN',
  'BOUND_TOKEN_INVALID',
  'BOUND_QUEUE_URL_INVALID',
  'BOUND_QUEUE_NOT_FOUND',
  'BOUND_TOKEN_NOT_ACTIVE',
  'BOUND_PROTOCOL_PARAMETER_ERROR',
  'BOUND_WORKER_ID_TOO_LONG_OR_EMPTY',
]);

function clampConcurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.min(8, Math.floor(number));
}

export class MotaWorker {
  constructor({ ctx, config, executor, logger, onChange, onLog, onTaskDone, concurrency = 1 }) {
    this.ctx = ctx;
    this.config = config;
    this.executor = executor;
    this.logger = logger;
    this.onChange = onChange;
    this.onLog = onLog;
    this.onTaskDone = onTaskDone;
    this.concurrency = clampConcurrency(concurrency);
    this.abort = new AbortController();
    this.running = false;
    this.activeTasks = new Map();
    this.claimLoops = [];
    this.seenRunIds = new Set();
    this.pendingResults = new Map();
    this.state = {
      phase: 'stopped',
      message: '未连接',
      queueId: null,
      workerId: null,
      queueDepth: null,
      heartbeatIntervalSeconds: null,
      selfCheckRequired: false,
      lastHeartbeatAt: null,
      lastHeartbeatMs: null,
      lastClaimAt: null,
      lastCompleteAt: null,
      activeRunId: null,
      activeRunIds: [],
      lastResult: null,
      lastError: null,
      startedAt: null,
      runs: [],
    };
  }

  getStatus() {
    return {
      ...this.state,
      activeRunIds: [...this.state.activeRunIds],
      runs: this.state.runs.map((r) => ({ ...r })),
    };
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange?.();
  }

  #log(level, event, message, detail) {
    try {
      this.onLog?.({ level, event, message, detail });
    } catch {
      // Logging must never break protocol loops.
    }
  }

  #pushRun(entry) {
    this.state.runs = [entry, ...this.state.runs].slice(0, MAX_RUN_HISTORY);
  }

  /** Validate a connection bundle with one real heartbeat, without starting loops. */
  static async probe(connection, { allowInsecureLoopback = false, signal } = {}) {
    const transport = new PullTransport({
      queueUrl: connection.queueUrl,
      token: connection.token,
      workerId: connection.workerId,
      allowInsecureLoopback,
      signal,
    });
    const started = Date.now();
    const body = await transport.heartbeat();
    return {
      queueDepth: body.queueDepth,
      heartbeatIntervalSeconds: body.heartbeatIntervalSeconds ?? 60,
      selfCheckRequired: body.selfCheckRequired === true,
      latencyMs: Date.now() - started,
    };
  }

  async start(connection) {
    if (this.running) await this.stop({ reason: 'restart' });
    this.running = true;
    this.abort = new AbortController();
    this.activeTasks = new Map();
    this.claimLoops = [];
    this.#set({
      phase: 'connecting',
      message: '正在连接 MoTA…',
      queueId: null,
      workerId: connection.workerId,
      lastError: null,
      startedAt: new Date().toISOString(),
      activeRunIds: [],
      activeRunId: null,
    });
    this.connection = connection;
    let transport;
    try {
      transport = new PullTransport({
        queueUrl: connection.queueUrl,
        token: connection.token,
        workerId: connection.workerId,
        allowInsecureLoopback: this.config.allowInsecureLoopback === true,
        signal: this.abort.signal,
      });
      const body = await transport.heartbeat();
      this.#applyHeartbeat(body);
      this.#set({ phase: 'online', message: `已连接，并发 ${this.concurrency}，等待任务` });
      this.#log('info', 'online', `已连接（并发 ${this.concurrency}），队列深度 ${body.queueDepth}`);
    } catch (error) {
      this.running = false;
      this.#set({
        phase: 'error',
        message: this.#describe(error),
        lastError: this.#describe(error),
      });
      this.#log('error', 'connect-failed', this.#describe(error));
      throw error;
    }
    this.transport = transport;
    const selfCheck = { pending: null, done: false };
    this.heartbeatLoop = this.#heartbeatLoop(transport, selfCheck).catch((error) => this.#fatal(error));
    for (let index = 0; index < this.concurrency; index += 1) {
      const loop = this.#claimLoop(transport, index).catch((error) => this.#fatal(error));
      this.claimLoops.push(loop);
    }
  }

  #applyHeartbeat(body) {
    this.#set({
      queueDepth: body.queueDepth,
      heartbeatIntervalSeconds: body.heartbeatIntervalSeconds ?? this.state.heartbeatIntervalSeconds ?? 60,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  async #heartbeatLoop(transport, selfCheck) {
    let intervalSeconds = this.state.heartbeatIntervalSeconds ?? 60;
    let lastFailure = '';
    while (this.running) {
      try {
        const body = await transport.heartbeat(
          selfCheck.pending ? { selfCheck: selfCheck.pending } : {},
        );
        if (selfCheck.pending) {
          selfCheck.pending = null;
          selfCheck.done = true;
        }
        intervalSeconds = Math.min(600, Math.max(5, body.heartbeatIntervalSeconds ?? intervalSeconds));
        this.#applyHeartbeat(body);
        if (lastFailure !== '') {
          lastFailure = '';
          this.#log('info', 'heartbeat', '心跳恢复');
        }
        if (body.selfCheckRequired === true && !selfCheck.done && !selfCheck.pending) {
          this.#set({ selfCheckRequired: true, message: '平台要求自检：正在跑一次真实链路…' });
          void this.#runSelfCheck(selfCheck);
        }
        if (this.state.phase === 'connecting') this.#set({ phase: 'online', message: '已连接，等待任务' });
      } catch (error) {
        if (this.#stopRequested(error)) return;
        if (error instanceof WorkerStopped) throw error;
        const description = this.#describe(error);
        this.#set({
          lastError: `heartbeat: ${description}`,
          message: `心跳失败，重试中：${description}`,
        });
        if (description !== lastFailure) {
          lastFailure = description;
          this.#log('warn', 'heartbeat-failed', description);
        }
      }
      await sleep(intervalSeconds * 1000, this.abort.signal).catch(() => {});
    }
  }

  async #runSelfCheck(selfCheck) {
    const timeoutMs = Math.max(10, this.config.selfCheckTimeoutSeconds ?? 60) * 1000;
    const result = await this.executor.probe({ signal: this.abort.signal, timeoutMs })
      .catch((error) => ({ pass: false, latencyMs: timeoutMs, error: this.#describe(error) }));
    selfCheck.pending = result;
    this.#set({
      selfCheckRequired: false,
      message: result.pass ? '自检通过，等待任务' : `自检未通过：${result.error ?? '未知原因'}`,
      lastError: result.pass ? this.state.lastError : `selfCheck: ${result.error}`,
    });
    this.#log(result.pass ? 'info' : 'warn', 'self-check', result.pass ? `自检通过（${result.latencyMs}ms）` : `自检失败：${result.error}`);
  }

  async #claimLoop(transport, index) {
    while (this.running) {
      try {
        const task = await transport.claim();
        if (!task) continue;
        this.#set({
          lastClaimAt: new Date().toISOString(),
          message: `执行任务 ${task.runId}`,
        });
        this.#log('info', 'claim', `领取任务 ${task.runId}`, { lane: index + 1 });
        await this.#runTask(transport, task);
      } catch (error) {
        if (this.#stopRequested(error)) return;
        if (error instanceof WorkerStopped) throw error;
        if (error instanceof Retryable) {
          await sleep(error.retryAfterMs ?? 5_000, this.abort.signal).catch(() => {});
          continue;
        }
        const description = this.#describe(error);
        this.#set({ lastError: `claim: ${description}` });
        this.#log('warn', 'claim-failed', description);
        await sleep(5_000, this.abort.signal).catch(() => {});
      }
    }
  }

  #stopRequested(error) {
    return !this.running || this.abort.signal.aborted || error instanceof LeaseLost;
  }

  async #runTask(transport, task) {
    if (this.seenRunIds.has(task.runId)) {
      this.#set({ message: `跳过已完成任务 ${task.runId}` });
      return;
    }
    const pending = this.pendingResults.get(task.runId);
    if (pending) {
      try {
        const receipt = await transport.complete(task.runId, pending.envelope);
        this.#finishRun(task, receipt, pending.startedAt, 'replayed');
      } catch (error) {
        if (error instanceof WorkerStopped && AUTH_STOP_CODES.has(error.code)) throw error;
        this.#set({ lastError: `replay complete: ${this.#describe(error)}` });
        this.#log('warn', 'replay-failed', this.#describe(error));
      }
      return;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    this.abort.signal.addEventListener('abort', onAbort, { once: true });
    const startedAt = Date.now();
    this.activeTasks.set(task.runId, { startedAt, controller });
    this.#set({
      activeRunIds: [...this.activeTasks.keys()],
      activeRunId: [...this.activeTasks.keys()][0] ?? null,
    });
    let renewTimer = null;
    let leaseExpireAt = Number.isFinite(task.leaseExpireAt) ? task.leaseExpireAt : Date.now() + 300_000;
    let leaseLost = false;
    let reported = false;
    const report = (payload) => {
      if (reported) return;
      reported = true;
      try {
        this.onTaskDone?.(payload);
      } catch (error) {
        this.logger?.warn?.(`task report failed: ${error?.message ?? error}`);
      }
    };
    const scheduleRenew = () => {
      if (renewTimer) clearTimeout(renewTimer);
      const remaining = leaseExpireAt - Date.now();
      const delay = Math.max(1_000, Math.floor(remaining / 3));
      renewTimer = setTimeout(async () => {
        if (!this.running || controller.signal.aborted) return;
        try {
          const body = await transport.renew(task.runId);
          if (Number.isFinite(body.leaseExpireAt)) leaseExpireAt = body.leaseExpireAt;
          scheduleRenew();
        } catch (error) {
          if (error instanceof LeaseLost) {
            leaseLost = true;
            controller.abort();
            this.#set({ lastError: `lease lost: ${this.#describe(error)}` });
            this.#log('warn', 'lease-lost', `任务 ${task.runId} 续租冲突`);
            return;
          }
          this.#set({ lastError: `renew: ${this.#describe(error)}`, message: '续租失败，重试中' });
          scheduleRenew();
        }
      }, delay);
    };
    scheduleRenew();
    try {
      const { envelope } = await this.executor.execute({
        connection: this.connection,
        task,
        signal: controller.signal,
      });
      if (controller.signal.aborted || leaseLost) throw new LeaseLost('LEASE_LOST_BEFORE_COMPLETE');
      if (Date.now() > leaseExpireAt) throw new LeaseLost('LEASE_EXPIRED_BEFORE_COMPLETE');
      this.pendingResults.set(task.runId, { envelope, startedAt });
      const receipt = await transport.complete(task.runId, envelope, { signal: controller.signal });
      this.pendingResults.delete(task.runId);
      this.seenRunIds.add(task.runId);
      this.#pushRun({
        runId: task.runId,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        accepted: receipt.accepted === true,
        runStatus: receipt.runStatus ?? null,
        runMsg: typeof receipt.runMsg === 'string' ? receipt.runMsg.slice(0, 200) : null,
      });
      this.#set({
        lastCompleteAt: new Date().toISOString(),
        lastResult: {
          runId: task.runId,
          accepted: receipt.accepted === true,
          runStatus: receipt.runStatus ?? null,
          runMsg: typeof receipt.runMsg === 'string' ? receipt.runMsg.slice(0, 200) : null,
        },
        message: receipt.accepted ? '任务已回传并被接受' : '任务已回传但平台未接受，请看详情',
        lastError: receipt.accepted ? this.state.lastError : `completion rejected: ${receipt.runMsg ?? receipt.runStatus ?? ''}`,
      });
      report({
        runId: task.runId,
        status: receipt.accepted ? 'accepted' : 'rejected',
        accepted: receipt.accepted === true,
        runStatus: receipt.runStatus ?? null,
        runMsg: typeof receipt.runMsg === 'string' ? receipt.runMsg.slice(0, 200) : null,
        usage: envelope.usage,
        durationMs: Date.now() - startedAt,
      });
      this.#log(
        receipt.accepted ? 'info' : 'warn',
        'complete',
        `任务 ${task.runId} ${receipt.accepted ? '已接受' : `未接受（${receipt.runMsg ?? receipt.runStatus ?? '未知原因'}）`}`,
      );
    } catch (error) {
      if (error instanceof WorkerStopped && AUTH_STOP_CODES.has(error.code)) throw error;
      const description = this.#describe(error);
      if (leaseLost || controller.signal.aborted) {
        this.#pushRun({
          runId: task.runId,
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          accepted: false,
          runStatus: 'NOT_RETURNED_LEASE_LOST',
          runMsg: description,
        });
        this.#set({ lastError: `run ${task.runId}: ${description}`, message: '租约丢失，结果未回传' });
        report({ runId: task.runId, status: 'lease-lost', accepted: false, runStatus: 'NOT_RETURNED_LEASE_LOST', runMsg: description, durationMs: Date.now() - startedAt });
        this.#log('warn', 'task-abandoned', `任务 ${task.runId} 租约丢失：${description}`);
      } else {
        this.#pushRun({
          runId: task.runId,
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          accepted: false,
          runStatus: 'NOT_RETURNED',
          runMsg: description,
        });
        this.#set({ lastError: `run ${task.runId}: ${description}`, message: '任务执行未产出可回传结果' });
        report({ runId: task.runId, status: 'failed', accepted: false, runStatus: 'NOT_RETURNED', runMsg: description, durationMs: Date.now() - startedAt });
        this.#log('error', 'task-failed', `任务 ${task.runId} 执行失败：${description}`);
      }
    } finally {
      if (renewTimer) clearTimeout(renewTimer);
      this.abort.signal.removeEventListener('abort', onAbort);
      this.activeTasks.delete(task.runId);
      this.#set({
        activeRunIds: [...this.activeTasks.keys()],
        activeRunId: [...this.activeTasks.keys()][0] ?? null,
      });
    }
  }

  #finishRun(task, receipt, startedAt, note) {
    this.seenRunIds.add(task.runId);
    this.pendingResults.delete(task.runId);
    this.#pushRun({
      runId: task.runId,
      startedAt: new Date(startedAt ?? Date.now()).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - (startedAt ?? Date.now()),
      accepted: receipt.accepted === true,
      runStatus: receipt.runStatus ?? null,
      runMsg: typeof receipt.runMsg === 'string' ? receipt.runMsg.slice(0, 200) : null,
      note,
    });
    this.#set({
      lastCompleteAt: new Date().toISOString(),
      lastResult: {
        runId: task.runId,
        accepted: receipt.accepted === true,
        runStatus: receipt.runStatus ?? null,
        runMsg: typeof receipt.runMsg === 'string' ? receipt.runMsg.slice(0, 200) : null,
      },
      message: receipt.accepted ? '任务已回传并被接受' : '任务已回传但平台未接受，请看详情',
      lastError: receipt.accepted ? this.state.lastError : `completion rejected: ${receipt.runMsg ?? receipt.runStatus ?? ''}`,
    });
  }

  async #fatal(error) {
    if (this.#stopRequested(error)) return;
    this.running = false;
    this.#set({
      phase: 'error',
      message: this.#describe(error),
      lastError: this.#describe(error),
    });
    this.#log('error', 'stopped', `Worker 停止：${this.#describe(error)}`);
    this.logger?.warn?.(`Mota worker stopped: ${this.#describe(error)}`);
    await this.stop({ reason: 'fatal' });
  }

  #describe(error) {
    if (!error) return '未知错误';
    return String(error.message ?? error).slice(0, 500);
  }

  /** Stop loops; give active tasks a bounded drain budget before cancelling. */
  async stop({ reason = 'stopped', drainMs = 4_000 } = {}) {
    const wasRunning = this.running || this.state.phase !== 'stopped';
    this.running = false;
    this.transport = undefined;
    const active = [...this.activeTasks.values()];
    if (active.length > 0) {
      const deadline = Date.now() + drainMs;
      // The task promises settle through the claim loops; wait for either the
      // drain budget or the loops to finish, then abort whatever remains.
      await Promise.race([
        Promise.allSettled(this.claimLoops.map((loop) => loop.catch(() => {}))),
        sleep(drainMs).catch(() => {}),
      ]);
      if (Date.now() >= deadline) {
        // fall through to abort below
      }
    }
    this.abort.abort(new Error(reason));
    await Promise.allSettled(this.claimLoops);
    this.claimLoops = [];
    this.activeTasks.clear();
    this.heartbeatLoop = undefined;
    if (wasRunning && reason !== 'fatal') {
      this.#set({
        phase: 'stopped',
        message: '未连接',
        activeRunId: null,
        activeRunIds: [],
        queueDepth: null,
      });
    }
  }
}
