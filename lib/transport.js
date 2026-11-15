// MoTA Bound Pull transport — a faithful JS port of the official creator kit's
// `pull-transport.mjs`, trimmed to the four Pull APIs (no token-candidate file
// rotation; a revoked token stops the worker and surfaces an actionable error).
//
// Wire facts that must not drift (creator-web/skills/mota-bind/references/pull-protocol.md):
// - token travels ONLY as the URL-encoded `token` query parameter;
// - `workerId` query except on activation and complete;
// - `X-MoTA-Run-ID` header carries runId on renew/complete, never in a body;
// - HTTP 200 is never sufficient: `success:false` / non-OK `code` is a failure,
//   and a bare `code:"000002"` (HTTP 200) is a configuration error, not success.

export const DEFAULT_HEARTBEAT_SECONDS = 60;
const CLAIM_TIMEOUT_MS = 40_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class WorkerStopped extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'WorkerStopped';
    this.code = code;
    this.exitCode = 3;
  }
}

export class LeaseLost extends Error {
  constructor(code) {
    super(code);
    this.name = 'LeaseLost';
    this.code = code;
  }
}

export class Retryable extends Error {
  constructor(code, retryAfterMs = 5_000) {
    super(code);
    this.name = 'Retryable';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

const OK_CODES = new Set(['OK', '000000']);
// Codes that mean "stop all loops and ask a human for a new binding", even when
// the platform reports them inside an HTTP 200 body (creator kit semantics).
const AUTH_FAILURE_CODES = new Set([
  'AGENT_TOKEN_REVOKED',
  'AGENT_TOKEN_EXPIRED',
  'AGENT_TOKEN_UNAUTHORIZED',
  'BOUND_TOKEN_INVALID',
  'BOUND_TOKEN_NOT_ACTIVE',
  'BOUND_QUEUE_NOT_FOUND',
  'BOUND_QUEUE_URL_INVALID',
  'BOUND_QUEUE_EXPIRED',
]);

export function codeOf(reply) {
  const code = reply?.body?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
}

export function bodyFailed(reply) {
  if (!reply) return true;
  const code = codeOf(reply);
  return reply.body?.success === false || Boolean(code && !OK_CODES.has(code));
}

export function retryAfterMs(value) {
  const seconds = Number(value);
  const bounded = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 5;
  return Math.max(1, bounded) * 1000;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Validate the exact queue URL issued by Creator. Real Creator queues are https;
 * plain http is accepted only for a loopback fake queue during local testing.
 */
export function assertQueueUrl(raw, { allowInsecureLoopback = false } = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new WorkerStopped('BOUND_QUEUE_URL_INVALID', 'Queue 地址为空');
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WorkerStopped('BOUND_QUEUE_URL_INVALID', 'Queue 地址不是合法 URL');
  }
  const isHttps = url.protocol === 'https:';
  const isLoopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!isHttps && !(allowInsecureLoopback && isLoopbackHttp)) {
    throw new WorkerStopped('BOUND_QUEUE_URL_INVALID', 'Queue 地址必须使用 https（本地测试可用 allowInsecureLoopback 放行 loopback）');
  }
  if (url.username || url.password) {
    throw new WorkerStopped('BOUND_QUEUE_URL_INVALID', 'Queue 地址不能带账号密码');
  }
  if (url.search || url.hash) {
    throw new WorkerStopped('BOUND_QUEUE_URL_INVALID', 'Queue 地址不能带 query 或 hash');
  }
  if (!/\/publics\/bound\/queue\/[^/]+\/?$/.test(url.pathname)) {
    throw new WorkerStopped('BOUND_QUEUE_URL_INVALID', 'Queue 地址路径不匹配 /publics/bound/queue/<queueId>');
  }
  const marker = raw.indexOf('/publics/bound/queue/');
  const base = raw.slice(0, marker).replace(/\/+$/, '');
  return { queueUrl: raw.trim().replace(/\/+$/, ''), base, queueId: url.pathname.split('/').filter(Boolean).pop() };
}

export function assertWorkerId(workerId) {
  if (typeof workerId !== 'string' || workerId.trim() === '' || workerId.length > 64) {
    throw new WorkerStopped('BOUND_WORKER_ID_TOO_LONG_OR_EMPTY', 'workerId 必须为 1–64 个字符');
  }
}

export function redactUrl(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/([?&]token=)[^&]*/g, '$1[REDACTED]');
}

