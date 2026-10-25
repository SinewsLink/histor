import { verifyReceiptSeal } from './receipt.js';

// Verifies one stream: every seal, the hash chain, sequence continuity, in-chain
// key rotation, terminal markers, retries, and (optionally) an out-of-band
// witness of the expected length / final hash. Detects editing, deletion,
// insertion, reordering, receipts-after-end, unannounced key changes and, with
// a witness, tail truncation.
//
// opts.expectedLength / opts.expectedFinalHash come from a record the attacker
// cannot also rewrite (an anchored batch, a checkpoint, the auditor's last copy).
export function verifyStream(receipts, publicPemByKeyId, opts = {}) {
  const problems = [];
  const warnings = [];
  let keys = { ...publicPemByKeyId };
  let prev = null;
  let activeKeyId = receipts[0]?.seal?.key_id ?? null;
  let terminalSeen = false;
  const idem = new Map();
  receipts.forEach((r, i) => {
    const where = `#${i} (${r.receipt_id ?? 'no id'})`;
    for (const e of verifyReceiptSeal(r, keys)) problems.push(`${where}: ${e}`);
    const c = r.chain || {};
    if (terminalSeen) problems.push(`${where}: receipt after terminal (stream was declared finished)`);
    if (i === 0) {
      if (c.sequence !== 0 && r.kind !== 'gap') warnings.push(`${where}: stream does not start at sequence 0 (partial export?)`);
    } else {
      if (c.stream_id !== prev.chain.stream_id) problems.push(`${where}: stream_id changed`);
      if (c.sequence !== prev.chain.sequence + 1) problems.push(`${where}: sequence ${c.sequence} follows ${prev.chain.sequence} (missing or reordered receipts)`);
      if (c.prev_hash !== prev.seal.content_hash) problems.push(`${where}: prev_hash does not match previous receipt (chain broken)`);
      if (r.issued_at < prev.issued_at) warnings.push(`${where}: issued_at earlier than previous receipt (clock skew?)`);
      const kid = r.seal?.key_id;
      const rotatedTo = prev.kind === 'key.rotation' ? prev.key_rotation?.new_key_id : null;
      if (rotatedTo) {
        if (kid !== rotatedTo) problems.push(`${where}: expected new key ${rotatedTo} after key.rotation, got ${kid}`);
        activeKeyId = rotatedTo;
      } else if (kid !== activeKeyId) {
        problems.push(`${where}: signing key changed to ${kid} without a key.rotation receipt`);
      }
    }
    // A rotation receipt, signed by the outgoing key, introduces the incoming key.
    if (r.kind === 'key.rotation' && r.key_rotation?.new_key_id && r.key_rotation.new_public_pem && !keys[r.key_rotation.new_key_id]) {
      keys = { ...keys, [r.key_rotation.new_key_id]: r.key_rotation.new_public_pem };
    }
    if (c.status && !c.terminal) problems.push(`${where}: chain.status without chain.terminal`);
    if (c.terminal) terminalSeen = true;
    const k = r.action?.idempotency_key;
    if (k) { if (idem.has(k)) warnings.push(`${where}: idempotency_key "${k}" repeats receipt #${idem.get(k)} (retry)`); else idem.set(k, i); }
    if (r.kind === 'gap') warnings.push(`${where}: issuer declared a gap: ${r.gap?.reason ?? 'no reason'}`);
    prev = r;
  });
  if (opts.expectedLength != null && receipts.length !== opts.expectedLength) problems.push(`length ${receipts.length} does not match out-of-band witness ${opts.expectedLength} (truncated or extended)`);
  if (opts.expectedFinalHash != null && prev?.seal?.content_hash !== opts.expectedFinalHash) problems.push('final content_hash does not match out-of-band witness (tail truncated or rewritten)');
  const last = receipts[receipts.length - 1];
  const end = !last ? 'empty' : last.chain?.terminal ? (last.chain.status || 'complete') : 'open';
  if (end === 'open' && opts.expectedLength == null && opts.expectedFinalHash == null) warnings.push('no terminal receipt and no out-of-band witness: a truncated tail would be undetectable (seal and anchor regularly, or pass expectedFinalHash)');
  if (end === 'interrupted') warnings.push('stream ended interrupted (signal or abort)');
  return { ok: problems.length === 0, count: receipts.length, end, problems, warnings };
}
