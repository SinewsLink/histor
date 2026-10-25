#!/usr/bin/env node
// End-to-end demo: an "agent" (this script, acting as an MCP client) talks to a
// real MCP server through the SL Histor proxy. Shows: receipts for every call,
// a destructive call blocked until a DIFFERENT human approves that exact payload,
// single-use approvals, tool-surface tracking, chain verification, tamper
// detection, Merkle sealing + inclusion proof, and correct vs naive cost.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  initKeyDir, loadIssuerKey, loadKeyring, readLedger, verifyStream, createBatch, proofFor, verifyProof,
  listPending, decide, priceUsage, naivePrice, normalizeAnthropicUsage,
} from '@sinewslink/histor-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
export async function runDemo({ quiet = false, workDir } = {}) {
  const say = (...a) => { if (!quiet) console.log(...a); };
  const w = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'histor-demo-'));
  initKeyDir(path.join(w, 'keys'));
  const cfg = JSON.parse(fs.readFileSync(path.join(here, 'histor.config.example.json'), 'utf8'));
  cfg.policy = path.join(here, 'policy.example.json');
  cfg.pricing = path.join(root, 'pricing/anthropic.fixture.json');
  cfg.stream_id = 'demo-stream';
  fs.writeFileSync(path.join(w, 'histor.config.json'), JSON.stringify(cfg, null, 2));

  const proxy = spawn(process.execPath, [path.join(root, 'packages/mcp-proxy/bin/histor-mcp-proxy.js'), '--config', path.join(w, 'histor.config.json'), '--', process.execPath, path.join(here, 'demo-mcp-server.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HISTOR_PRINCIPAL: 'agent-operator@sinewslink.com' } });
  proxy.stderr.on('data', (d) => { if (!quiet) process.stderr.write(d); });
  const waiting = new Map();
  readline.createInterface({ input: proxy.stdout }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  let id = 0;
  const rpc = (method, params) => new Promise((res) => { const i = ++id; waiting.set(i, res); proxy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return r.result?.content?.[0]?.text; };

  await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'demo-agent', version: '0.1' }, capabilities: {} });
  proxy.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await rpc('tools/list', {});
  say('\n1) low-consequence read:', await call('list_records', {}));
  say('\n2) destructive call, no approval yet:\n  ', await call('delete_record', { id: 'r-1002' }));
  const [pending] = listPending(path.join(w, 'approvals'));
  say(`\n3) the agent operator tries to approve their own request (separation of duties)…`);
  decide(path.join(w, 'approvals'), { requestId: pending.request_id, approver: { subject_id: 'agent-operator@sinewslink.com', idp: 'demo' }, decision: 'approved' });
  say('  ', await call('delete_record', { id: 'r-1002' }));
  const [pending2] = listPending(path.join(w, 'approvals'));
  say(`\n4) a different human (ops lead) approves request ${pending2.request_id.slice(0, 8)}… for that exact payload`);
  decide(path.join(w, 'approvals'), { requestId: pending2.request_id, approver: { subject_id: 'ops-lead@sinewslink.com', idp: 'demo' }, decision: 'approved', reason: 'customer requested erasure, ticket OPS-4471' });
  say('   retry:', await call('delete_record', { id: 'r-1002' }));
  say('\n5) agent swaps the payload (approve A, execute B):\n  ', await call('delete_record', { id: 'r-1001' }));
  say('\n6) agent replays the original approved call (single-use):\n  ', await call('delete_record', { id: 'r-1002' }));
  proxy.stdin.end();
  await new Promise((r) => proxy.on('exit', r));

  const file = path.join(w, 'ledger', fs.readdirSync(path.join(w, 'ledger')).find((f) => f.startsWith('demo-stream.') && f.endsWith('.jsonl')));
  const receipts = readLedger(file);
  const keyring = loadKeyring(path.join(w, 'keys'));
  const v = verifyStream(receipts, keyring);
  say(`\n7) ledger: ${receipts.length} receipts, chain + signatures valid: ${v.ok}`);
  for (const r of receipts) say(`   ${String(r.chain.sequence).padStart(2)} ${r.kind.padEnd(13)} ${r.action ? r.action.tool.tool_name.padEnd(14) : ''.padEnd(14)} ${r.outcome?.status ?? ''} ${r.approval?.status && r.approval.status !== 'not_required' ? '(approval: ' + r.approval.status + ')' : ''}`);

  const batch = createBatch(receipts, loadIssuerKey(path.join(w, 'keys')));
  const approved = receipts.find((r) => r.approval?.status === 'approved');
  const proof = proofFor(receipts, batch, approved.receipt_id);
  say(`\n8) Merkle batch root ${batch.root.slice(0, 23)}… (anchor this 32-byte value publicly)\n   inclusion proof for the approved delete verifies: ${verifyProof(approved, proof)}`);

  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const t = JSON.parse(lines[3]); t.issued_at = '2020-01-01T00:00:00.000Z'; lines[3] = JSON.stringify(t);
  const tampered = verifyStream(lines.map((l) => JSON.parse(l)), keyring);
  const deleted = verifyStream(lines.filter((_, i) => i !== 4).map((l) => JSON.parse(l)), keyring);
  say(`\n9) tamper tests: edited receipt detected: ${!tampered.ok} | deleted receipt detected: ${!deleted.ok}`);

  const pricing = JSON.parse(fs.readFileSync(path.join(root, 'pricing/anthropic.fixture.json'), 'utf8'));
  const usage = { input_tokens: 2_100, output_tokens: 1_800, cache_read_input_tokens: 410_000, cache_creation_input_tokens: 38_000 };
  const b = normalizeAnthropicUsage(usage);
  const correct = priceUsage(pricing, 'claude-sonnet-4', b).amount;
  const naive = naivePrice(pricing, 'claude-sonnet-4', b);
  say(`\n10) cost of one agent turn (heavy prompt caching): correct $${correct} vs naive $${naive} → naive is off by ${Math.round((Number(naive) / Number(correct) - 1) * 100)}%`);
  say(`\nwork dir: ${w}`);
  return { w, receipts, verify: v, tampered, deleted, proofOk: verifyProof(approved, proof), correct, naive };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runDemo();
