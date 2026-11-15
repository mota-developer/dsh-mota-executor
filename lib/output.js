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
  const info = String(business.payload_info ?? '').trim();
  const payloadInfo = info.includes(disclaimer) ? info : `${info}\n\n${disclaimer}`.trim();
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
