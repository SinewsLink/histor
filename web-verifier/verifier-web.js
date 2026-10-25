// Browser-safe Histor verifier (WebCrypto only; no Node imports). The same file
// runs in Node 20+ for tests, so the web verifier is proven to agree with the
// reference verifier on every conformance vector.
const enc = new TextEncoder();

export function canonicalize(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error('non-integer or unsafe number');
    return Object.is(v, -0) ? '0' : String(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (typeof v === 'object') {
    const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return '{' + ks.map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  }
  throw new Error('unsupported type');
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(str) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(str))); }
const b64uToBytes = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const pemToDer = (pem) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));

const keyCache = new Map();
async function importKey(pem) {
  if (!keyCache.has(pem)) keyCache.set(pem, crypto.subtle.importKey('spki', pemToDer(pem), { name: 'Ed25519' }, false, ['verify']));
  return keyCache.get(pem);
}

export async function contentHash(r) { const { seal, proof, ...body } = r; return 'sha256:' + (await sha256(canonicalize(body))); }

export async function verifySeal(r, keys) {
  const errs = [];
  if (!r.seal) return ['missing seal'];
  if ((await contentHash(r)) !== r.seal.content_hash) errs.push('content_hash mismatch (receipt body altered)');
  const pem = keys[r.seal.key_id];
  if (!pem) errs.push(`unknown key_id ${r.seal.key_id}`);
  else {
    let ok = false;
    try { ok = await crypto.subtle.verify({ name: 'Ed25519' }, await importKey(pem), b64uToBytes(r.seal.signature), enc.encode('HISTOR-v0.1/receipt\n' + r.seal.content_hash)); } catch { ok = false; }
    if (!ok) errs.push('signature invalid');
  }
  return errs;
}

export async function verifyStream(receipts, keyring, opts = {}) {
  const problems = []; const warnings = [];
  let keys = { ...keyring }; let prev = null; let active = receipts[0]?.seal?.key_id ?? null; let terminal = false;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]; const where = `#${i} (${r.receipt_id ?? 'no id'})`; const c = r.chain || {};
    for (const e of await verifySeal(r, keys)) problems.push(`${where}: ${e}`);
    if (terminal) problems.push(`${where}: receipt after terminal (stream was declared finished)`);
    if (i > 0) {
      if (c.stream_id !== prev.chain.stream_id) problems.push(`${where}: stream_id changed`);
      if (c.sequence !== prev.chain.sequence + 1) problems.push(`${where}: sequence ${c.sequence} follows ${prev.chain.sequence} (missing or reordered receipts)`);
      if (c.prev_hash !== prev.seal.content_hash) problems.push(`${where}: prev_hash does not match previous receipt (chain broken)`);
      const rot = prev.kind === 'key.rotation' ? prev.key_rotation?.new_key_id : null;
      if (rot) { if (r.seal?.key_id !== rot) problems.push(`${where}: expected new key ${rot} after key.rotation, got ${r.seal?.key_id}`); active = rot; }
      else if (r.seal?.key_id !== active) problems.push(`${where}: signing key changed to ${r.seal?.key_id} without a key.rotation receipt`);
    } else if (c.sequence !== 0) warnings.push(`${where}: stream does not start at sequence 0`);
    if (r.kind === 'key.rotation' && r.key_rotation?.new_public_pem && !keys[r.key_rotation.new_key_id]) keys = { ...keys, [r.key_rotation.new_key_id]: r.key_rotation.new_public_pem };
    if (c.status && !c.terminal) problems.push(`${where}: chain.status without chain.terminal`);
    if (c.terminal) terminal = true;
    if (r.kind === 'gap') warnings.push(`${where}: issuer declared a gap: ${r.gap?.reason ?? ''}`);
    prev = r;
  }
  if (opts.expectedLength != null && receipts.length !== opts.expectedLength) problems.push(`length ${receipts.length} does not match out-of-band witness ${opts.expectedLength} (truncated or extended)`);
  if (opts.expectedFinalHash != null && prev?.seal?.content_hash !== opts.expectedFinalHash) problems.push('final content_hash does not match out-of-band witness (tail truncated or rewritten)');
  const last = receipts[receipts.length - 1];
  const end = !last ? 'empty' : last.chain?.terminal ? (last.chain.status || 'complete') : 'open';
  return { ok: problems.length === 0, count: receipts.length, end, problems, warnings };
}

export function parseKeyring(json) { const ring = typeof json === 'string' ? JSON.parse(json) : json; return Object.fromEntries((ring.keys || []).filter((k) => k.status !== 'compromised').map((k) => [k.key_id, k.public_pem])); }
export function parseJsonl(text) { return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); }
