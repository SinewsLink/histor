import { merkleRoot, inclusionProof, verifyInclusion } from './merkle.js';
import { hashValue } from './hash.js';
import { signDigest, verifyDigest, DOMAIN } from './sign.js';
import { uuidv7, nowRfc3339 } from './ids.js';

// A batch commits to a contiguous range of one stream. Anchoring the batch root
// (OpenTimestamps, a transparency log, RFC 3161 TSA, or an internal log for
// air-gapped sites) proves the whole range existed, unaltered, at that time —
// including against the issuer itself.
export function createBatch(receipts, issuerKey) {
  if (!receipts.length) throw new Error('empty batch');
  const streamId = receipts[0].chain.stream_id;
  for (let i = 1; i < receipts.length; i++) {
    if (receipts[i].chain.stream_id !== streamId) throw new Error('batch spans multiple streams');
    if (receipts[i].chain.sequence !== receipts[i - 1].chain.sequence + 1) throw new Error('batch range not contiguous');
  }
  const hashes = receipts.map((r) => r.seal.content_hash);
  const body = {
    histor_version: '0.1',
    batch_id: uuidv7(),
    created_at: nowRfc3339(),
    stream_id: streamId,
    first_sequence: receipts[0].chain.sequence,
    last_sequence: receipts[receipts.length - 1].chain.sequence,
    tree_size: hashes.length,
    tree_alg: 'rfc9162-sha256',
    root: merkleRoot(hashes),
    last_content_hash: hashes[hashes.length - 1],
  };
  const digest = hashValue(body);
  return {
    ...body,
    seal: { content_hash: digest, sig_alg: 'ed25519', key_id: issuerKey.keyId, signature: signDigest(DOMAIN.batch, digest, issuerKey.privatePem) },
    anchors: [],
  };
}

export function proofFor(receipts, batch, receiptId) {
  const idx = receipts.findIndex((r) => r.receipt_id === receiptId);
  if (idx < 0) throw new Error('receipt not in batch');
  return {
    batch_id: batch.batch_id,
    root: batch.root,
    tree_size: batch.tree_size,
    leaf_index: idx,
    audit_path: inclusionProof(receipts.map((r) => r.seal.content_hash), idx),
  };
}

export function verifyBatch(batch, publicPemByKeyId) {
  const { seal, anchors, ...body } = batch;
  const errors = [];
  if (hashValue(body) !== seal.content_hash) errors.push('batch body altered');
  const pub = publicPemByKeyId[seal.key_id];
  if (!pub || !verifyDigest(DOMAIN.batch, seal.content_hash, seal.signature, pub)) errors.push('batch signature invalid');
  return errors;
}

export function verifyProof(receipt, proof) {
  return verifyInclusion(receipt.seal.content_hash, proof.leaf_index, proof.tree_size, proof.audit_path, proof.root);
}
