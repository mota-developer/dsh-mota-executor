import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  POSITION_TO_SCHEMA,
  checkEnvelopeShape,
  checkUsage,
  payloadSchemaText,
  roleSchema,
  validateCompletion,
} from '../lib/schema.js';
import { assembleCompletion, parseAgentJson } from '../lib/output.js';

const usage = { totalTokens: 120, promptTokens: 100, completionTokens: 20, invocationCount: 1 };

function validEnvelope(language = 'zh') {
  return assembleCompletion(
    'FUNDAMENTAL_ANALYST',
    { payload_result: { assessments: [] }, payload_info: '本轮没有可评估的标的。' },
    usage,
    language,
  );
}

test('every bundled role schema loads and exposes a self-contained payload_result', () => {
  for (const positionType of Object.keys(POSITION_TO_SCHEMA)) {
    const doc = roleSchema(positionType);
    assert.ok(doc.$defs?.motaAgentPayloadV1, `${positionType}: motaAgentPayloadV1 missing`);
    assert.ok(doc.$defs?.payloadResult, `${positionType}: payloadResult missing`);
    assert.doesNotThrow(() => JSON.parse(payloadSchemaText(positionType)), `${positionType}: schema text is not JSON`);
  }
});

test('assembleCompletion builds the four-key envelope and appends the Chinese disclaimer', () => {
  const envelope = validEnvelope();
  assert.deepEqual(Object.keys(envelope).sort(), ['contract_version', 'payload_info', 'payload_result', 'usage']);
  assert.equal(envelope.contract_version, 'V2');
  assert.ok(envelope.payload_info.endsWith('AI 生成的研究参考，不构成投资建议。'));
  assert.equal(envelope.usage.totalTokens, 120);
  assert.equal(envelope.usage.promptTokens, 100);
  assert.equal(envelope.usage.status, 'FINAL');
  assert.equal(validateCompletion('FUNDAMENTAL_ANALYST', envelope).ok, true);
});

test('assembleCompletion uses the English disclaimer for language=en', () => {
  const envelope = validEnvelope('en');
  assert.ok(envelope.payload_info.endsWith('AI-generated research for reference only, not investment advice.'));
});

test('assembleCompletion refuses business objects with extra or missing keys', () => {
  assert.throws(() => assembleCompletion('STRATEGIST', { payload_result: {} }, usage), /业务对象只能包含/);
  assert.throws(
    () => assembleCompletion('STRATEGIST', { payload_result: {}, payload_info: 'x', contract_version: 'V2', extra: 1 }, usage),
    /业务对象只能包含/,
  );
});

test('real usage is mandatory and totalTokens must be a positive integer', () => {
  assert.throws(() => assembleCompletion('STRATEGIST', { payload_result: {}, payload_info: 'x' }, undefined), /RUNTIME_USAGE_MISSING/);
  assert.throws(
    () => assembleCompletion('STRATEGIST', { payload_result: {}, payload_info: 'x' }, { ...usage, totalTokens: 0 }),
    /totalTokens/,
  );
});

test('checkUsage rejects cached tokens above prompt tokens and unknown status values', () => {
  const base = { usage: { ...usage, cachedInputTokens: 50 } };
  assert.equal(checkUsage(base).code, null);
  assert.equal(checkUsage({ usage: { ...usage, cachedInputTokens: 101 } }).code, 'RUNTIME_USAGE_INVALID');
  assert.equal(checkUsage({ usage: { ...usage, status: 'PARTIAL' } }).code, 'RUNTIME_USAGE_INVALID');
  assert.equal(checkUsage({ usage: { ...usage, totalTokens: 1.5 } }).code, 'RUNTIME_USAGE_INVALID');
  assert.equal(checkUsage({ usage: { ...usage, invocationCount: 0 } }).code, 'RUNTIME_USAGE_INVALID');
  assert.equal(checkUsage({}).code, 'RUNTIME_USAGE_MISSING');
});

test('checkEnvelopeShape flags missing keys, blank payload_info and extra top-level keys', () => {
  const problems = (sample) => checkEnvelopeShape(sample).problems;
  assert.ok(problems({ payload_result: {} }).some((p) => p.includes('payload_info')));
  assert.ok(problems({ payload_result: {}, payload_info: '  ', contract_version: 'V2' }).some((p) => p.includes('payload_info')));
  assert.ok(problems({ payload_result: {}, payload_info: 'x', contract_version: 'V2', runId: 'r' }).some((p) => p.includes('runId')));
  assert.deepEqual(problems({ payload_result: {}, payload_info: 'x', contract_version: 'V2' }), []);
});

test('validateCompletion rejects a payload_result that violates the role schema', () => {
  const envelope = validEnvelope();
  envelope.payload_result = { assessments: [{ symbol: 'AAPL.US', rating: 'BUY', fair_value: 200, reasoning: 'ok', unknown: true }] };
  const result = validateCompletion('FUNDAMENTAL_ANALYST', envelope);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('unknown')));
});

test('validateCompletion rejects a payload_info that only holds whitespace after wrapping', () => {
  const envelope = validEnvelope();
  envelope.payload_info = '   ';
  const result = validateCompletion('FUNDAMENTAL_ANALYST', envelope);
  assert.equal(result.ok, false);
});

test('parseAgentJson accepts raw JSON, fenced JSON and prose around JSON', () => {
  const body = '{"payload_result":{},"payload_info":"x"}';
  assert.deepEqual(parseAgentJson(body), { payload_result: {}, payload_info: 'x' });
  assert.deepEqual(parseAgentJson('```json\n' + body + '\n```'), { payload_result: {}, payload_info: 'x' });
  assert.deepEqual(parseAgentJson('结果如下：' + body + ' 请查收'), { payload_result: {}, payload_info: 'x' });
  assert.throws(() => parseAgentJson('not json'), /不是合法 JSON/);
});
