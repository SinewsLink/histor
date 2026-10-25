import fs from 'node:fs';
import path from 'node:path';
import { sealReceipt } from './receipt.js';

// Append-only JSONL ledger, one file per stream; each line is a sealed receipt.
// Multi-process safe: every append takes an exclusive lock (atomic mkdir),
// re-reads the chain tip from disk, seals, writes, fsyncs, releases. A crash
// can never fork the chain; parallel hook processes can never interleave.
export class Ledger {
  constructor({ dir, streamId, issuerKey, lockTimeoutMs = 5000 }) {
    this.dir = dir;
    this.streamId = streamId;
    this.issuerKey = issuerKey;
    this.lockTimeoutMs = lockTimeoutMs;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${streamId}.jsonl`);
  }

  tip() {
    const last = readLastLine(this.file);
    if (!last) return { sequence: 0, prevHash: null };
    const r = JSON.parse(last);
    return { sequence: r.chain.sequence + 1, prevHash: r.seal.content_hash, terminal: !!r.chain.terminal };
  }

  append(receipt, { terminal = false, status = null } = {}) {
    return withLock(this.file + '.lock', this.lockTimeoutMs, () => {
      const { sequence, prevHash, terminal: ended } = this.tip();
      if (ended) throw new Error(`stream ${this.streamId} is terminal; start a new stream`);
      const sealed = sealReceipt(receipt, { streamId: this.streamId, sequence, prevHash, issuerKey: this.issuerKey, terminal, status });
      const fd = fs.openSync(this.file, 'a');
      try { fs.writeSync(fd, JSON.stringify(sealed) + '\n'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      return sealed;
    });
  }
}

// In-chain key rotation: the rotation receipt is signed with the OUTGOING key
// and carries the incoming public key, so a verifier follows the hand-off from
// the chain itself. Every later receipt is signed with the new key.
Ledger.prototype.rotateKey = function rotateKey(newKey, draft, reason = null) {
  const sealed = this.append(draft('key.rotation', { key_rotation: { new_key_id: newKey.keyId, new_public_pem: newKey.publicPem, signed_with: 'old', reason } }));
  this.issuerKey = newKey;
  return sealed;
};

function withLock(lockDir, timeoutMs, fn) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { fs.mkdirSync(lockDir); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lockDir).mtimeMs > 30000) { fs.rmdirSync(lockDir); continue; } } catch {}
      if (Date.now() > deadline) throw new Error(`ledger lock timeout: ${lockDir}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lockDir); } catch {} }
}

export function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`${file}: line ${i + 1} is not valid JSON`); }
  });
}

function readLastLine(file) {
  if (!fs.existsSync(file)) return null;
  const { size } = fs.statSync(file);
  if (!size) return null;
  const fd = fs.openSync(file, 'r');
  try {
    let chunk = 65536, text = '';
    for (;;) {
      const start = Math.max(0, size - chunk);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
      const lines = text.split('\n').filter(Boolean);
      if (lines.length >= 2 || start === 0) return lines[lines.length - 1] ?? null;
      chunk *= 4;
    }
  } finally { fs.closeSync(fd); }
}
