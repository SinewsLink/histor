#!/usr/bin/env node
// Deterministic Histor conformance vectors: fixed keys, ids and timestamps.
// Every implementation (JS today, Python/Go later) MUST accept the positive
// stream and MUST reject every negative case for the stated reason.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { sealReceipt, keyIdFromPublicPem, canonicalize, hashValue } from '@sinewslink/histor-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keyFromSeed = (hexSeed) => {
  const der = Buffer.from('302e020100300506032b657004220420' + hexSeed, 'hex');
  const priv = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicPem = createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  return { privatePem: priv.export({ type: 'pkcs8', format: 'pem' }), publicPem, keyId: keyIdFromPublicPem(publicPem) };
};
const k1 = keyFromSeed('11'.repeat(32));
const k2 = keyFromSeed('22'.repeat(32));
const id = (n) => `0192c6f0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ts = (n) => `2026-10-18T12:00:${String(n).padStart(2, '0')}.000Z`;
const issuer = (k) => ({ type: 'sdk', software: { name: 'vector-gen', version: '0.1.0' }, host: null, key_id: k.keyId });
const base = (n, kind, k, extra = {}) => ({ histor_version: '0.1', receipt_id: id(n), kind, issued_at: ts(n), issuer: issuer(k), ...extra });
const session = { session_id: 'sess-vectors' };

const stream = [];
let prev = null;
const push = (body, key, opts = {}) => {
  const s = sealReceipt(body, { streamId: 'vectors', sequence: stream.length, prevHash: prev, issuerKey: key, ...opts });
  stream.push(s); prev = s.seal.content_hash; return s;
};
push(base(1, 'session.start', k1, { session }), k1);
push(base(2, 'gap', k1, { gap: { reason: 'vector: declared gap', detected_at: ts(2) } }), k1);
push(base(3, 'key.rotation', k1, { key_rotation: { new_key_id: k2.keyId, new_public_pem: k2.publicPem, signed_with: 'old', reason: 'scheduled' } }), k1);
push(base(4, 'gap', k2, { gap: { reason: 'vector: after rotation', detected_at: ts(4) } }), k2);
push(base(5, 'session.end', k2, { session }), k2, { terminal: true, status: 'complete' });

const clone = () => structuredClone(stream);
const neg = [];
const add = (name, receipts, reason, opts = {}) => neg.push({ name, reason, opts, receipts });
{ const s = clone(); s[1].gap.reason = 'edited'; add('edited_body', s, 'content_hash mismatch'); }
{ const s = clone(); s.splice(1, 1); add('deleted_receipt', s, 'sequence'); }
{ const s = clone(); [s[1], s[2]] = [s[2], s[1]]; add('reordered', s, 'sequence'); }
{ const s = clone(); s[3] = sealReceipt(base(4, 'gap', k1, { gap: { reason: 'vector: after rotation', detected_at: ts(4) } }), { streamId: 'vectors', sequence: 3, prevHash: s[2].seal.content_hash, issuerKey: k1 }); add('old_key_after_rotation', s, 'expected new key'); }
{ const s = clone(); const extra = sealReceipt(base(6, 'gap', k2, { gap: { reason: 'after end', detected_at: ts(6) } }), { streamId: 'vectors', sequence: 5, prevHash: s[4].seal.content_hash, issuerKey: k2 }); s.push(extra); add('receipt_after_terminal', s, 'receipt after terminal'); }
{ const s = clone().slice(0, 4); add('truncated_tail_with_witness', s, 'does not match out-of-band witness', { expectedLength: 5, expectedFinalHash: stream[4].seal.content_hash }); }
{ const s = clone(); s[2].seal.signature = s[1].seal.signature; add('swapped_signature', s, 'signature invalid'); }

const floatCase = { histor_version: '0.1', amount: 1.5 };
const out = {
  $comment: 'Histor v0.1 conformance vectors. Seeds are public test keys: NEVER use them for real signing.',
  keys: { k1: { seed_hex: '11'.repeat(32), key_id: k1.keyId, public_pem: k1.publicPem }, k2: { seed_hex: '22'.repeat(32), key_id: k2.keyId, public_pem: k2.publicPem } },
  keyring: { [k1.keyId]: k1.publicPem },
  canonicalization: [
    { name: 'key_order_and_escaping', input: { b: 1, a: 'x"y', c: [true, null] }, canonical: canonicalize({ b: 1, a: 'x"y', c: [true, null] }), content_hash: hashValue({ b: 1, a: 'x"y', c: [true, null] }) },
    { name: 'must_reject_float', input: floatCase, must_reject: true },
  ],
  positive: { receipts: stream, expect: { ok: true, end: 'complete' } },
  negative: neg,
};
fs.mkdirSync(path.join(root, 'spec/test-vectors'), { recursive: true });
fs.writeFileSync(path.join(root, 'spec/test-vectors/histor-v0.1-vectors.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote', stream.length, 'positive receipts and', neg.length, 'MUST-reject cases');
