#!/usr/bin/env node
// Claude Code hook entry point. Configure in .claude/settings.json for the
// PreToolUse, PostToolUse and Stop events (see examples/claude-code-settings.json).
// Reads the hook JSON payload on stdin. Exit 0 = allow; exit 2 = block, with the
// reason on stderr (Claude Code shows it to the model so it can explain/retry).
// Config: $HISTOR_CONFIG or ./.histor/histor.config.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadHistorConfig, openLedger, draftReceipt, loadIssuerKey, loadCommitmentKey, commit, loadPolicy,
  evaluatePolicy, scanForSecrets, requestApproval, findValidApproval, consumeApproval, nowRfc3339,
  normalizeAnthropicUsage, addBuckets, emptyBuckets, priceUsage, sumAmounts,
} from '@sinewslink/histor-core';

const SOFTWARE = { name: 'histor-claude-hook', version: '0.2.0' };

// A broken evidence hook must be loud but must not silently brick the session:
// exit 1 is a non-blocking error in Claude Code (shown to the user). Set
// "fail_mode": "closed" in the policy to block all tool use when evidence fails.
process.on('uncaughtException', (e) => {
  process.stderr.write(`[SL Histor] evidence hook error: ${e.message}\n`);
  process.exit(process.env.HISTOR_FAIL_CLOSED === '1' ? 2 : 1);
});

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); }
catch { process.exit(0); } // never break the developer's session on malformed input

const cfgPath = process.env.HISTOR_CONFIG || path.resolve(input.cwd || '.', '.histor/histor.config.json');
if (!fs.existsSync(cfgPath)) process.exit(0);
const config = loadHistorConfig(cfgPath);
const issuerKey = config.signer ? null : loadIssuerKey(config.keys_dir); // signer daemon keeps the key out of this process
const ck = loadCommitmentKey(config.keys_dir);
const policy = config.policy ? loadPolicy(config.policy) : { policy_id: 'none', version: '0', rules: [], default: { decision: 'allow', consequence: 'low' } };
const sessionId = input.session_id || 'unknown-session';
const ledger = openLedger(config, { streamId: `claude-code-${sessionId}`, issuerKey });
const keyId = config.signer ? (await ledger.ping()).key_id : issuerKey.keyId;
const done = (code) => { ledger.close(); process.exit(code); };

// mcp__<server>__<tool> -> server/tool; built-ins (Bash, Edit, Write, WebFetch…) -> claude-code/<Tool>
const [server, tool] = (() => {
  const n = input.tool_name || '';
  const m = n.match(/^mcp__(.+?)__(.+)$/);
  return m ? [m[1], m[2]] : ['claude-code', n];
})();
const args = input.tool_input ?? {};

const common = {
  issuer: { type: 'claude-code-hook', software: SOFTWARE, host: os.hostname(), key_id: keyId },
  tenant: config.tenant || null,
  principal: config.principal,
  agent: { agent_id: config.agent?.agent_id || 'claude-code', name: config.agent?.name || 'Claude Code', owner: config.agent?.owner || null, framework: 'claude-code', model: null },
  session: { session_id: sessionId, protocol: 'claude-code-hooks', cwd_commitment: input.cwd ? commit(input.cwd, ck.key, ck.keyId) : null },
  trace: { tool_use_id: input.tool_use_id || null },
};

function actionBlock(evald, binding) {
  return {
    category: categorize(server, tool),
    tool: { protocol: server === 'claude-code' ? 'claude-code-builtin' : 'mcp', server_name: server, tool_name: tool },
    input: { commitment: commit(args, ck.key, ck.keyId), size_bytes: Buffer.byteLength(JSON.stringify(args)), secret_scan: scanForSecrets(args) },
    payload_commitment: binding,
    consequence: evald.consequence,
    reversibility: evald.reversibility,
  };
}
const authBlock = (evald) => ({ decision: evald.decision, rule_id: evald.rule_id, allowed_by_default: !!evald.allowed_by_default, policy: evald.policy, evaluated_at: nowRfc3339(), enforcer: { type: 'claude-code-hook', key_id: keyId } });

function categorize(srv, t) {
  if (srv !== 'claude-code') return 'tool_call';
  return ({ Bash: 'code_exec', Edit: 'file_write', MultiEdit: 'file_write', Write: 'file_write', NotebookEdit: 'file_write', Read: 'data_read', Glob: 'data_read', Grep: 'data_read', WebFetch: 'network_request', WebSearch: 'network_request', Task: 'delegation' })[t] || 'tool_call';
}

const ev = input.hook_event_name;
if (ev === 'PreToolUse') {
  const evald = evaluatePolicy(policy, { server, tool, args });
  const binding = commit({ server, tool, arguments: args }, ck.key, ck.keyId).value;
  let reason = null, approval = { required: evald.decision === 'require_approval', status: 'not_required' };
  if (evald.decision === 'deny') reason = `Blocked by policy rule ${evald.rule_id}${evald.reason ? ': ' + evald.reason : ''}`;
  if (evald.decision === 'require_approval') {
    const found = findValidApproval(config.approvals_dir, { payload_hash: binding, principalId: config.principal.subject_id, separationOfDuties: policy.approval?.separation_of_duties !== false });
    if (found.status !== 'approved') {
      const req = requestApproval(config.approvals_dir, { payload_hash: binding, server, tool, arguments: args, principal: config.principal, agent_id: common.agent.agent_id, rule_id: evald.rule_id, consequence: evald.consequence });
      approval = { required: true, status: { denied: 'denied', sod_violation: 'rejected_sod', expired_or_consumed: 'expired_or_consumed' }[found.status] || 'pending', request_id: req.request_id };
      reason = `Human approval required (${evald.consequence} consequence, rule ${evald.rule_id}). Ask the user to run: histor approve ${req.request_id} --approver <their id>. Then retry the identical call.`;
    }
  }
  if (reason) {
    await ledger.append(draftReceipt('denial', { ...common, action: actionBlock(evald, binding), authorization: authBlock(evald), approval, outcome: { status: 'denied', ended_at: nowRfc3339(), detail: reason } }));
    process.stderr.write(`[SL Histor] ${reason}\n`);
    done(2);
  }
  done(0);
}

