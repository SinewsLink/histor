// Interop with the Agent Receipt Protocol (agentreceipts.ai, Apache-2.0).
// Histor receipts carry the evidence auditors and finance need (approval
// binding, keyed commitments, cost, Merkle proofs). This module lets any Histor
// stream also be published as a valid, signed Agent Receipt chain, and lets
// Histor verify Agent Receipts produced by Obsigna or any other implementation.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalizeFull } from './canonicalize.js';

const VENDOR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'agent-receipts');
export const AR_VERSION = '0.5.0';
export const AR_CONTEXT = ['https://www.w3.org/ns/credentials/v2', 'https://agentreceipts.ai/context/v2'];

let taxonomy = null;
export function arTaxonomy() {
  if (!taxonomy) {
    const t = JSON.parse(fs.readFileSync(path.join(VENDOR, 'action-types.json'), 'utf8'));
    taxonomy = new Map(Object.values(t.domains).flatMap((d) => d.actions.map((a) => [a.type, a.risk_level])));
  }
  return taxonomy;
}

// Spec §7.1.1: optional fields that are null are removed; the only
// required-nullable field (chain.previous_receipt_hash) keeps its null.
export function arNormalize(receipt) {
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        const kp = p ? `${p}.${k}` : k;
        if (x === null && kp !== 'credentialSubject.chain.previous_receipt_hash') continue;
        if (x === undefined) continue;
        out[k] = walk(x, kp);
      }
      return out;
    }
    return v;
  };
  return walk(receipt, '');
}

const withoutProof = (r) => { const { proof, ...rest } = r; return rest; };
export function arCanonical(receipt) { return canonicalizeFull(arNormalize(withoutProof(receipt))); }
export function arReceiptHash(receipt) { return 'sha256:' + createHash('sha256').update(arCanonical(receipt)).digest('hex'); }

export function arSign(receipt, privatePem, verificationMethod, created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')) {
  const unsigned = arNormalize(withoutProof(receipt));
  const sig = sign(null, Buffer.from(canonicalizeFull(unsigned)), createPrivateKey(privatePem));
  return { ...unsigned, proof: { type: 'Ed25519Signature2020', created, verificationMethod, proofPurpose: 'assertionMethod', proofValue: 'u' + sig.toString('base64url') } };
}

export function arVerify(receipt, publicPem) {
  const pv = receipt?.proof?.proofValue;
  if (typeof pv !== 'string' || !pv.startsWith('u')) return { valid: false, reason: 'proofValue must be u-prefixed base64url', hash: null };
  let ok = false;
  try { ok = verify(null, Buffer.from(arCanonical(receipt)), createPublicKey(publicPem), Buffer.from(pv.slice(1), 'base64url')); } catch { ok = false; }
  return { valid: ok, reason: ok ? null : 'invalid signature', hash: arReceiptHash(receipt) };
}

// Chain checks per spec §7.3 (linkage, contiguity, single chain, terminal).
export function arVerifyChain(receipts, publicPem) {
  const problems = [];
  let prev = null;
  receipts.forEach((r, i) => {
    const v = arVerify(r, publicPem);
    if (!v.valid) problems.push(`#${i}: ${v.reason}`);
    const c = r.credentialSubject?.chain || {};
    if (i === 0) { if (c.sequence !== 1 || c.previous_receipt_hash !== null) problems.push('#0: chain must start at sequence 1 with null previous_receipt_hash'); }
    else {
      if (c.chain_id !== prev.credentialSubject.chain.chain_id) problems.push(`#${i}: mixed chain_id`);
      if (c.sequence !== prev.credentialSubject.chain.sequence + 1) problems.push(`#${i}: sequence gap`);
      if (c.previous_receipt_hash !== arReceiptHash(prev)) problems.push(`#${i}: previous_receipt_hash mismatch`);
      if (prev.credentialSubject.chain.terminal) problems.push(`#${i}: receipt after terminal`);
    }
    prev = r;
  });
  return { ok: problems.length === 0, problems };
}

const RISK = { none: 'low', low: 'low', medium: 'medium', high: 'high', critical: 'critical' };
const ORDER = ['low', 'medium', 'high', 'critical'];
const atLeast = (a, b) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

