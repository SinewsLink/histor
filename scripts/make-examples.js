#!/usr/bin/env node
// Regenerates spec/examples/ with REAL signed receipts (verifiable against
// spec/examples/keyring.json). Run after any schema or emitter change:
//   node scripts/make-examples.js && npm test
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { initKeyDir, loadIssuerKey, loadCommitmentKey, Ledger, readLedger, draftReceipt, commit, priceUsage, normalizeAnthropicUsage, hashValue } from '@sinewslink/histor-core';
import { runDemo } from '../examples/demo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'spec/examples');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const demo = await runDemo({ quiet: true });
const keysDir = path.join(demo.w, 'keys');
const ik = loadIssuerKey(keysDir), ck = loadCommitmentKey(keysDir);
const pick = (pred) => demo.receipts.find(pred);
const save = (name, obj) => fs.writeFileSync(path.join(out, name), JSON.stringify(obj, null, 2) + '\n');

save('01-session-start.json', pick((r) => r.kind === 'session.start'));
save('02-agent-change-tool-surface.json', pick((r) => r.kind === 'agent.change'));
save('03-action-low-consequence.json', pick((r) => r.kind === 'action' && r.approval.status === 'not_required'));
save('04-denial-approval-pending.json', pick((r) => r.approval?.status === 'pending'));
save('05-denial-separation-of-duties.json', pick((r) => r.approval?.status === 'rejected_sod'));
save('06-action-approved-high-consequence.json', pick((r) => r.approval?.status === 'approved'));
save('07-denial-approval-already-used.json', pick((r) => r.approval?.status === 'expired_or_consumed'));

// Rich receipts exercising the rest of the schema, sealed on a second stream.
const l = new Ledger({ dir: path.join(demo.w, 'ledger'), streamId: 'examples-rich', issuerKey: ik });
const principal = { subject_id: 'founder@sinewslink.com', idp: 'oidc:login.sinewslink.com', role: 'engineering-lead', authenticated: true, auth: { method: 'oidc', assurance_level: 'AAL2', authenticated_at: new Date().toISOString() } };
const agent = { agent_id: 'sl-ops-agent', name: 'SinewsLink Ops Agent', version: '0.1.0', framework: 'claude-agent-sdk', owner: { subject_id: 'founder@sinewslink.com', team: 'engineering' }, model: { provider: 'anthropic', model_id: 'claude-sonnet-4', model_version: null, region: 'ca-central-1' }, system_prompt_commitment: commit('You are the SinewsLink ops agent…', ck.key, ck.keyId), config_hash: hashValue({ tools: ['github', 'aws'] }) };
const session = { session_id: 'sess-2026-10-10-001', protocol: 'agent-sdk', conversation_id: 'conv-77', run_id: 'run-12', step_index: 4 };
const issuer = { type: 'sdk', software: { name: 'histor-core', version: '0.1.0' }, host: os.hostname(), key_id: ik.keyId };
const tenant = { org_id: 'sinewslink', environment: 'prod', deployment_id: 'ops-cluster-ca', region: 'ca-central-1', data_residency: 'CA' };
const trace = { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7', parent_span_id: 'a3ce929d0e0e4736', traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' };

const pricing = JSON.parse(fs.readFileSync(path.join(root, 'pricing/anthropic.fixture.json'), 'utf8'));
const b = normalizeAnthropicUsage({ input_tokens: 2100, output_tokens: 1800, cache_read_input_tokens: 410000, cache_creation: { ephemeral_5m_input_tokens: 30000, ephemeral_1h_input_tokens: 8000 } });
const priced = priceUsage(pricing, 'claude-sonnet-4', b);
save('08-model-call-cost.json', l.append(draftReceipt('model.call', { issuer, tenant, principal, agent, session, trace,
  cost: { currency: 'USD', usage: [{ provider: 'anthropic', model: 'claude-sonnet-4', requests: 1, buckets: { ...b, reasoning_tokens: 600 }, amount: priced.amount, lines: priced.lines, service_tier: 'standard', region: 'ca-central-1', batch: false }],
    amount: priced.amount, method: 'list_price', pricing_ref: { pricing_id: pricing.pricing_id, effective_date: pricing.effective_date, hash: hashValue(pricing) },
    allocation: { cost_center: 'eng-ops', project: 'sl-aegis', customer: null, feature: 'incident-triage' }, source: 'sdk', reconciliation: { status: 'unreconciled' } } })));

save('09-delegation.json', l.append(draftReceipt('delegation', { issuer, tenant, principal, agent, session, trace,
  delegation: [
    { from: { type: 'human', id: 'founder@sinewslink.com' }, to: { type: 'agent', id: 'sl-ops-agent' }, scope: ['github:repo:read', 'github:pr:write', 'aws:ec2:describe'], granted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 8 * 3600e3).toISOString(), grant_ref: 'okta-grant-5521', depth: 0 },
    { from: { type: 'agent', id: 'sl-ops-agent' }, to: { type: 'agent', id: 'sl-ops-agent/subagent-log-reader' }, scope: ['aws:logs:read'], granted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600e3).toISOString(), grant_ref: null, depth: 1 },
  ] })));

