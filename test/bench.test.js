import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateIssuerKey, sealReceipt, draftReceipt, Ledger, commit, scanForSecrets } from '@sinewslink/histor-core';

// Overhead is measured, not asserted in marketing. Budgets are generous so CI
// runners pass; regressions of an order of magnitude fail the build.
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p99 = (a) => a.sort((x, y) => x - y)[Math.floor(a.length * 0.99)];

test('bench: per-receipt evidence cost (commit + scan + seal in memory) and durable append', () => {
  const key = generateIssuerKey(); const ck = Buffer.alloc(32, 7);
  const args = { id: 'r-1002', note: 'x'.repeat(200) };
  const mem = [];
  for (let i = 0; i < 2000; i++) {
    const t = process.hrtime.bigint();
    const body = draftReceipt('action', { action: { input: { commitment: commit(args, ck, 'ck:1'), secret_scan: scanForSecrets(args) } } });
    sealReceipt(body, { streamId: 'b', sequence: i, prevHash: null, issuerKey: key });
    mem.push(Number(process.hrtime.bigint() - t) / 1e3);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'histor-bench-'));
  const l = new Ledger({ dir, streamId: 'b', issuerKey: key });
  const disk = [];
  for (let i = 0; i < 200; i++) { const t = process.hrtime.bigint(); l.append(draftReceipt('gap', { gap: { reason: 'b', detected_at: 'x' } })); disk.push(Number(process.hrtime.bigint() - t) / 1e3); }
  const r = { in_memory_us: { p50: Math.round(median(mem)), p99: Math.round(p99(mem)) }, durable_append_us: { p50: Math.round(median(disk)), p99: Math.round(p99(disk)) } };
  console.log('# overhead', JSON.stringify(r));
  assert.ok(r.in_memory_us.p50 < 2000, `in-memory p50 ${r.in_memory_us.p50}µs exceeds 2ms budget`);
  assert.ok(r.durable_append_us.p50 < 50000, `durable append p50 ${r.durable_append_us.p50}µs exceeds 50ms budget`);
});