// Map a Histor action to the Agent Receipt taxonomy; fall back to "unknown"
// (which the protocol requires to carry target.system = original tool name).
export function arActionType(h) {
  const tax = arTaxonomy();
  if (h.action?.type && (tax.has(h.action.type) || /^[a-z0-9]+(\.[a-z0-9-]+){2,}$/.test(h.action.type))) return h.action.type;
  const tool = (h.action?.tool?.tool_name || '').toLowerCase();
  const builtin = h.action?.tool?.protocol === 'claude-code-builtin';
  if (builtin) {
    const m = { bash: 'system.command.execute', edit: 'filesystem.file.modify', multiedit: 'filesystem.file.modify', write: 'filesystem.file.create', notebookedit: 'filesystem.file.modify', read: 'filesystem.file.read', glob: 'filesystem.directory.list', grep: 'filesystem.file.read', webfetch: 'system.browser.navigate' };
    if (m[tool]) return m[tool];
  }
  switch (h.action?.category) {
    case 'payment': return 'financial.payment.initiate';
    case 'message_send': return 'communication.message.send';
    case 'code_exec': return 'system.code.execute';
    case 'data_delete': return 'data.api.delete';
    case 'data_write': return 'data.api.write';
    case 'data_read': return 'data.api.read';
  }
  if (/(transfer|pay|refund|charge)/.test(tool)) return 'financial.payment.initiate';
  if (/(delete|remove|drop|purge|destroy)/.test(tool)) return 'data.api.delete';
  if (/(email)/.test(tool) && /(send)/.test(tool)) return 'communication.email.send';
  if (/(send|post_message|notify)/.test(tool)) return 'communication.message.send';
  if (/(query|sql)/.test(tool)) return 'data.database.query';
  if (/(create|update|write|set|put|insert|merge|deploy)/.test(tool)) return 'data.api.write';
  if (/(get|list|read|search|fetch|find|describe)/.test(tool)) return 'data.api.read';
  return 'unknown';
}

const uuidOf = (id) => id; // Histor receipt ids are UUIDv7 — valid lowercase UUIDs

// Convert one Histor action/denial receipt to an unsigned Agent Receipt.
export function toAgentReceipt(h, { issuerId, operator, chainId, sequence, previousReceiptHash, terminal = false }) {
  const type = arActionType(h);
  const taxRisk = arTaxonomy().get(type) || 'medium';
  const risk = atLeast(RISK[h.action?.consequence] || 'medium', taxRisk); // MAY escalate, MUST NOT downgrade
  const st = h.outcome?.status;
  const failed = st && st !== 'success';
  const appr = h.approval;
  const authorization = appr?.status === 'approved' && appr.approvers?.[0]
    ? { scopes: [`histor:approved:${h.authorization?.rule_id || 'policy'}`], granted_at: appr.approvers[0].decided_at, expires_at: appr.approvers[0].expires_at || undefined, grant_ref: `histor:approval:${appr.approval_id}` }
    : undefined;
  const rev = h.action?.reversibility;
  const r = {
    '@context': AR_CONTEXT,
    id: `urn:receipt:${uuidOf(h.receipt_id)}`,
    type: ['VerifiableCredential', 'AgentReceipt'],
    version: AR_VERSION,
    issuer: {
      id: issuerId,
      type: 'AIAgent',
      name: h.agent?.name || h.agent?.agent_id || undefined,
      operator: operator || undefined,
      model: h.agent?.model?.model_id || undefined,
      session_id: h.session?.session_id || undefined,
      // Open container per the protocol (ADR-0026): links back to the full Histor evidence.
      runtime: { histor_receipt_id: h.receipt_id, histor_content_hash: h.seal?.content_hash, histor_stream_id: h.chain?.stream_id, histor_kind: h.kind, histor_approval_status: appr?.status },
    },
    issuanceDate: (h.issued_at || '').replace(/\.\d{3}Z$/, 'Z'),
    credentialSubject: {
      principal: { id: /^(did:|urn:|https?:|mailto:)/.test(h.principal?.subject_id || '') ? h.principal.subject_id : `urn:histor:principal:${encodeURIComponent(h.principal?.subject_id || 'unknown')}`, type: 'HumanPrincipal' },
      action: {
        id: `act_${uuidOf(h.receipt_id)}`,
        type,
        risk_level: risk,
        target: { system: h.action?.tool?.server_name || h.action?.tool?.tool_name || 'unknown', resource: h.action?.tool?.tool_name || undefined },
        timestamp: (h.outcome?.started_at || h.issued_at || '').replace(/\.\d{3}Z$/, 'Z'),
        idempotency_key: h.action?.idempotency_key || undefined,
      },
      outcome: {
        status: failed ? 'failure' : 'success',
        error: failed ? (h.kind === 'denial' ? `denied: ${h.outcome?.detail || h.authorization?.rule_id || 'policy'}` : st) : undefined,
        reversible: rev === 'reversible' || rev === 'compensable' ? true : rev === 'irreversible' ? false : undefined,
      },
      authorization,
      chain: { sequence, previous_receipt_hash: previousReceiptHash, chain_id: chainId, ...(terminal ? { terminal: true, status: 'complete' } : {}) },
    },
  };
  return arNormalize(r);
}

// Export a whole Histor stream as a signed Agent Receipt chain (actions and
// denials only — the protocol records actions; Histor keeps everything else).
export function exportAgentReceipts(historReceipts, { privatePem, verificationMethod, issuerId, operator, chainId }) {
  const acts = historReceipts.filter((h) => h.kind === 'action' || h.kind === 'denial');
  const out = [];
  acts.forEach((h, i) => {
    const unsigned = toAgentReceipt(h, { issuerId, operator, chainId: chainId || `chain_${historReceipts[0]?.chain?.stream_id || 'histor'}`, sequence: i + 1, previousReceiptHash: i ? arReceiptHash(out[i - 1]) : null, terminal: i === acts.length - 1 && !!historReceipts[historReceipts.length - 1]?.chain?.terminal });
    out.push(arSign(unsigned, privatePem, verificationMethod));
  });
  return out;
}
