// MoTA output-contract validation.
//
// The validator below is a subset of JSON Schema Draft 2020-12, ported from the
// reference implementation shipped with the official mota-bind creator kit
// (creator-web/skills/mota-bind/scripts/mota-selfcheck.mjs). The role schemas are
// self-contained and only use the keywords implemented here; the platform's own
// preflight (/publics/bound/validate) remains the authoritative gate.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const POSITION_TO_SCHEMA = {
  FUNDAMENTAL_ANALYST: 'fundamental-analyst.json',
  TECHNICAL_ANALYST: 'technical-analyst.json',
  STRATEGIST: 'strategist.json',
  PORTFOLIO_MANAGER: 'portfolio-manager.json',
  RISK_MANAGER: 'risk-manager.json',
  EXECUTION_TRADER: 'execution-trader.json',
};

export const POSITION_LABELS = {
  FUNDAMENTAL_ANALYST: '基本面分析师',
  TECHNICAL_ANALYST: '技术面分析师',
  STRATEGIST: '策略师',
  PORTFOLIO_MANAGER: '组合经理',
  RISK_MANAGER: '风控经理',
  EXECUTION_TRADER: '执行交易员',
};

const PAYLOAD_ENVELOPE_REF = '#/$defs/motaAgentPayloadV1';
const ENVELOPE_KEYS = ['contract_version', 'payload_info', 'payload_result'];
const USAGE_KEY = 'usage';
const USAGE_KNOWN_FIELDS = [
  'totalTokens', 'promptTokens', 'completionTokens', 'cachedInputTokens',
  'reasoningTokens', 'invocationCount', 'schemaVersion', 'status', 'estimated',
];
const USAGE_OPTIONAL_TOKEN_FIELDS = [
  'promptTokens', 'completionTokens', 'cachedInputTokens', 'reasoningTokens',
];

const schemaDir = new URL('../schemas/', import.meta.url);
const cache = new Map();

function readSchema(name) {
  if (!cache.has(name)) {
    const file = fileURLToPath(new URL(name, schemaDir));
    cache.set(name, JSON.parse(readFileSync(file, 'utf8')));
  }
  return cache.get(name);
}

export function roleSchema(positionType) {
  const name = POSITION_TO_SCHEMA[positionType];
  if (!name) throw new Error(`不支持的岗位类型：${positionType}`);
  return readSchema(name);
}

/** The self-contained payload_result schema, pretty-printed for the executor prompt. */
export function payloadSchemaText(positionType) {
  const doc = roleSchema(positionType);
  return JSON.stringify(doc.$defs?.payloadResult ?? null, null, 2);
}

export function roleTitle(positionType) {
  const doc = roleSchema(positionType);
  return doc.$defs?.payloadResult?.title || `${positionType} payload`;
}

