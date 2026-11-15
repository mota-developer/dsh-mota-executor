// Redaction rules for task input forwarded to the model.
//
// Source: creator-web/skills/mota-bind/references/runtime-adapter.md —
// recursive credential-key redaction plus removal of top-level credential
// entries; the executor never forwards the worker's own token.

const CREDENTIAL_KEYS = new Set([
  'authorization',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'apikey',
  'password',
  'cookie',
  'brokercredentials',
  'token',
  'agenttoken',
  'secret',
]);

export function isCredentialKey(key) {
  return CREDENTIAL_KEYS.has(String(key).toLowerCase().replace(/[_-]/g, ''));
}

/**
 * Return a copy of a task safe to hand to a model:
 * - drop entries whose name is a credential key from templateInputData;
 * - drop object properties named like credentials, recursively;
 * - replace any occurrence of the worker's own secrets in strings.
 */
export function scrubTask(task, secrets = []) {
  const secretList = secrets.filter((s) => typeof s === 'string' && s.length > 0);
  const scrub = (value) => {
    if (typeof value === 'string') {
      return secretList.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !isCredentialKey(key))
          .map(([key, val]) => [key, scrub(val)]),
      );
    }
    return value;
  };
  const copy = scrub({ ...task });
  if (Array.isArray(copy.templateInputData)) {
    copy.templateInputData = copy.templateInputData.filter((entry) => !isCredentialKey(entry?.name));
  }
  return copy;
}

/** The allow-listed slice of runtimeContext the executor may forward (runtime-adapter.md). */
const RUNTIME_CONTEXT_ALLOW = new Set([
  'isFinal', 'accountId', 'brokerType', 'brokerAccountId', 'account',
  'positions', 'todayOrders', 'observedAt', 'accountStateVersion',
]);

export function allowRuntimeContext(runtimeContext) {
  if (!runtimeContext || typeof runtimeContext !== 'object' || Array.isArray(runtimeContext)) return runtimeContext;
  return Object.fromEntries(
    Object.entries(runtimeContext).filter(([key]) => RUNTIME_CONTEXT_ALLOW.has(key)),
  );
}
