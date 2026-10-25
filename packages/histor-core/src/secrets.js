// Secret detection for tool inputs/outputs. Receipts must NEVER contain secret
// material; they record that a credential was used (by id), and whether secret
// material reached the model context or a readable sink.
const PATTERNS = [
  ['anthropic_api_key', /sk-ant-[A-Za-z0-9_\-]{20,}/],
  ['openai_api_key', /sk-(proj-)?[A-Za-z0-9_\-]{20,}/],
  ['aws_access_key_id', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['slack_token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['google_api_key', /\bAIza[0-9A-Za-z_\-]{35}\b/],
  ['stripe_secret', /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/],
  ['private_key_block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['bearer_header', /\b[Bb]earer\s+[A-Za-z0-9._\-]{20,}/],
];
const PLACEHOLDER = /^(\$\{?[A-Z0-9_]+\}?|<[^>]+>|\*{3,}|x{6,}|REDACTED|changeme|your[-_ ]?api[-_ ]?key)$/i;

export function scanForSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const findings = [];
  for (const [type, re] of PATTERNS) if (re.test(text)) findings.push(type);
  return { secret_material_detected: findings.length > 0, types: [...new Set(findings)] };
}

export function isPlaceholder(s) {
  return typeof s === 'string' && PLACEHOLDER.test(s.trim());
}
