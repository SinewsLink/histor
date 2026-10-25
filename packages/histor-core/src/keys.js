import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { generateIssuerKey, keyIdFromPublicPem } from './sign.js';

// Key layout (dir): issuer.key (pkcs8 PEM, 0600), issuer.pub (spki PEM),
// commitment.key (32 random bytes, hex, 0600), keyring.json (published public keys
// with validity windows — verifiers need history to check rotated keys).
// rotate: true replaces only the signing key. The commitment key is NEVER
// rotated here, because every existing commitment and pending approval depends on it.
export function initKeyDir(dir, { rotate = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const k = generateIssuerKey();
  fs.writeFileSync(path.join(dir, 'issuer.key'), k.privatePem, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'issuer.pub'), k.publicPem);
  if (!rotate || !fs.existsSync(path.join(dir, 'commitment.key'))) {
    const commitmentKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
    fs.writeFileSync(path.join(dir, 'commitment.key'), Buffer.from(commitmentKey).toString('hex'), { mode: 0o600 });
  }
  const ringPath = path.join(dir, 'keyring.json');
  const ring = fs.existsSync(ringPath) ? JSON.parse(fs.readFileSync(ringPath, 'utf8')) : { histor_version: '0.1', keys: [] };
  for (const old of ring.keys) if (!old.not_after) { old.not_after = new Date().toISOString(); if (old.status === 'active') old.status = 'retired'; }
  ring.keys.push({ key_id: k.keyId, alg: 'ed25519', public_pem: k.publicPem, not_before: new Date().toISOString(), not_after: null, status: 'active' });
  fs.writeFileSync(ringPath, JSON.stringify(ring, null, 2));
  return k.keyId;
}

export function loadIssuerKey(dir) {
  const privatePem = fs.readFileSync(path.join(dir, 'issuer.key'), 'utf8');
  const publicPem = fs.readFileSync(path.join(dir, 'issuer.pub'), 'utf8');
  return { privatePem, publicPem, keyId: keyIdFromPublicPem(publicPem) };
}

export function loadCommitmentKey(dir) {
  const hex = fs.readFileSync(path.join(dir, 'commitment.key'), 'utf8').trim();
  const key = Buffer.from(hex, 'hex');
  // key id is a hash of the key, never a prefix of it
  return { key, keyId: 'ck:' + createHash('sha256').update(key).digest('hex').slice(0, 16) };
}

export function loadKeyring(fileOrDir) {
  const file = fs.statSync(fileOrDir).isDirectory() ? path.join(fileOrDir, 'keyring.json') : fileOrDir;
  const ring = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.fromEntries(ring.keys.filter((k) => k.status !== 'compromised').map((k) => [k.key_id, k.public_pem]));
}