save('10-credential-use-exposure.json', l.append(draftReceipt('credential.use', { issuer, tenant, principal, agent, session, trace,
  credentials: [{ credential_id: 'aws-role:arn:aws:iam::111122223333:role/sl-ops-readonly', type: 'cloud_role', issuer: 'aws-sts', scopes: ['ec2:Describe*', 'logs:Get*'], owner: { subject_id: 'platform-team', team: 'platform' }, granted_by: 'okta-grant-5521', issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600e3).toISOString(), just_in_time: true,
    exposure: { secret_material_in_model_context: false, placeholder_used: true, reached_sinks: [] } },
   { credential_id: 'github-pat:fp:7c1e', type: 'api_key', issuer: 'github', scopes: ['repo'], owner: { subject_id: 'founder@sinewslink.com' }, just_in_time: false,
    exposure: { secret_material_in_model_context: true, placeholder_used: false, reached_sinks: [{ type: 'prompt', location_commitment: commit('conv-77/turn-9', ck.key, ck.keyId), readable_by: 'model-provider' }, { type: 'log', location_commitment: commit('/var/log/agent/run-12.log', ck.key, ck.keyId), readable_by: 'ops-team' }] } }],
  risk: { signals: [{ type: 'secret_in_model_context', severity: 'high', source: 'histor-secret-scan', detail: 'real token (not a placeholder) entered prompt and a readable log' }], guardrails: [{ name: 'secret-scan', version: '0.1', result: 'flag' }] },
  compliance: { controls: [{ framework: 'SOC2', control_id: 'CC6.1' }, { framework: 'NIST-800-53', control_id: 'IA-5' }], retention: { policy: 'evidence-7y', delete_after: null, legal_hold: false } } })));

save('11-action-with-resources.json', l.append(draftReceipt('action', { issuer, tenant, principal, agent, session, trace,
  action: { category: 'deploy', tool: { protocol: 'mcp', server_name: 'github', server_version: '1.4.0', tool_name: 'merge_pull_request', tool_definition_hash: hashValue({ name: 'merge_pull_request' }) }, operation: 'merge', input: { commitment: commit({ pr: 482 }, ck.key, ck.keyId), size_bytes: 10, secret_scan: { secret_material_detected: false, types: [] }, classification: 'internal' }, payload_commitment: commit({ server: 'github', tool: 'merge_pull_request', arguments: { pr: 482 } }, ck.key, ck.keyId).value, intent: { stated_reason_commitment: commit('Hotfix for wildfire layer timeout', ck.key, ck.keyId), user_request_commitment: null }, consequence: 'high', reversibility: 'compensable', idempotency_key: 'merge-482' },
  resources: [{ type: 'git_repository', identifier_commitment: commit('sinewslink/aegis', ck.key, ck.keyId), uri: null, owner: 'sinewslink', classification: 'confidential', pii_categories: [], access_mode: 'write', records_affected: 1, jurisdiction: 'CA' }],
  authorization: { decision: 'require_approval', rule_id: 'prod-deploy', allowed_by_default: false, policy: { engine: 'opa', policy_id: 'sinewslink-prod', policy_version: '41', policy_hash: hashValue({ v: 41 }) }, evaluated_at: new Date().toISOString(), enforcer: { type: 'gateway', id: 'gw-ca-1', key_id: null } },
  approval: { required: true, status: 'approved', approval_id: '01a12000-0000-7000-8000-000000000001', request_id: '01a12000-0000-7000-8000-000000000000', approvers: [{ approver: { subject_id: 'ops-lead@sinewslink.com', idp: 'oidc:login.sinewslink.com', authenticated: true, auth: { method: 'passkey', assurance_level: 'AAL3' } }, method: 'slack', decision: 'approved', decided_at: new Date().toISOString(), expires_at: new Date(Date.now() + 900e3).toISOString(), decision_latency_ms: 48000, approved_payload_commitment: commit({ server: 'github', tool: 'merge_pull_request', arguments: { pr: 482 } }, ck.key, ck.keyId).value, evidence_ref: 'slack:C04OPS/p1728570000' }], quorum: { required: 1, obtained: 1 }, separation_of_duties: { required: true, satisfied: true } },
  outcome: { status: 'success', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), duration_ms: 2140, output: { commitment: commit({ merged: true, sha: 'abc123' }, ck.key, ck.keyId), size_bytes: 31, secret_scan: { secret_material_detected: false, types: [] } }, side_effects: [{ type: 'ci_pipeline_triggered', ref: 'gh-actions-run-99812' }] },
  links: { parent_receipt_id: null, approval_receipt_id: null, related: [] },
  extensions: { 'x-sinewslink': { change_ticket: 'OPS-4480' } } })));

save('12-gap-declared.json', l.append(draftReceipt('gap', { issuer, tenant, gap: { reason: 'ledger volume full 14:02-14:09 UTC; actions during window executed fail-open (low consequence only)', from_sequence: null, to_sequence: null, estimated_records_lost: 12, detected_at: new Date().toISOString() } })));

const rich = readLedger(path.join(demo.w, 'ledger', 'examples-rich.jsonl'));
const batch = (await import('@sinewslink/histor-core')).createBatch(rich, ik);
batch.anchors.push({ type: 'opentimestamps', ref: 'ots:pending (run `ots stamp` on a file containing the root)', root: batch.root, anchored_at: new Date().toISOString(), confirmed_at: null, verifier_hint: 'ots verify' });
save('13-batch-manifest.json', batch);
fs.copyFileSync(path.join(keysDir, 'keyring.json'), path.join(out, 'keyring.json'));
fs.writeFileSync(path.join(out, 'README.md'), `# Histor v0.1 examples\n\nEvery receipt here is real output, signed by the key in \`keyring.json\` and verifiable with\n\`histor verify\` once placed back in stream order. 01–07 come from the MCP proxy demo (stream \`demo-stream\`);\n08–12 exercise the remaining schema blocks (stream \`examples-rich\`); 13 is a Merkle batch over 08–12.\nRegenerate with \`node scripts/make-examples.js\`. Note: 13 carries an unsigned anchors array, which is appended after sealing by design.\n`);
console.log('examples written to', out);
