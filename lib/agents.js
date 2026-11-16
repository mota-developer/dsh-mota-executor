// Persistent Agent definitions for the MoTA executor.
//
// One Agent = one BOUND_PULL binding (queue + token + Agent Code + position)
// plus its own concurrency and usage statistics. Each Agent lives in its own
// credentials GrantRecord (`mota/agent-<uuid>`), so tokens stay in the DSH
// credentials store and never in plugin config.
import { randomUUID } from 'node:crypto';
import { maskToken, normalizeConnection } from './connection.js';
import { POSITION_LABELS } from './schema.js';

export const AGENT_KEY_PREFIX = 'mota/agent-';
export const LEGACY_CONNECTION_KEY = 'mota/connection';
export const MAX_CONCURRENCY = 8;
export const DEFAULT_CONCURRENCY = 1;

export function agentKey(id) {
  return `${AGENT_KEY_PREFIX}${id}`;
}

export function emptyStats() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    invocations: 0,
    accepted: 0,
    rejected: 0,
    runs: 0,
  };
}

function clampConcurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.floor(number));
}

export function normalizeAgent(payload) {
  const stats = { ...emptyStats(), ...(payload?.stats ?? {}) };
  return {
    version: 1,
    id: String(payload?.id ?? ''),
    name: typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 80) : '',
    token: String(payload?.token ?? ''),
    queueUrl: String(payload?.queueUrl ?? ''),
    agentCode: String(payload?.agentCode ?? ''),
    positionType: String(payload?.positionType ?? ''),
    workerId: String(payload?.workerId ?? ''),
    concurrency: clampConcurrency(payload?.concurrency),
    enabled: payload?.enabled !== false,
    createdAt: typeof payload?.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
    updatedAt: typeof payload?.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
    stats,
    // Durable run finality across restarts (pull-protocol.md).
    history: Array.isArray(payload?.history) ? payload.history.slice(0, 10) : [],
    completedRunIds: Array.isArray(payload?.completedRunIds) ? payload.completedRunIds.slice(-100) : [],
    pending: payload?.pending && typeof payload?.pending === 'object' && !Array.isArray(payload.pending)
      ? Object.fromEntries(Object.entries(payload.pending).slice(0, 10))
      : {},
  };
}

function label(name, agentCode) {
  if (name) return name;
  if (agentCode) return agentCode;
  return 'MoTA Agent';
}

/** Read one Agent record by its credential key. */
export async function readAgent(credentials, key) {
  const record = await credentials.readRecord(key);
  if (!record || record.kind !== 'grant' || !record.payload || typeof record.payload !== 'object') return null;
  return normalizeAgent(record.payload);
}

/** Read every Agent this plugin owns. Malformed records are skipped, not fatal. */
export async function listAgents(credentials) {
  let entries = [];
  try {
    entries = await credentials.listRecords();
  } catch {
    return [];
  }
  const agents = [];
  for (const entry of entries) {
    const key = String(entry?.key ?? '');
    if (!key.startsWith(AGENT_KEY_PREFIX)) continue;
    try {
      const agent = await readAgent(credentials, key);
      if (agent?.id) agents.push(agent);
    } catch {
      // A broken record must not take the whole agent list down.
    }
  }
  agents.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return agents;
}

export async function saveAgent(credentials, agent) {
  const next = normalizeAgent({ ...agent, updatedAt: new Date().toISOString() });
  await credentials.modifyRecord(agentKey(next.id), async () => ({ kind: 'grant', payload: next }));
  return next;
}

export async function deleteAgent(credentials, id) {
  try {
    await credentials.deleteRecord(agentKey(id));
  } catch {
    // An absent record is already deleted.
  }
}

/**
 * Build a new Agent from a connection bundle. `input` is validated with the
 * same rules the single-connection flow used.
 */
export function createAgentFromInput(input, { allowInsecureLoopback = false, existingCount = 0 } = {}) {
  const connection = normalizeConnection(input, { allowInsecureLoopback });
  const id = randomUUID();
  return normalizeAgent({
    id,
    name: label(input?.name, connection.agentCode) || `Agent ${existingCount + 1}`,
    ...connection,
    concurrency: clampConcurrency(input?.concurrency),
    enabled: input?.enabled !== false,
    stats: emptyStats(),
  });
}