if (ev === 'PostToolUse') {
  const evald = evaluatePolicy(policy, { server, tool, args });
  const binding = commit({ server, tool, arguments: args }, ck.key, ck.keyId).value;
  let approval = { required: evald.decision === 'require_approval', status: 'not_required' }, rec = null;
  if (evald.decision === 'require_approval') {
    const found = findValidApproval(config.approvals_dir, { payload_hash: binding, principalId: config.principal.subject_id, separationOfDuties: policy.approval?.separation_of_duties !== false });
    if (found.status === 'approved') {
      rec = found.approval;
      approval = { required: true, status: 'approved', approval_id: rec.approval_id, request_id: rec.request_id, approvers: [{ approver: rec.approver, method: rec.method, decision: 'approved', decided_at: rec.decided_at, expires_at: rec.expires_at, decision_latency_ms: rec.decision_latency_ms, approved_payload_commitment: rec.payload_hash }], quorum: { required: 1, obtained: 1 } };
    } else approval = { required: true, status: 'bypassed' }; // executed without a valid approval: the evidence must say so
  }
  const resp = input.tool_response;
  const isErr = resp && typeof resp === 'object' && (resp.is_error === true || resp.isError === true || resp.success === false);
  const sealed = await ledger.append(draftReceipt('action', {
    ...common, action: actionBlock(evald, binding), authorization: authBlock(evald), approval,
    outcome: { status: isErr ? 'tool_error' : 'success', ended_at: nowRfc3339(), output: { commitment: commit(resp ?? null, ck.key, ck.keyId), size_bytes: Buffer.byteLength(JSON.stringify(resp ?? null)), secret_scan: scanForSecrets(resp) } },
  }));
  if (rec) consumeApproval(config.approvals_dir, rec, sealed.receipt_id);
  done(0);
}

if (ev === 'Stop' || ev === 'SessionEnd' || ev === 'SubagentStop') {
  // Price token usage from the transcript. De-duplicate by message id: streamed
  // assistant messages can appear on several transcript lines.
  const tp = input.transcript_path;
  if (!tp || !fs.existsSync(tp)) {
    if (ev === 'SessionEnd') await ledger.append(draftReceipt('session.end', { ...common, exit: { reason: input.reason || null } }), { terminal: true, status: 'complete' });
    done(0);
  }
  const stateFile = path.join(config.ledger_dir, `claude-code-${sessionId}.cost-state.json`);
  const seen = new Set(fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).seen : []);
  const perModel = new Map();
  for (const line of fs.readFileSync(tp, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const msg = e.message;
    if (!msg?.usage || !msg.model) continue;
    const id = msg.id || e.requestId || e.uuid;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const b = normalizeAnthropicUsage(msg.usage);
    const cur = perModel.get(msg.model) || { buckets: emptyBuckets(), requests: 0 };
    perModel.set(msg.model, { buckets: addBuckets(cur.buckets, b), requests: cur.requests + 1 });
  }
  if (perModel.size) {
    const pricing = config.pricing ? JSON.parse(fs.readFileSync(path.resolve(path.dirname(cfgPath), config.pricing), 'utf8')) : null;
    const usage = [];
    for (const [model, { buckets, requests }] of perModel) {
      let priced = null, note = null;
      try { priced = pricing ? priceUsage(pricing, model, buckets) : null; if (!pricing) note = 'no_pricing_configured'; }
      catch { note = 'unpriced_model'; }
      usage.push({ provider: 'anthropic', model, requests, buckets, amount: priced?.amount ?? null, lines: priced?.lines ?? null, note });
    }
    const total = usage.every((u) => u.amount) ? sumAmounts(usage.map((u) => u.amount)) : null; // exact decimal, no floats
    await ledger.append(draftReceipt('model.call', {
      ...common,
      cost: {
        currency: pricing?.currency || null,
        usage,
        amount: total,
        pricing_ref: pricing ? { pricing_id: pricing.pricing_id, effective_date: pricing.effective_date } : null,
        method: 'list_price',
        source: 'claude-code-transcript',
        reconciliation: { status: 'unreconciled' },
      },
    }));
  }
  fs.writeFileSync(stateFile, JSON.stringify({ seen: [...seen] }));
  // SessionEnd closes the stream: a terminal receipt makes a missing ending visible.
  if (ev === 'SessionEnd') await ledger.append(draftReceipt('session.end', { ...common, exit: { reason: input.reason || null } }), { terminal: true, status: input.reason === 'other' ? 'interrupted' : 'complete' });
  done(0);
}
done(0);