function parseBody(text) {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Retryable('BAD_RESPONSE_JSON');
  }
}

/**
 * One worker's view of one queue. All requests carry the caller's AbortSignal;
 * `onRequest` receives { action, status, ms, retryAfter } for the status page.
 */
export class PullTransport {
  #queue;
  #token;
  #workerId;
  #signal;
  #onRequest;

  constructor({ queueUrl, token, workerId, allowInsecureLoopback = false, signal, onRequest }) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new WorkerStopped('BOUND_TOKEN_INVALID', 'Agent Token 为空');
    }
    this.#queue = assertQueueUrl(queueUrl, { allowInsecureLoopback });
    assertWorkerId(workerId);
    this.#token = token.trim();
    this.#workerId = workerId;
    this.#signal = signal;
    this.#onRequest = onRequest;
  }

  get queueId() {
    return this.#queue.queueId;
  }

  async #fetchText(urlObj, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const onAbort = () => controller.abort(this.#signal?.reason);
    this.#signal?.addEventListener('abort', onAbort, { once: true });
    const started = Date.now();
    try {
      const res = await fetch(urlObj, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
        headers: { accept: 'application/json', ...(init.headers || {}) },
      });
      const text = await res.text();
      const reply = { status: res.status, body: parseBody(text), retryAfter: res.headers.get('retry-after') };
      this.#onRequest?.({ action: init.action, status: res.status, ms: Date.now() - started, retryAfter: reply.retryAfter });
      return reply;
    } catch (error) {
      if (this.#signal?.aborted) throw new LeaseLost('TRANSPORT_ABORTED');
      if (error instanceof Retryable) throw error;
      this.#onRequest?.({ action: init.action, status: 0, ms: Date.now() - started, error: error?.name || 'NETWORK' });
      throw new Retryable('NETWORK', 5_000);
    } finally {
      clearTimeout(timer);
      this.#signal?.removeEventListener('abort', onAbort);
    }
  }

  async #request(action, { runId, workerId, body, timeoutMs } = {}) {
    const url = new URL(`${this.#queue.queueUrl}/${action}`);
    url.searchParams.set('token', this.#token);
    if (workerId) url.searchParams.set('workerId', workerId);
    const headers = { accept: 'application/json' };
    if (runId) headers['X-MoTA-Run-ID'] = runId;
    let payload;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return this.#fetchText(url, {
      action,
      method: 'POST',
      headers,
      body: payload,
    }, timeoutMs ?? REQUEST_TIMEOUT_MS);
  }

  /** GET {base}/creator/bound/skill — the pre-promotion activation probe. */
  async activation() {
    const url = new URL(`${this.#queue.base}/creator/bound/skill`);
    url.searchParams.set('token', this.#token);
    const reply = await this.#fetchText(url, { action: 'activation', method: 'GET' }, REQUEST_TIMEOUT_MS);
    if (reply.status === 429 || reply.status >= 500) throw new Retryable('ACTIVATION_RETRYABLE', retryAfterMs(reply.retryAfter));
    if (reply.status !== 200 || bodyFailed(reply)) {
      throw new WorkerStopped('BOUND_TOKEN_NOT_ACTIVE', 'Agent Token 尚未激活或已失效');
    }
    return reply.body;
  }

  async #active(action, options) {
    const reply = await this.#request(action, options);
    const code = codeOf(reply);
    if (reply.status === 429 || reply.status >= 500) {
      throw new Retryable(code || 'SERVER_RETRYABLE', retryAfterMs(reply.retryAfter));
    }
    if (reply.status === 401) {
      if (code === 'AGENT_TOKEN_REVOKED' || code === 'AGENT_TOKEN_EXPIRED') {
        throw new WorkerStopped(code, 'Agent Token 已撤销或过期，请让创作者在 Creator Center 重新签发并更新本插件');
      }
      throw new WorkerStopped('AGENT_TOKEN_UNAUTHORIZED', 'Agent Token 未被接受（401）');
    }
    if (reply.status === 403) throw new WorkerStopped('FORBIDDEN', '平台拒绝访问（403）');
    if (code && AUTH_FAILURE_CODES.has(code)) {
      throw new WorkerStopped(code, '连接凭据已失效，请让创作者重新签发绑定信息并更新本插件');
    }
    if (reply.status === 404) throw new WorkerStopped('BOUND_QUEUE_NOT_FOUND', 'Queue 不存在或已被删除（404）');
    if (code === '000002' || code === 'BOUND_WORKER_ID_TOO_LONG') {
      throw new WorkerStopped(code || 'BOUND_PROTOCOL_PARAMETER_ERROR', '平台报参数错误：检查 token、queueUrl、workerId');
    }
    return reply;
  }

  async heartbeat(body = {}) {
    assertWorkerId(this.#workerId);
    const reply = await this.#active('heartbeat', { workerId: this.#workerId, body });
    if (reply.status !== 200 || bodyFailed(reply) || !Number.isInteger(reply.body?.queueDepth) || reply.body.queueDepth < 0) {
      throw new Retryable('BOUND_HEARTBEAT_UNEXPECTED_SHAPE');
    }
    return reply.body;
  }

  /** Long-poll claim: resolves null on HTTP 204, the task object on HTTP 200. */
  async claim() {
    const reply = await this.#active('claim', { workerId: this.#workerId, timeoutMs: CLAIM_TIMEOUT_MS });
    if (reply.status === 204) return null;
    if (reply.status !== 200 || bodyFailed(reply)) throw new Retryable('BOUND_CLAIM_UNEXPECTED_SHAPE');
    const task = reply.body;
    if (typeof task.runId !== 'string' || !Array.isArray(task.templateInputData)) {
      throw new Retryable('BOUND_CLAIM_UNEXPECTED_SHAPE');
    }
    return task;
  }

  async renew(runId) {
    const reply = await this.#active('renew', { runId, workerId: this.#workerId });
    if (reply.status === 409) throw new LeaseLost('BOUND_CLAIM_CONFLICT');
    if (reply.status !== 200 || bodyFailed(reply)) {
      throw new Retryable('BOUND_RENEW_UNEXPECTED_SHAPE');
    }
    return reply.body;
  }

  /**
   * Complete with byte-identical retries. `accepted:false` settles the call (the
   * platform's answer is final) but the caller records it as a rejected run.
   */
  async complete(runId, envelope, { maxAttempts = 6, signal } = {}) {
    const payload = JSON.stringify(envelope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted) throw new LeaseLost('COMPLETION_CANCELLED_AFTER_LEASE_LOSS');
      let reply;
      try {
        reply = await this.#request('complete', { runId, body: payload });
      } catch (error) {
        if (error instanceof LeaseLost) throw error;
        if (attempt === maxAttempts) throw new Error('COMPLETION_UNCONFIRMED_RETRY_BUDGET_EXHAUSTED');
        await sleep(error.retryAfterMs ?? 5_000, signal);
        continue;
      }
      const code = codeOf(reply);
      if (reply.status === 200 && !bodyFailed(reply) && typeof reply.body?.accepted === 'boolean') {
        return reply.body;
      }
      if (code === '000002') {
        throw new WorkerStopped('BOUND_PROTOCOL_PARAMETER_ERROR', 'complete 报参数错误，停止重试');
      }
      const retryable = reply.status === 429 || reply.status >= 500 || reply.status === 0;
      if (!retryable) {
        if (reply.status >= 400) throw new WorkerStopped('COMPLETION_REJECTED_NO_RETRY', `complete 被拒绝（HTTP ${reply.status}）`);
        if (attempt === maxAttempts) throw new Error('COMPLETION_UNCONFIRMED_RETRY_BUDGET_EXHAUSTED');
      }
      await sleep(retryAfterMs(reply.retryAfter), signal);
    }
    throw new Error('COMPLETION_UNCONFIRMED_RETRY_BUDGET_EXHAUSTED');
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LeaseLost('ABORTED'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LeaseLost('ABORTED'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
