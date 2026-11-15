// Connection bundle: parse what Creator shows, normalize it, and persist it as
// one credentials GrantRecord (so the token never lands in plugin config).
import { hostname } from 'node:os';
import { POSITION_LABELS, POSITION_TO_SCHEMA } from './schema.js';
import { assertQueueUrl } from './transport.js';

/** The single credentials record owned by this plugin. */
export const CONNECTION_KEY = 'mota/connection';

const POSITION_BY_LABEL = new Map(Object.entries(POSITION_LABELS).map(([key, label]) => [label, key]));

export function maskToken(token) {
  if (typeof token !== 'string' || token === '') return '';
  if (token.length <= 10) return `${token.slice(0, 2)}…${token.slice(-2)}`;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function defaultWorkerId() {
  const host = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24) || 'host';
  const suffix = Math.random().toString(16).slice(2, 8).padEnd(6, '0');
  return `dsh-${host}-${suffix}`.slice(0, 64);
}

function normalizePosition(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (POSITION_TO_SCHEMA[raw]) return raw;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (POSITION_TO_SCHEMA[upper]) return upper;
  if (POSITION_BY_LABEL.has(raw)) return POSITION_BY_LABEL.get(raw);
  for (const key of Object.keys(POSITION_TO_SCHEMA)) {
    if (upper.includes(key)) return key;
  }
  for (const [label, key] of POSITION_BY_LABEL) {
    if (raw.includes(label)) return key;
  }
  return null;
}

/**
 * Parse a pasted Creator binding instruction. Returns only the fields actually
 * found; missing fields are reported so the page can ask for them instead of
 * guessing endpoints or roles.
 */
export function parseBindingText(text) {
  const raw = String(text ?? '');
  const found = {};
  for (const match of raw.matchAll(/https?:\/\/[^\s"'`<>]+/gi)) {
    const candidate = match[0].replace(/[.,;，。；]+$/, '');
    try {
      const url = new URL(candidate);
      if (!/\/publics\/bound\/queue\/[^/]+\/?$/.test(url.pathname)) continue;
      if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) continue;
      found.queueUrl = candidate;
      break;
    } catch {
      // not a usable URL; keep scanning
    }
  }
  const tokenMatch = raw.match(/\bmpk_[A-Za-z0-9]{6,}\b/);
  if (tokenMatch) found.token = tokenMatch[0];
  const codeMatch = raw.match(/(?:Agent\s*Code|AgentCode|agentCode|Agent\s*ID)[^\S\n]*[:：=][^\S\n]*([A-Za-z0-9][A-Za-z0-9_-]{2,})/i);
  if (codeMatch) found.agentCode = codeMatch[1];
  const workerMatch = raw.match(/(?:Worker\s*ID|workerId)[^\S\n]*[:：=][^\S\n]*([A-Za-z0-9][A-Za-z0-9._:-]{0,63})/i);
  if (workerMatch) found.workerId = workerMatch[1];
  const positionLine = raw.match(/(?:岗位|positionType|Position)[^\S\n]*[:：=][^\S\n]*([^\n\r]{1,40})/i);
  const candidates = [positionLine?.[1], raw].filter(Boolean);
  for (const candidate of candidates) {
    const position = normalizePosition(candidate);
    if (position) {
      found.positionType = position;
      break;
    }
  }
  const missing = ['token', 'queueUrl', 'agentCode', 'positionType'].filter((key) => !found[key]);
  return { found, missing };
}

export class ConnectionError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ConnectionError';
    this.field = field;
  }
}

/** Validate and normalize a connection submitted by the setup page. */
export function normalizeConnection(input, { allowInsecureLoopback = false } = {}) {
  const token = typeof input?.token === 'string' ? input.token.trim() : '';
  if (token === '') throw new ConnectionError('token', '请填写 BOUND_PULL Agent Token（mpk_ 开头）');
  if (token.length > 512 || /\s/.test(token)) throw new ConnectionError('token', 'Agent Token 不能包含空白字符');
  if (!token.startsWith('mpk_')) throw new ConnectionError('token', 'Agent Token 看起来不是 BOUND_PULL Token（应为 mpk_ 开头）');

  const queueUrl = typeof input?.queueUrl === 'string' ? input.queueUrl.trim() : '';
  if (queueUrl === '') throw new ConnectionError('queueUrl', '请填写 Creator 回执里的 Queue 地址');
  let normalizedQueue;
  try {
    normalizedQueue = assertQueueUrl(queueUrl, { allowInsecureLoopback }).queueUrl;
  } catch (error) {
    throw new ConnectionError('queueUrl', error.message);
  }

  const agentCode = typeof input?.agentCode === 'string' ? input.agentCode.trim() : '';
  if (agentCode === '') throw new ConnectionError('agentCode', '缺少 Agent Code：请把 Creator 的整段接入指令粘进「解析」，或补上包含 Agent Code 的绑定信息');
  if (agentCode.length > 128) throw new ConnectionError('agentCode', 'Agent Code 过长');

  const positionType = normalizePosition(input?.positionType);
  if (!positionType) {
    throw new ConnectionError('positionType', `岗位必须是 ${Object.keys(POSITION_TO_SCHEMA).join(' / ')} 之一`);
  }

  const requestedWorkerId = typeof input?.workerId === 'string' ? input.workerId.trim() : '';
  const workerId = requestedWorkerId === '' ? defaultWorkerId() : requestedWorkerId;
  if (workerId.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(workerId)) {
    throw new ConnectionError('workerId', 'Worker ID 需为 1–64 个字符，可用字母、数字、. _ : -');
  }
  return { token, queueUrl: normalizedQueue, agentCode, positionType, workerId };
}

export async function readConnection(credentials) {
  const record = await credentials.readRecord(CONNECTION_KEY);
  if (!record || record.kind !== 'grant') return null;
  const payload = record.payload;
  if (!payload || typeof payload !== 'object') return null;
  return {
    token: payload.token,
    queueUrl: payload.queueUrl,
    agentCode: payload.agentCode,
    positionType: payload.positionType,
    workerId: payload.workerId,
    savedAt: payload.savedAt,
  };
}

export async function writeConnection(credentials, connection) {
  const payload = { ...connection, savedAt: new Date().toISOString() };
  await credentials.modifyRecord(CONNECTION_KEY, async (current) => {
    void current;
    return { kind: 'grant', payload };
  });
  return payload;
}

export async function clearConnection(credentials) {
  try {
    await credentials.deleteRecord(CONNECTION_KEY);
  } catch (error) {
    // Deleting an already-absent record is not a failure of the disconnect.
    if (!/not found|missing|absent/i.test(String(error?.message ?? error))) throw error;
  }
}

/** The page/status view of a connection — never the token itself. */
export function publicConnection(connection) {
  if (!connection) return null;
  return {
    queueUrl: connection.queueUrl,
    agentCode: connection.agentCode,
    positionType: connection.positionType,
    positionLabel: POSITION_LABELS[connection.positionType] ?? connection.positionType,
    workerId: connection.workerId,
    savedAt: connection.savedAt ?? null,
    tokenMasked: maskToken(connection.token),
  };
}
