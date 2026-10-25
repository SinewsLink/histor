import fs from 'node:fs';
import path from 'node:path';
import { hashValue } from './hash.js';
import { uuidv7, nowRfc3339 } from './ids.js';

// Approval binding. An approval is valid only for the EXACT payload hash it was
// granted for (approve-A-execute-B is impossible), only until it expires, only
// once (single-use unless the policy says otherwise), and only if the approver
// is not the principal when separation of duties is required.
//
// Files in the approvals dir:
//   pending.jsonl    requests awaiting a human (operator-facing; contains args so
//                    the approver can see what they approve — never copied into receipts)
//   decisions.jsonl  human decisions
//   consumed.jsonl   approvals that have been used

export function payloadHash(server, tool, args) {
  return hashValue({ server: server ?? null, tool, arguments: args ?? {} });
}

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(o) + '\n'); };

export function requestApproval(dir, req) {
  const existing = read(path.join(dir, 'pending.jsonl')).find((p) => p.payload_hash === req.payload_hash && !isDecided(dir, p.request_id));
  if (existing) return existing;
  const r = { request_id: uuidv7(), created_at: nowRfc3339(), ...req };
  append(path.join(dir, 'pending.jsonl'), r);
  return r;
}

function isDecided(dir, requestId) {
  return read(path.join(dir, 'decisions.jsonl')).some((d) => d.request_id === requestId);
}

export function listPending(dir) {
  return read(path.join(dir, 'pending.jsonl')).filter((p) => !isDecided(dir, p.request_id));
}

export function decide(dir, { requestId, approver, decision, ttlSeconds = 3600, reason = null, method = 'cli' }) {
  const req = read(path.join(dir, 'pending.jsonl')).find((p) => p.request_id === requestId);
  if (!req) throw new Error(`no pending request ${requestId}`);
  const now = new Date();
  const d = {
    approval_id: uuidv7(),
    request_id: requestId,
    payload_hash: req.payload_hash,
    decision,
    approver,
    method,
    reason,
    decided_at: now.toISOString(),
    decision_latency_ms: now - new Date(req.created_at),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    single_use: true,
  };
  append(path.join(dir, 'decisions.jsonl'), d);
  return { request: req, decision: d };
}

// Returns {status, approval?, reason?}
// status: approved | denied | sod_violation | expired_or_consumed | pending
// Newest decision wins for denials; any currently valid approval wins otherwise.
export function findValidApproval(dir, { payload_hash, principalId, separationOfDuties = true }) {
  const consumed = new Set(read(path.join(dir, 'consumed.jsonl')).map((c) => c.approval_id));
  const now = new Date().toISOString();
  const candidates = read(path.join(dir, 'decisions.jsonl')).filter((d) => d.payload_hash === payload_hash).reverse();
  if (!candidates.length) return { status: 'pending' };
  if (candidates[0].decision === 'denied') return { status: 'denied', approval: candidates[0] };
  let sod = null, spent = null;
  for (const d of candidates) {
    if (d.decision !== 'approved') continue;
    if (separationOfDuties && d.approver?.subject_id && d.approver.subject_id === principalId) { sod ??= d; continue; }
    if (d.single_use && consumed.has(d.approval_id)) { spent ??= d; continue; }
    if (d.expires_at < now) { spent ??= d; continue; }
    return { status: 'approved', approval: d };
  }
  if (spent) return { status: 'expired_or_consumed', approval: spent };
  if (sod) return { status: 'sod_violation', approval: sod, reason: 'approver is the principal (separation of duties)' };
  return { status: 'pending' };
}

export function consumeApproval(dir, approval, receiptId) {
  append(path.join(dir, 'consumed.jsonl'), { approval_id: approval.approval_id, consumed_at: nowRfc3339(), by_receipt_id: receiptId });
}