export function roleDescription(positionType) {
  return roleSchema(positionType).$defs?.payloadResult?.description || '';
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let node = root;
  for (const rawSeg of ref.slice(2).split('/')) {
    const seg = decodeURIComponent(rawSeg.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (node === null || typeof node !== 'object' || !(seg in node)) return null;
    node = node[seg];
  }
  return node;
}

function validateNode(root, schema, instance, pointer, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push(`${pointer || '(根)'}: 此处不允许出现任何值`);
    return;
  }
  if (typeof schema !== 'object' || schema === null) return;

  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (target) validateNode(root, target, instance, pointer, errors);
    return;
  }

  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((t) => typeMatches(instance, t))) {
      errors.push(`${pointer || '(根)'}: 类型应为 ${expected.join(' 或 ')}，实际是 ${typeOf(instance)}`);
      return;
    }
  }

  if ('const' in schema && JSON.stringify(instance) !== JSON.stringify(schema.const)) {
    errors.push(`${pointer || '(根)'}: 取值必须是 ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum)) {
    const hit = schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(instance));
    if (!hit) {
      errors.push(`${pointer || '(根)'}: 取值 ${JSON.stringify(instance)} 不在枚举内 ${JSON.stringify(schema.enum)}`);
    }
  }

  if (instance !== null && typeof instance === 'object' && !Array.isArray(instance)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in instance)) errors.push(`${pointer || '(根)'}: 缺必填字段 '${key}'`);
      }
    }
    const props = schema.properties || {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in instance) validateNode(root, sub, instance[key], `${pointer}/${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!(key in props)) {
          errors.push(`${pointer || '(根)'}: 出现契约外字段 '${key}'（该层 additionalProperties 为 false）`);
        }
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const key of Object.keys(instance)) {
        if (!(key in props)) {
          validateNode(root, schema.additionalProperties, instance[key], `${pointer}/${key}`, errors);
        }
      }
    }
  }

  if (Array.isArray(instance)) {
    if (typeof schema.minItems === 'number' && instance.length < schema.minItems) {
      errors.push(`${pointer || '(根)'}: 至少要有 ${schema.minItems} 项，实际 ${instance.length} 项`);
    }
    if (typeof schema.maxItems === 'number' && instance.length > schema.maxItems) {
      errors.push(`${pointer || '(根)'}: 最多 ${schema.maxItems} 项，实际 ${instance.length} 项`);
    }
    if (schema.items) {
      instance.forEach((item, i) => validateNode(root, schema.items, item, `${pointer}/${i}`, errors));
    }
  }

  if (typeof instance === 'number') {
    if (typeof schema.minimum === 'number' && instance < schema.minimum) {
      errors.push(`${pointer || '(根)'}: 不得小于 ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && instance > schema.maximum) {
      errors.push(`${pointer || '(根)'}: 不得大于 ${schema.maximum}`);
    }
    if (typeof schema.exclusiveMinimum === 'number' && instance <= schema.exclusiveMinimum) {
      errors.push(`${pointer || '(根)'}: 必须大于 ${schema.exclusiveMinimum}`);
    }
  }

  if (typeof instance === 'string' && typeof schema.pattern === 'string') {
    let re = null;
    try { re = new RegExp(schema.pattern); } catch { re = null; }
    if (re && !re.test(instance)) errors.push(`${pointer || '(根)'}: 不匹配格式 ${schema.pattern}`);
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) validateNode(root, sub, instance, pointer, errors);
  }
  if (Array.isArray(schema.anyOf)) {
    const branchErrors = schema.anyOf.map((sub) => {
      const bucket = [];
      validateNode(root, sub, instance, pointer, bucket);
      return bucket;
    });
    if (!branchErrors.some((b) => b.length === 0)) {
      const closest = branchErrors.reduce((a, b) => (b.length < a.length ? b : a));
      errors.push(`${pointer || '(根)'}: anyOf 的任何一支都不满足；最接近的一支还差：${closest.join('；')}`);
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const branchErrors = schema.oneOf.map((sub) => {
      const bucket = [];
      validateNode(root, sub, instance, pointer, bucket);
      return bucket;
    });
    const passed = branchErrors.filter((b) => b.length === 0).length;
    if (passed === 0) {
      const closest = branchErrors.reduce((a, b) => (b.length < a.length ? b : a));
      const titles = schema.oneOf.map((s) => s.title).filter(Boolean).join(' / ');
      errors.push(`${pointer || '(根)'}: oneOf 的任何一支都不满足${titles ? `（可选分支：${titles}）` : ''}；`
        + `最接近的一支还差：${closest.join('；')}`);
    } else if (passed > 1) {
      errors.push(`${pointer || '(根)'}: oneOf 同时满足了 ${passed} 支，必须且只能满足一支`);
    }
  }
  if (schema.if !== undefined) {
    const bucket = [];
    validateNode(root, schema.if, instance, pointer, bucket);
    if (bucket.length === 0 && schema.then !== undefined) {
      validateNode(root, schema.then, instance, pointer, errors);
    } else if (bucket.length > 0 && schema.else !== undefined) {
      validateNode(root, schema.else, instance, pointer, errors);
    }
  }
}

export function validateAgainstPositionSchema(schemaDoc, instance) {
  const defs = schemaDoc?.$defs;
  if (!defs || typeof defs !== 'object') {
    return { ok: false, errors: ['schema 文件里没有 $defs，文件形态不对'] };
  }
  const errors = [];
  validateNode({ $defs: defs }, { $ref: PAYLOAD_ENVELOPE_REF }, instance, '', errors);
  return { ok: errors.length === 0, errors };
}

export function validateAgainstChannelSchema(channelDoc, transport, instance) {
  const def = transport === 'push' ? 'callbackRequest' : 'completeRequest';
  const defs = channelDoc?.$defs;
  if (!defs || !defs[def]) return { ok: false, errors: [`通道 schema 里没有 $defs/${def}`] };
  const errors = [];
  validateNode({ $defs: defs }, { $ref: `#/$defs/${def}` }, instance, '', errors);
  return { ok: errors.length === 0, errors };
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isJsonInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

export function checkEnvelopeShape(sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return { problems: ['信封不是 JSON 对象'], warnings: [] };
  }
  const problems = [];
  const warnings = [];
  for (const key of ENVELOPE_KEYS) {
    if (!(key in sample)) problems.push(`缺少必备键 ${key}（平台判 ENVELOPE_SHAPE_INVALID）`);
  }
  if ('payload_result' in sample
    && (!sample.payload_result || typeof sample.payload_result !== 'object' || Array.isArray(sample.payload_result))) {
    problems.push('payload_result 必须是对象');
  }
  for (const key of ['payload_info', 'contract_version']) {
    if (key in sample && !isNonBlankString(sample[key])) {
      problems.push(`${key} 必须是非空白字符串（空串 / 空白 / null 都视同缺失，平台判 ENVELOPE_SHAPE_INVALID）`);
    }
  }
  const extra = Object.keys(sample)
    .filter((k) => !ENVELOPE_KEYS.includes(k) && k !== USAGE_KEY)
    .sort();
  if (extra.length) {
    problems.push(`出现不允许的顶层键 ${JSON.stringify(extra)}（顶层只能是三个业务键 + usage；扩展内容只能进 payload_result.extensions）`);
  }
  if ('runtime_accounting' in sample) warnings.push('runtime_accounting 是平台内部通道专用字段，会被忽略');
  return { problems, warnings };
}

export function checkUsage(sample) {
  const warnings = [];
  const fail = (code, field, received, message) => ({ code, field, received, message, warnings });
  if (!sample || typeof sample !== 'object' || Array.isArray(sample) || !(USAGE_KEY in sample)) {
    return fail('RUNTIME_USAGE_MISSING', 'usage', '缺失', 'usage 缺失');
  }
  const usage = sample[USAGE_KEY];
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return fail('RUNTIME_USAGE_INVALID', 'usage', String(usage), 'usage 必须是对象');
  }
  for (const key of Object.keys(usage)) {
    if (!USAGE_KNOWN_FIELDS.includes(key)) warnings.push(`usage 里有未定义的字段 ${key}（平台会忽略）`);
  }
  if (!('totalTokens' in usage)) {
    return fail('RUNTIME_USAGE_MISSING', 'usage.totalTokens', '缺失',
      '缺少字段 usage.totalTokens：每次成功执行都必须回传总用量（正整数）');
  }
  const total = usage.totalTokens;
  if (!isJsonInteger(total) || total < 1) {
    return fail('RUNTIME_USAGE_INVALID', 'usage.totalTokens', String(total),
      'usage.totalTokens 必须是大于 0 的整数');
  }
  for (const field of USAGE_OPTIONAL_TOKEN_FIELDS) {
    const v = usage[field];
    if (v === undefined || v === null) continue;
    if (!isJsonInteger(v) || v < 0) {
      return fail('RUNTIME_USAGE_INVALID', `usage.${field}`, String(v), `usage.${field} 选填，给了必须是非负整数`);
    }
  }
  if (usage.invocationCount !== undefined && usage.invocationCount !== null) {
    if (!isJsonInteger(usage.invocationCount) || usage.invocationCount < 1) {
      return fail('RUNTIME_USAGE_INVALID', 'usage.invocationCount', String(usage.invocationCount),
        'usage.invocationCount 选填，给了必须是 ≥ 1 的整数');
    }
  }
  for (const [field, expected] of [['schemaVersion', '1.0'], ['status', 'FINAL'], ['estimated', false]]) {
    if (usage[field] !== undefined && usage[field] !== null && usage[field] !== expected) {
      return fail('RUNTIME_USAGE_INVALID', `usage.${field}`, String(usage[field]),
        `usage.${field} 选填，给了必须为 ${JSON.stringify(expected)}`);
    }
  }
  const cached = usage.cachedInputTokens;
  const prompt = usage.promptTokens;
  if (cached !== undefined && cached !== null && prompt !== undefined && prompt !== null && cached > prompt) {
    return fail('RUNTIME_USAGE_INVALID', 'usage.cachedInputTokens', String(cached),
      'usage 缓存 Token 超出输入总量');
  }
  return { code: null, field: null, received: null, message: null, warnings };
}

export function validateCompletion(positionType, envelope) {
  if (!POSITION_TO_SCHEMA[positionType]) throw new Error('Unsupported registered positionType');
  const shape = checkEnvelopeShape(envelope);
  const usage = checkUsage(envelope);
  const channel = readSchema('pull-channel.json');
  const transport = validateAgainstChannelSchema(channel, 'pull', envelope);
  const business = envelope && typeof envelope === 'object' ? {
    payload_result: envelope.payload_result,
    payload_info: envelope.payload_info,
    contract_version: envelope.contract_version,
  } : envelope;
  const role = validateAgainstPositionSchema(roleSchema(positionType), business);
  const problems = [...shape.problems];
  if (usage.code) problems.push(usage.message);
  for (const e of transport.errors) problems.push(`通道契约：${e}`);
  for (const e of role.errors) problems.push(`岗位契约：${e}`);
  return { ok: problems.length === 0, problems, shape, usage, transport, role };
}
