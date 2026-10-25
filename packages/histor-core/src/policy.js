import fs from 'node:fs';
import { hashValue } from './hash.js';
import { canonicalize } from './canonicalize.js';

// Minimal policy evaluator. SL Histor is NOT an enforcement product; this
// exists so the reference hook can (a) classify consequence, (b) gate
// high-consequence actions on a bound human approval, and (c) record exactly
// which policy version made the call. Production deployments will usually
// ingest the decision from their gateway/OPA/Cedar instead — the receipt
// schema is the same either way.

const glob = (p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');

export function loadPolicy(file) {
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  policy._hash = hashValue(stripPrivate(policy));
  return policy;
}

function stripPrivate(p) { const { _hash, ...rest } = p; return rest; }

export function evaluatePolicy(policy, { server, tool, args }) {
  const ref = { engine: 'histor-reference', policy_id: policy.policy_id, policy_version: policy.version, policy_hash: policy._hash ?? hashValue(stripPrivate(policy)) };
  for (const rule of policy.rules || []) {
    const m = rule.match || {};
    if (m.server && !glob(m.server).test(server || '')) continue;
    if (m.tool && !glob(m.tool).test(tool || '')) continue;
    if (m.args_regex && !new RegExp(m.args_regex, 'i').test(canonicalize(args ?? {}))) continue;
    const decision = rule.decision === 'deny' ? 'deny' : rule.approval === 'required' ? 'require_approval' : 'allow';
    return {
      decision, rule_id: rule.id, flag: !!rule.flag,
      consequence: rule.consequence || policy.default?.consequence || 'low',
      reversibility: rule.reversibility || 'unknown',
      reason: rule.reason || null,
      policy: ref,
    };
  }
  const d = policy.default || {};
  return { decision: d.decision === 'deny' ? 'deny' : 'allow', rule_id: '(default)', consequence: d.consequence || 'low', reversibility: d.reversibility || 'unknown', reason: null, policy: ref, allowed_by_default: true };
}

export function failClosed(policy, consequence) {
  const mode = policy.fail_mode || 'closed_for_high';
  if (mode === 'closed') return true;
  if (mode === 'open') return false;
  return consequence === 'high' || consequence === 'critical';
}
