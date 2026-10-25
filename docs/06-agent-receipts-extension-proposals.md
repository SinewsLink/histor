# Proposed extensions to the Agent Receipt Protocol (ready to file)

Each section below is a ready-to-paste GitHub issue for github.com/agent-receipts/obsigna. SL Histor already implements every one of them, and its tests pass against the protocol's own vectors.

---

## 1. Approval evidence bound to the exact payload

**Problem.** The protocol records `authorization.scopes`, but not *who approved this specific action*. The MCP proxy can pause for approval, yet the receipt can't prove which human approved which payload, whether the approval had expired, or whether the requester approved themselves. Auditors ask for exactly this (EU AI Act Art. 14, SOC 2 CC8.1).

**Proposal.** Add an optional `credentialSubject.approval` object: `status` (approved | denied | pending | expired_or_consumed | rejected_sod | bypassed | break_glass), `approvers[]` (`id`, `method`, `decided_at`, `expires_at`, `decision_latency_ms`, `evidence_ref`), `approved_parameters_commitment`, `single_use`, and `separation_of_duties { required, satisfied }`.
Normative rules: an approval is valid only for the commitment over the parameters actually executed; denial wins; consumed single-use approvals can't authorize again; a self-approval under SoD is recorded as `rejected_sod`; executing without a valid approval MUST be recorded as `bypassed`.

**Reference.** SL Histor spec §4.10; tests cover payload swap, replay and self-approval.

---

## 2. Keyed parameter commitments (brute-force resistance)

**Problem.** `parameters_hash` is plain SHA-256 over canonical parameters. Low-entropy parameters (account ids, `{"approve": true}`, short emails) can be recovered by brute force from the hash alone.

**Proposal.** Allow `parameters_commitment: { alg: "hmac-sha256", key_id, value }` as an alternative to `parameters_hash`, using an operator-held key. Disclosure stays the same: reveal the parameters and the key id to the auditor. `key_id` MUST be derived from a hash of the key, never from its bytes.

---

## 3. Cost object with all billable token buckets

**Problem.** Agent receipts are increasingly used for cost attribution, and providers disagree on whether "input tokens" includes cached tokens. Naive pricing of cache reads overstates cost by several hundred percent.

**Proposal.** Optional `credentialSubject.cost`: `currency`, `usage[] { provider, model, buckets { input_tokens, output_tokens (incl. reasoning), cache_write_tokens { ttl_5m, ttl_1h }, cache_read_tokens }, amount }`, `amount` (decimal string), `method`, `pricing_ref`, `reconciliation { status, invoice_ref, variance }`. Rule: money is a decimal string; buckets are normalized for provider semantics.

---

## 4. Merkle batch inclusion proofs

**Problem.** Chain-head anchoring proves a chain's state at a point in time, but proving one receipt to an auditor requires handing over the whole chain.

**Proposal.** A companion "batch manifest" (RFC 9162 tree over receipt hashes, signed) plus an optional `inclusion_proof { batch_id, root, tree_size, leaf_index, audit_path }`, so one receipt can be verified against an anchored root.

---

## 5. Tool-surface drift as a first-class event

**Problem.** Silent changes to MCP tool descriptions are a known attack (tool poisoning / "rug pull"). Receipts don't record which tool definition was in force.

**Proposal.** Add `action.target.tool_definition_hash` (hash of name, description, inputSchema, annotations) and an event type `system.tool_surface.changed` carrying `{ previous_surface_hash, surface_hash, diff { added, removed, changed } }`, with risk `high` when existing tools change.
