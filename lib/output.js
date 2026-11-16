// Completion envelope assembly — the last gate before bytes go to MoTA.
//
// Mirrors creator-web/skills/mota-bind/scripts/pull-output.mjs:
// exactly three business keys, a trimmed payload_info carrying the mandatory
// disclaimer, real measured usage, then the same contract validation the
// platform will run.
import { validateCompletion } from './schema.js';

export const DISCLAIMERS = {
  zh: 'AI 生成的研究参考，不构成投资建议。',
  en: 'AI-generated research for reference only, not investment advice.',
};

export const CONTRACT_VERSION = 'V2';
const BUSINESS_KEYS = ['payload_info', 'payload_result'];

export class OutputContractError extends Error {
  constructor(problems) {
    super(`结果未通过输出契约：${problems.join('；')}`);
    this.name = 'OutputContractError';
    this.problems = problems;
  }
}

export function usageOrThrow(measuredUsage) {
  if (!measuredUsage || typeof measuredUsage !== 'object') {
    throw new OutputContractError(['RUNTIME_USAGE_MISSING: 没有测到真实调用用量，不能构造 completion']);
  }
  return {
    totalTokens: measuredUsage.totalTokens,
    promptTokens: measuredUsage.promptTokens,
    completionTokens: measuredUsage.completionTokens,
    ...(measuredUsage.cachedInputTokens ? { cachedInputTokens: measuredUsage.cachedInputTokens } : {}),
    ...(measuredUsage.reasoningTokens ? { reasoningTokens: measuredUsage.reasoningTokens } : {}),
    invocationCount: measuredUsage.invocationCount,
    schemaVersion: '1.0',
    status: 'FINAL',
    estimated: false,
  };
}

/**
 * Build the exact completion envelope. `business` is what the model produced
 * ({payload_result, payload_info}); the disclaimer is appended by us, after
 * trimming, so the platform-visible text is stable.
 */
export function assembleCompletion(positionType, business, measuredUsage, language = 'zh') {
  if (!business || typeof business !== 'object' || Array.isArray(business)) {
    throw new OutputContractError(['payload_result / payload_info 缺失：模型没有返回 JSON 对象']);
  }
  const keys = Object.keys(business).filter((k) => k !== 'contract_version').sort();
  if (JSON.stringify(keys) !== JSON.stringify(BUSINESS_KEYS)) {
    throw new OutputContractError([`业务对象只能包含 ${BUSINESS_KEYS.join(', ')}，实际为 ${keys.join(', ') || '(空)'}`]);
  }
  const disclaimer = DISCLAIMERS[language] ?? DISCLAIMERS.zh;
  // Official assembly (pull-output.mjs): trimEnd, then append unless already
  // the exact suffix — never let a mid-text mention suppress the disclaimer.
  if (typeof business.payload_info !== 'string' || business.payload_info.trim() === '') {
    throw new OutputContractError(['payload_info 不能为空：必须给出对创作者可见的 Markdown 摘要']);
  }
  const info = business.payload_info.trimEnd();
  const payloadInfo = info.endsWith(disclaimer) ? info : `${info}\n\n${disclaimer}`;
  const envelope = {
    payload_result: business.payload_result,
    payload_info: payloadInfo,
    contract_version: CONTRACT_VERSION,
    usage: usageOrThrow(measuredUsage),
  };
  const validation = validateCompletion(positionType, envelope);
  if (!validation.ok) throw new OutputContractError(validation.problems);
  return envelope;
}

/**
 * Honest failure envelope (pull-protocol.md "Failure and result finality").
 *
 * When execution or validation fails we still complete promptly so the
 * platform can reject/classify the run instead of waiting for the lease to
 * expire. The payload_result is a minimal honest object — we never invent
 * market facts or investment directions to make a failure look valid — and
 * payload_info explains the failure. Real measured usage is included when any
 * model invocation happened; when no model ran, usage is omitted rather than
 * manufactured. The envelope is validated locally and the (expected) failure
 * verdict is returned so the worker can record that it failed local
 * validation. This is failure reporting, never a claimed success.
 */
export function buildFailureEnvelope(positionType, { language = 'zh', reason, runId, measuredUsage } = {}) {
  const disclaimer = DISCLAIMERS[language] ?? DISCLAIMERS.zh;
  const explanation = language === 'en'
    ? `Task ${runId ?? ''} failed before a contract-valid result could be produced: ${reason}. No research result is reported for this run.`
    : `任务 ${runId ?? ''} 未能产出符合契约的结果：${reason}。本次不回传任何研究结论。`;
  const info = `${explanation.trimEnd()}\n\n${disclaimer}`;
  // Only a genuinely measurable usage may be reported; a zero/invalid total
  // means the meter gap is reported as "no usage", never as a fake number.
  const usable = measuredUsage && Number.isFinite(Number(measuredUsage.totalTokens)) && Number(measuredUsage.totalTokens) >= 1;
  const envelope = {
    payload_result: {},
    payload_info: info,
    contract_version: CONTRACT_VERSION,
    ...(usable ? { usage: usageOrThrow(measuredUsage) } : {}),
  };
  const validation = validateCompletion(positionType, envelope);
  return { envelope, validation };
}

/**
 * Pull the first JSON object out of a model reply: plain JSON, a fenced block,
 * or the first balanced brace span (models sometimes prepend a sentence).
 */
export function parseAgentJson(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') throw new OutputContractError(['模型没有返回任何内容']);
  const candidates = [];
  if (raw.startsWith('{')) candidates.push(raw);
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  throw new OutputContractError(['模型返回的内容不是合法 JSON 对象（需要 {"payload_result":…,"payload_info":…}）']);
}
