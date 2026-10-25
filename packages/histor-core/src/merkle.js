import { createHash } from 'node:crypto';

// RFC 6962 / RFC 9162 Merkle tree. Leaves are receipt content hashes.
// Domain-separated: leaf = H(0x00 || data), node = H(0x01 || left || right),
// which prevents second-preimage attacks that plain Merkle trees allow.

const H = (...bufs) => createHash('sha256').update(Buffer.concat(bufs)).digest();
const LEAF = Buffer.from([0x00]);
const NODE = Buffer.from([0x01]);

export function leafHash(contentHash) {
  return H(LEAF, Buffer.from(contentHash, 'utf8'));
}

function largestPow2LessThan(n) {
  let k = 1;
  while (k << 1 < n) k <<= 1;
  return k;
}

function mth(leaves) {
  const n = leaves.length;
  if (n === 0) return H();
  if (n === 1) return leaves[0];
  const k = largestPow2LessThan(n);
  return H(NODE, mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

function path(m, leaves) {
  const n = leaves.length;
  if (n <= 1) return [];
  const k = largestPow2LessThan(n);
  if (m < k) return [...path(m, leaves.slice(0, k)), mth(leaves.slice(k))];
  return [...path(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

export function merkleRoot(contentHashes) {
  return 'sha256:' + mth(contentHashes.map(leafHash)).toString('hex');
}

export function inclusionProof(contentHashes, index) {
  const leaves = contentHashes.map(leafHash);
  return path(index, leaves).map((b) => b.toString('hex'));
}

// RFC 9162 §2.1.3.2
export function verifyInclusion(contentHash, index, treeSize, proofHex, rootStr) {
  if (index >= treeSize) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = leafHash(contentHash);
  for (const pHex of proofHex) {
    const p = Buffer.from(pHex, 'hex');
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      r = H(NODE, p, r);
      if ((fn & 1) === 0) {
        while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
      }
    } else {
      r = H(NODE, r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && 'sha256:' + r.toString('hex') === rootStr;
}