/** Merge an edit into an existing Agent; a blank token keeps the stored one. */
export function updateAgentFromInput(existing, input, { allowInsecureLoopback = false } = {}) {
  const merged = {
    ...existing,
    token: typeof input?.token === 'string' && input.token.trim() !== '' ? input.token.trim() : existing.token,
    queueUrl: typeof input?.queueUrl === 'string' && input.queueUrl.trim() !== '' ? input.queueUrl.trim() : existing.queueUrl,
    agentCode: typeof input?.agentCode === 'string' && input.agentCode.trim() !== '' ? input.agentCode.trim() : existing.agentCode,
    positionType: typeof input?.positionType === 'string' && input.positionType.trim() !== '' ? input.positionType.trim() : existing.positionType,
  };
  const connection = normalizeConnection(merged, { allowInsecureLoopback });
  return normalizeAgent({
    ...existing,
    ...connection,
    workerId:
      typeof input?.workerId === 'string' && input.workerId.trim() !== ''
        ? input.workerId.trim()
        : existing.workerId,
    name: typeof input?.name === 'string' && input.name.trim() !== '' ? input.name.trim().slice(0, 80) : existing.name,
    concurrency: input?.concurrency === undefined ? existing.concurrency : clampConcurrency(input.concurrency),
    enabled: input?.enabled === undefined ? existing.enabled : input.enabled !== false,
  });
}

/** Public projection: masked token, labels, derived cost. */
export function agentView(agent, pricing) {
  const stats = agent.stats ?? emptyStats();
  const inputRate = Number(pricing?.inputPerMTok ?? 0);
  const outputRate = Number(pricing?.outputPerMTok ?? 0);
  const configured = inputRate > 0 || outputRate > 0;
  const amount =
    (stats.promptTokens / 1_000_000) * (Number.isFinite(inputRate) ? inputRate : 0) +
    (stats.completionTokens / 1_000_000) * (Number.isFinite(outputRate) ? outputRate : 0);
  return {
    id: agent.id,
    name: agent.name,
    agentCode: agent.agentCode,
    positionType: agent.positionType,
    positionLabel: POSITION_LABELS[agent.positionType] ?? agent.positionType,
    queueUrl: agent.queueUrl,
    workerId: agent.workerId,
    concurrency: agent.concurrency,
    enabled: agent.enabled,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    tokenMasked: maskToken(agent.token),
    stats: {
      ...stats,
      cost: {
        amount: configured ? Number(amount.toFixed(4)) : 0,
        currency: typeof pricing?.currency === 'string' ? pricing.currency : 'CNY',
        configured,
      },
    },
  };
}

/** Move the old single-connection record into the Agent list, once. */
export async function migrateLegacyConnection(credentials, { allowInsecureLoopback = false } = {}) {
  const legacy = await credentials.readRecord(LEGACY_CONNECTION_KEY).catch(() => null);
  if (!legacy || legacy.kind !== 'grant' || !legacy.payload) return null;
  const existing = await listAgents(credentials);
  if (existing.length > 0) {
    // Already migrated; drop the stale record so it cannot resurrect.
    await credentials.deleteRecord(LEGACY_CONNECTION_KEY).catch(() => {});
    return null;
  }
  const payload = legacy.payload;
  const agent = normalizeAgent({
    id: randomUUID(),
    name: payload.agentCode ? payload.agentCode : 'MoTA Agent',
    token: payload.token,
    queueUrl: payload.queueUrl,
    agentCode: payload.agentCode,
    positionType: payload.positionType,
    workerId: payload.workerId,
    concurrency: DEFAULT_CONCURRENCY,
    enabled: true,
    createdAt: typeof payload.savedAt === 'string' ? payload.savedAt : new Date().toISOString(),
    stats: emptyStats(),
  });
  await saveAgent(credentials, agent);
  await credentials.deleteRecord(LEGACY_CONNECTION_KEY).catch(() => {});
  return agent;
}
