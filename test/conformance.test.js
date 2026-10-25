import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verifyStream, canonicalize, hashValue, CanonicalizationError } from '@sinewslink/histor-core';
import { root, validators } from './helpers.js';

const V = JSON.parse(fs.readFileSync(path.join(root, 'spec/test-vectors/histor-v0.1-vectors.json'), 'utf8'));

test('conformance: canonicalization vectors', () => {
  for (const c of V.canonicalization) {
    if (c.must_reject) assert.throws(() => canonicalize(c.input), CanonicalizationError, c.name);
    else { assert.equal(canonicalize(c.input), c.canonical, c.name); assert.equal(hashValue(c.input), c.content_hash, c.name); }
  }
});

test('conformance: positive stream (rotation, gap, terminal) verifies', () => {
  const r = verifyStream(V.positive.receipts, V.keyring);
  assert.ok(r.ok, r.problems.join('\n'));
  assert.equal(r.end, V.positive.expect.end);
  assert.ok(verifyStream(V.positive.receipts, V.keyring, { expectedLength: 5, expectedFinalHash: V.positive.receipts[4].seal.content_hash }).ok);
});

test('conformance: every MUST-reject case is rejected for the stated reason', () => {
  for (const n of V.negative) {
    const r = verifyStream(n.receipts, V.keyring, n.opts);
    assert.ok(!r.ok, `${n.name} should fail`);
    assert.ok(r.problems.some((p) => p.includes(n.reason)), `${n.name}: expected "${n.reason}" in ${JSON.stringify(r.problems)}`);
  }
});

test('conformance: positive vector receipts are schema-valid', () => {
  const v = validators();
  for (const r of V.positive.receipts) assert.ok(v.receipt(r), JSON.stringify(v.receipt.errors));
});
