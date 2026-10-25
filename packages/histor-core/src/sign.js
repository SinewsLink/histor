import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { sha256Hex } from './hash.js';

// Domain separation: a signature over an Histor receipt can never be replayed as a
// signature over anything else (approvals, batches, other protocols).
export const DOMAIN = {
  receipt: 'HISTOR-v0.1/receipt\n',
  approval: 'HISTOR-v0.1/approval\n',
  batch: 'HISTOR-v0.1/batch\n',
};

export function generateIssuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicPem: pubPem,
    keyId: keyIdFromPublicPem(pubPem),
  };
}

export function keyIdFromPublicPem(publicPem) {
  const der = createPublicKey(publicPem).export({ type: 'spki', format: 'der' });
  return 'ed25519:' + sha256Hex(der).slice(0, 32);
}

export function signDigest(domain, digest, privatePem) {
  const sig = sign(null, Buffer.from(domain + digest), createPrivateKey(privatePem));
  return sig.toString('base64url');
}

export function verifyDigest(domain, digest, signatureB64u, publicPem) {
  try {
    return verify(null, Buffer.from(domain + digest), createPublicKey(publicPem), Buffer.from(signatureB64u, 'base64url'));
  } catch {
    return false;
  }
}
