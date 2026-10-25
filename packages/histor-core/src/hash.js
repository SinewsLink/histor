import { createHash, createHmac, randomBytes } from 'node:crypto';
import { canonicalize } from './canonicalize.js';

export const HASH_PREFIX = 'sha256:';
export const GENESIS = null; // prev_hash of the first receipt in a stream

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function hashValue(value) {
  return HASH_PREFIX + sha256Hex(canonicalize(value));
}

// Keyed commitment: HMAC-SHA256(commitment_key, JCS(value)).
// Plain hashes of low-entropy values (e.g. {"approve": true}, an email, an
// account id) can be brute-forced. A tenant-held key prevents that, and the
// tenant can still prove a value to an auditor by disclosing it + the key id.
export function commit(value, key, keyId) {
  if (!key) throw new Error('commitment key required');
  const mac = createHmac('sha256', key).update(canonicalize(value)).digest('hex');
  return { alg: 'hmac-sha256', key_id: keyId, value: 'hmac-sha256:' + mac };
}

export function verifyCommitment(value, commitment, key) {
  const recomputed = commit(value, key, commitment.key_id);
  return recomputed.value === commitment.value;
}

export function newCommitmentKey() {
  return randomBytes(32);
}
