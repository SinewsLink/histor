import { hashValue } from './hash.js';
import { signDigest, verifyDigest, DOMAIN } from './sign.js';
import { uuidv7, nowRfc3339 } from './ids.js';

export const HISTOR_VERSION = '0.1';

export const RECEIPT_KINDS = [
  'session.start', 'session.end',
  'action',            // a tool call / side-effecting operation attempted by an agent
  'model.call',        // an LLM inference (cost-bearing)
  'approval',          // a human decision bound to a payload hash
  'denial',            // an action blocked before execution
  'credential.use',    // a credential issued/used/exposed
  'delegation',        // authority handed from principal/agent to agent
  'policy.change',     // policy bundle activated/changed
  'agent.change',      // agent config / tool surface changed (e.g. tool description drift)
  'cost.reconciliation',
  'anchor',            // a Merkle root anchored externally
  'gap',               // issuer declares a known loss of records (honest gap > silent gap)
  'key.rotation',      // signed by the OUTGOING key; introduces the incoming key
];

// The signed body is the receipt minus `seal` and `proof`.
export function bodyOf(receipt) {
  const { seal, proof, ...body } = receipt;
  return body;
}

export function contentHash(receipt) {
  return hashValue(bodyOf(receipt));
}

export function draftReceipt(kind, fields = {}) {
  if (!RECEIPT_KINDS.includes(kind)) throw new Error(`unknown receipt kind: ${kind}`);
  return {
    histor_version: HISTOR_VERSION,
    receipt_id: uuidv7(),
    kind,
    issued_at: nowRfc3339(),
    ...fields,
  };
}

// Chain + seal: sets chain fields, computes content hash, signs it.
export function sealReceipt(receipt, { streamId, sequence, prevHash, issuerKey, terminal = false, status = null }) {
  // issuer.key_id always equals the sealing key (spec §4.1), whoever drafted the body.
  const issuer = { type: 'sdk', software: { name: 'histor-core', version: '0.2.0' }, ...(receipt.issuer || {}), key_id: issuerKey.keyId };
  receipt = { ...receipt, issuer };
  const chain = { stream_id: streamId, sequence, prev_hash: prevHash };
  if (terminal) { chain.terminal = true; chain.status = status || 'complete'; }
  const chained = { ...receipt, chain };
  const digest = contentHash(chained);
  return {
    ...chained,
    seal: {
      canonicalization: 'JCS-RFC8785-HISTOR',
      hash_alg: 'sha-256',
      content_hash: digest,
      sig_alg: 'ed25519',
      key_id: issuerKey.keyId,
      signature: signDigest(DOMAIN.receipt, digest, issuerKey.privatePem),
    },
  };
}

export function verifyReceiptSeal(receipt, publicPemByKeyId) {
  const errors = [];
  if (!receipt.seal) return ['missing seal'];
  const digest = contentHash(receipt);
  if (digest !== receipt.seal.content_hash) errors.push('content_hash mismatch (receipt body altered)');
  const pub = publicPemByKeyId[receipt.seal.key_id];
  if (!pub) errors.push(`unknown key_id ${receipt.seal.key_id}`);
  else if (!verifyDigest(DOMAIN.receipt, receipt.seal.content_hash, receipt.seal.signature, pub)) errors.push('signature invalid');
  return errors;
}
