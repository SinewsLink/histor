import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { canonicalizeFull, arReceiptHash, arVerify, arVerifyChain, exportAgentReceipts, readLedger, loadIssuerKey } from '@sinewslink/histor-core';
import { runDemo } from '../examples/demo.js';
import { root } from './helpers.js';

const V = path.join(root, 'packages/histor-core/vendor/agent-receipts');
const load = (f) => JSON.parse(fs.readFileSync(path.join(V, f), 'utf8'));

test('RFC 8785: byte-for-byte match with all Agent Receipts canonicalisation vectors', () => {
  const v = load('canonicalization_vectors.json');
  for (const c of v.canonicalization_vectors) assert.equal(canonicalizeFull(c.input), c.canonical, c.name);
});

test('Agent Receipts receipt-hash vectors (null normalisation) match', () => {
  const v = load('canonicalization_vectors.json');
  const byName = Object.fromEntries(v.receipt_hash_vectors.map((c) => [c.name, c]));
  const expected = (c) => (c.expectedHash?.startsWith('SAME_AS_') ? expected(byName[c.expectedHash.slice(8)]) : c.expectedHash);
  let n = 0;
  for (const c of v.receipt_hash_vectors) if (c.expectedHash) { assert.equal(arReceiptHash(c.receipt), expected(c), c.name); n++; }
  assert.ok(n >= 5);
});

test('Histor verifies signed v0.5.0 receipts produced by the Agent Receipts SDKs', () => {
  const v = load('v050_vectors.json');
  for (const name of ['runtimeReceipt', 'extendedRuntimeReceipt', 'rootAgentReceipt']) {
    const vec = v[name];
    const res = arVerify(vec.receipt, v.keys.publicKey);
    assert.equal(res.valid, vec.expectedValid, name);
    assert.equal(res.hash, vec.expectedReceiptHash, name);
  }
});

test('a Histor stream exports to a schema-valid, signed, verifiable Agent Receipt chain', async () => {
  const require = createRequire(import.meta.url);
  const Ajv2020 = require('ajv/dist/2020.js'); const addFormats = require('ajv-formats');
  const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);
  ajv.addSchema(load('parameters-disclosure.schema.json'));
  const validate = ajv.compile(load('agent-receipt.schema.json'));
  const d = await runDemo({ quiet: true });
  const key = loadIssuerKey(path.join(d.w, 'keys'));
  const ars = exportAgentReceipts(d.receipts, { privatePem: key.privatePem, verificationMethod: 'did:web:sinewslink.com#histor-1', issuerId: 'did:web:sinewslink.com:histor:demo', operator: { id: 'did:web:sinewslink.com', name: 'SinewsLink Inc.' } });
  assert.ok(ars.length >= 5);
  for (const r of ars) assert.ok(validate(r), JSON.stringify(validate.errors, null, 1));
  assert.ok(arVerifyChain(ars, key.publicPem).ok);
  const approved = ars.find((r) => r.credentialSubject.authorization);
  assert.match(approved.credentialSubject.authorization.grant_ref, /^histor:approval:/);
  assert.equal(approved.credentialSubject.action.type, 'data.api.delete');
  assert.equal(approved.credentialSubject.action.risk_level, 'high');
  const tampered = structuredClone(ars); tampered[1].credentialSubject.outcome.status = 'success';
  assert.ok(!arVerifyChain(tampered, key.publicPem).ok || ars[1].credentialSubject.outcome.status === 'success');
});
