// The resident worker: independent heartbeat and claim loops per the MoTA
// Pull protocol, one task at a time, lease renewal driven by the server's
// leaseExpireAt, and a single completion per claimed run.
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

export class MotaWorker {
  constructor({ ctx, config, executor, logger, onChange }) {
    this.ctx = ctx;
    this.config = config;
    this.executor = executor;
    this.logger = logger;
    this.onChange = onChange;
    this.abort = new AbortController();
    this.running = false;
    this.active = null;
    this.activePromise = null;
    this.renewTimer = null;
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
      lastResult: null,
      lastError: null,
      startedAt: null,
      runs: [],
    };
  }

  getStatus() {
    return { ...this.state, runs: this.state.runs.map((r) => ({ ...r })) };
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange?.();
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
    this.#set({
      phase: 'connecting',
      message: '正在连接 MoTA…',
      queueId: null,
      workerId: connection.workerId,
      lastError: null,
      startedAt: new Date().toISOString(),
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
        onRequest: () => {},
      });
      const body = await transport.heartbeat();
      this.#applyHeartbeat(body);
      this.#set({ phase: 'online', message: '已连接，等待任务' });
    } catch (error) {
      this.running = false;
      this.#set({
        phase: 'error',
        message: this.#describe(error),
        lastError: this.#describe(error),
      });
      throw error;
    }
    this.transport = transport;
    const selfCheck = { pending: null, done: false };
    this.heartbeatLoop = this.#heartbeatLoop(transport, selfCheck).catch((error) => this.#fatal(error));
    this.claimLoop = this.#claimLoop(transport).catch((error) => this.#fatal(error));
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
        if (body.selfCheckRequired === true && !selfCheck.done && !selfCheck.pending) {
          this.#set({ selfCheckRequired: true, message: '平台要求自检：正在跑一次真实链路…' });
          this.#runSelfCheck(selfCheck).catch(() => {});
        }
        if (this.state.phase === 'connecting') this.#set({ phase: 'online', message: '已连接，等待任务' });
      } catch (error) {
        if (this.#stopRequested(error)) return;
        if (error instanceof WorkerStopped) throw error;
        this.#set({
          lastError: `heartbeat: ${this.#describe(error)}`,
          message: `心跳失败，重试中：${this.#describe(error)}`,
        });
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
  }

  async #claimLoop(transport) {
    while (this.running) {
      if (this.active) {
        await sleep(200, this.abort.signal).catch(() => {});
        continue;
      }
      try {
        const task = await transport.claim();
        if (!task) continue;
        this.#set({ lastClaimAt: new Date().toISOString(), activeRunId: task.runId, message: `执行任务 ${task.runId}` });
        this.activePromise = this.#runTask(transport, task);
        await this.activePromise;
      } catch (error) {
        if (this.#stopRequested(error)) return;
        if (error instanceof WorkerStopped) throw error;
        if (error instanceof Retryable) {
          await sleep(error.retryAfterMs ?? 5_000, this.abort.signal).catch(() => {});
          continue;
        }
        this.#set({ lastError: `claim: ${this.#describe(error)}` });
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
      // A previous delivery got a result but never a settled receipt: replay the
      // exact same bytes rather than executing the task a second time.
      try {
        const receipt = await transport.complete(task.runId, pending.envelope);
        this.#finishRun(task, receipt, pending.startedAt, 'replayed');
      } catch (error) {
        if (error instanceof WorkerStopped && AUTH_STOP_CODES.has(error.code)) throw error;
        this.#set({ lastError: `replay complete: ${this.#describe(error)}` });
      }
      return;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    this.abort.signal.addEventListener('abort', onAbort, { once: true });
    const startedAt = Date.now();
    this.active = { runId: task.runId, controller, task };
    let leaseExpireAt = Number.isFinite(task.leaseExpireAt) ? task.leaseExpireAt : Date.now() + 300_000;
    let leaseLost = false;
    const scheduleRenew = () => {
      if (this.renewTimer) clearTimeout(this.renewTimer);
      const remaining = leaseExpireAt - Date.now();
      const delay = Math.max(1_000, Math.floor(remaining / 3));
      this.renewTimer = setTimeout(async () => {
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
            return;
          }
          this.#set({ lastError: `renew: ${this.#describe(error)}`, message: '续租失败，重试中' });
          scheduleRenew();
        }
      }, delay);
    };
    scheduleRenew();
    try {
      const connection = this.connection;
      const { envelope } = await this.executor.execute({
        connection,
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
    } catch (error) {
      if (error instanceof WorkerStopped && AUTH_STOP_CODES.has(error.code)) throw error;
      if (leaseLost || controller.signal.aborted) {
        this.#pushRun({
          runId: task.runId,
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          accepted: false,
          runStatus: 'NOT_RETURNED_LEASE_LOST',
          runMsg: this.#describe(error),
        });
        this.#set({ lastError: `run ${task.runId}: ${this.#describe(error)}`, message: '租约丢失，结果未回传' });
      } else {
        this.#pushRun({
          runId: task.runId,
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          accepted: false,
          runStatus: 'NOT_RETURNED',
          runMsg: this.#describe(error),
        });
        this.#set({ lastError: `run ${task.runId}: ${this.#describe(error)}`, message: '任务执行未产出可回传结果' });
      }
    } finally {
      if (this.renewTimer) {
        clearTimeout(this.renewTimer);
        this.renewTimer = null;
      }
      this.abort.signal.removeEventListener('abort', onAbort);
      this.active = null;
      this.activePromise = null;
      this.#set({ activeRunId: null });
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
    this.logger?.warn?.(`Mota worker stopped: ${this.#describe(error)}`);
    await this.stop({ reason: 'fatal' });
  }

  #describe(error) {
    if (!error) return '未知错误';
    return String(error.message ?? error).slice(0, 500);
  }

  /** Stop loops; give the active task a bounded drain budget before cancelling. */
  async stop({ reason = 'stopped', drainMs = 3_000 } = {}) {
    const wasRunning = this.running || this.state.phase !== 'stopped';
    this.running = false;
    this.transport = undefined;
    if (this.activePromise) {
      await Promise.race([
        this.activePromise.catch(() => {}),
        sleep(drainMs).catch(() => {}),
      ]);
    }
    this.abort.abort(new Error(reason));
    await Promise.allSettled([this.heartbeatLoop, this.claimLoop]);
    this.heartbeatLoop = undefined;
    this.claimLoop = undefined;
    if (wasRunning && reason !== 'fatal') {
      this.#set({
        phase: 'stopped',
        message: '未连接',
        activeRunId: null,
        queueDepth: null,
      });
    }
  }
}
