import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runDemo } from '../examples/demo.js';
import { root, validators } from './helpers.js';

test('MCP proxy end-to-end: receipts, approvals, SoD, binding, single-use, integrity, schema', async () => {
  const r = await runDemo({ quiet: true });
  const kinds = r.receipts.map((x) => `${x.kind}:${x.approval?.status ?? ''}`);
  assert.deepEqual(kinds, [
    'session.start:', 'agent.change:', 'action:not_required',
    'denial:pending', 'denial:rejected_sod', 'action:approved', 'denial:pending', 'denial:expired_or_consumed', 'session.end:',
  ]);
  assert.ok(r.verify.ok); assert.ok(!r.tampered.ok); assert.ok(!r.deleted.ok); assert.ok(r.proofOk);
  assert.ok(Number(r.naive) > 3 * Number(r.correct));
  const v = validators();
  for (const rec of r.receipts) assert.ok(v.receipt(rec), JSON.stringify(v.receipt.errors, null, 1));
  assert.ok(v.keyring(JSON.parse(fs.readFileSync(path.join(r.w, 'keys/keyring.json'), 'utf8'))));
  for (const l of fs.readFileSync(path.join(r.w, 'approvals/decisions.jsonl'), 'utf8').split('\n').filter(Boolean)) assert.ok(v.decision(JSON.parse(l)), JSON.stringify(v.decision.errors));
  const approved = r.receipts.find((x) => x.approval?.status === 'approved');
  assert.equal(approved.approval.approvers[0].approver.subject_id, 'ops-lead@sinewslink.com');
  assert.equal(approved.approval.approvers[0].approved_payload_commitment, approved.action.payload_commitment);
  assert.ok(!JSON.stringify(r.receipts).includes('r-1002'), 'tool arguments must never appear in plaintext');
});

test('tool-surface drift between sessions is recorded as a high-consequence agent.change', async () => {
  const first = await runDemo({ quiet: true });
  process.env.DEMO_TOOL_DRIFT = '1';
  try {
    const { spawnSync } = await import('node:child_process');
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 't' } } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n';
    spawnSync(process.execPath, [path.join(root, 'packages/mcp-proxy/bin/histor-mcp-proxy.js'), '--config', path.join(first.w, 'histor.config.json'), '--', process.execPath, path.join(root, 'examples/demo-mcp-server.js')], { input: init, env: process.env });
    const files = fs.readdirSync(path.join(first.w, 'ledger')).filter((f) => f.startsWith('demo-stream.') && f.endsWith('.jsonl'));
    assert.equal(files.length, 2, 'one stream per session');
    const lines = files.flatMap((f) => fs.readFileSync(path.join(first.w, 'ledger', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    const change = lines.filter((l) => l.kind === 'agent.change').pop();
    assert.equal(change.change.type, 'tool_surface_changed');
    assert.deepEqual(change.change.diff.changed, ['get_record']);
  } finally { delete process.env.DEMO_TOOL_DRIFT; }
});

test('pricing fixture and batch manifest match their schemas', async () => {
  const v = validators();
  assert.ok(v.pricing(JSON.parse(fs.readFileSync(path.join(root, 'pricing/anthropic.fixture.json'), 'utf8'))), JSON.stringify(v.pricing.errors));
  const { createBatch, readLedger, loadIssuerKey } = await import('@sinewslink/histor-core');
  const r = await runDemo({ quiet: true });
  const f = fs.readdirSync(path.join(r.w, 'ledger')).find((x) => x.startsWith('demo-stream.') && x.endsWith('.jsonl'));
  const b = createBatch(readLedger(path.join(r.w, 'ledger', f)), loadIssuerKey(path.join(r.w, 'keys')));
  assert.ok(v.batch(b), JSON.stringify(v.batch.errors));
});

test('spec/examples are schema-valid and signatures verify against the published keyring', async () => {
  const { verifyReceiptSeal, verifyBatch, loadKeyring } = await import('@sinewslink/histor-core');
  const dir = path.join(root, 'spec/examples');
  const keys = loadKeyring(path.join(dir, 'keyring.json'));
  const v = validators();
  for (const f of fs.readdirSync(dir).filter((f) => /^\d\d-.*\.json$/.test(f))) {
    const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (f.includes('batch')) { assert.ok(v.batch(o), f + JSON.stringify(v.batch.errors)); assert.deepEqual(verifyBatch(o, keys), [], f); continue; }
    assert.ok(v.receipt(o), f + ' ' + JSON.stringify(v.receipt.errors, null, 1));
    assert.deepEqual(verifyReceiptSeal(o, keys), [], f);
  }
});
