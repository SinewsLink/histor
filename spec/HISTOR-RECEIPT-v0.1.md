# SL Histor Receipt Format: Specification v0.1

> **Scope.** A Histor receipt is signed, hash-chained evidence of one agent event: what ran, under whose authority, which human approved that exact payload, and what it cost. It builds on established standards (RFC 8785 canonicalization, Ed25519 per RFC 8032, RFC 9162 Merkle trees and inclusion proofs) and exports to W3C Verifiable Credentials (§17), so evidence stays portable. What it carries that logs and traces do not: approvals bound to the exact payload, keyed privacy commitments, four-bucket cost reconciled to the invoice, Merkle inclusion proofs, tool-definition drift and multi-vendor approval evidence.

**Status:** Draft for implementation · **Editors:** SinewsLink Inc. (until neutral governance; see `GOVERNANCE.md`) · **License:** Apache-2.0
**Schemas:** `spec/schema/histor-receipt.v0.1.schema.json` (normative), plus batch, keyring, approval-decision and pricing schemas.
**Examples:** `spec/examples/` (real, signed, verifiable).

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119 / RFC 8174.

---

## 1. Purpose and scope

An **Histor receipt** is a signed, hash-chained record of one event in the life of an AI agent: a tool call, a model call, a human approval, a denial, a credential use, a delegation, a change to the agent or policy, a cost reconciliation, an anchor, or a declared gap.

A receipt answers, for one event: **who** was accountable, **which** agent acted, under **what authority**, **what** it touched, **what** it cost, and **what happened**. It answers in a form a third party can verify **without trusting the issuer's database**.

**In scope:** record format, canonicalization, integrity (hashing, signing, chaining, batching, anchoring), approval binding, cost accounting, privacy constraints, verification.
**Out of scope:** enforcement (gateways), identity issuance (IdPs), debugging UIs (observability), agent orchestration. Histor records decisions made by those systems; it doesn't make them.

### 1.1 Design goals
1. **Independent verifiability.** Anyone with the public keyring can verify any receipt and any stream.
2. **Tamper evidence.** Edits, deletions, insertions and reorderings are detectable.
3. **Privacy by construction.** No raw tool arguments, outputs or secrets in receipts.
4. **Attribution.** Every consequential action resolves to an accountable human.
5. **Correct money.** Every billable token bucket is priced separately, in exact decimals, and reconcilable to the invoice.
6. **Additive.** Emittable from proxies, hooks, gateways, SDKs and OTel exporters without changing the agent.
7. **Boring cryptography.** SHA-256, Ed25519, HMAC-SHA256, RFC 8785, RFC 9162. Nothing novel.

### 1.2 Non-goals for v0.1
Real-time enforcement guarantees; zero-knowledge proofs; on-chain storage; multi-party consensus (see §17.3).

---

## 2. Terminology

- **Issuer:** software that creates and seals receipts (proxy, hook, gateway, SDK, approval service, reconciler). Identified by `issuer.key_id`.
- **Principal:** the accountable human for the action. MUST NOT be a shared or service account when one human can be determined.
- **Agent:** the autonomous software acting. MAY have a parent agent (delegation).
- **Stream:** an append-only sequence of receipts from one issuer instance, forming one hash chain (`chain.stream_id`).
- **Body:** the receipt minus `seal` and `proof`. This is what is hashed and signed.
- **Commitment:** `HMAC-SHA256(commitment_key, JCS(value))`, with the key held by the tenant.
- **Payload commitment:** the commitment over `{"server": <server>, "tool": <tool>, "arguments": <args>}`. This is what approvals bind to.
- **Batch:** a contiguous range of one stream committed to by a Merkle root.
- **Anchor:** an external, independent timestamp of a batch root.

---

## 3. Receipt envelope

```
{
  "histor_version": "0.1",
  "receipt_id": <UUIDv7>,
  "kind": <kind>,
  "issued_at": <RFC 3339 UTC>,
  "issuer": {...}, "tenant": {...}|null,
  "principal": {...}, "agent": {...}, "session": {...}, "trace": {...},
  "delegation": [...], "action": {...}, "resources": [...], "credentials": [...],
  "authorization": {...}, "approval": {...}, "cost": {...}, "outcome": {...},
  "risk": {...}, "compliance": {...}, "privacy": {...}, "links": {...},
  "change": {...}, "gap": {...}, "anchor": {...}, "server": {...}, "exit": {...},
  "extensions": { "x-<vendor>": {...} },
  "chain": { "stream_id", "sequence", "prev_hash" },     // signed
  "seal":  { "canonicalization", "hash_alg", "content_hash", "sig_alg", "key_id", "signature" },
  "proof": { "batch_id", "root", "tree_size", "leaf_index", "audit_path", "anchors" }  // optional, added later
}
```

Unknown top-level members are forbidden (`additionalProperties: false`). Vendor data goes in `extensions` under `x-<vendor>` keys, which are covered by the signature.

### 3.1 Kinds and required blocks

| kind | Meaning | Required (beyond envelope) |
|---|---|---|
| `session.start` / `session.end` | Agent session lifecycle | `session` |
| `action` | A side-effecting or tool operation was attempted and executed | `principal, agent, session, action, authorization, approval, outcome` |
| `denial` | An action was blocked before execution | same as `action` (`outcome.status = "denied"`) |
| `model.call` | LLM inference with cost | `principal, agent, session, cost` |
| `approval` | A human decision recorded as its own receipt (approval-service streams) | `principal, approval` |
| `credential.use` | Credential issued, used, or exposed | `principal, agent, credentials` |
| `delegation` | Authority passed human→agent or agent→agent | `principal, delegation` |
| `agent.change` | Agent config or tool surface changed (incl. tool-definition drift) | `agent, change` |
| `policy.change` | Policy bundle activated or changed | `change` |
| `cost.reconciliation` | Receipts reconciled against an invoice | `cost` |
| `anchor` | A batch root was anchored externally | `anchor` |
| `gap` | The issuer declares a known loss of records | `gap` |
| `key.rotation` | The signing key changes inside the stream; signed by the OUTGOING key | `key_rotation` |

Rules:
- An executed action MUST produce exactly one `action` receipt. A blocked action MUST produce a `denial` receipt.
- An action the issuer saw start but never saw complete MUST be recorded with `outcome.status = "no_response"` when the session ends.
- Issuers MUST NOT sample receipts for actions with consequence `medium` or above, denials, approvals, credential events or changes. Sampling is allowed only for `none`/`low` read-only actions, and the issuer MUST then record the sampling rate in `extensions`.
- An issuer that loses records (disk full, crash, buffer overflow) MUST emit a `gap` receipt as soon as it can. **An honest gap is evidence; a silent gap is a defect.**

---

## 4. Field semantics

The schema is normative for structure. This section adds the rules the schema can't express.

### 4.1 `issuer`
`type` ∈ {mcp-proxy, claude-code-hook, gateway, sdk, platform, observability-exporter, approval-service, reconciler, other}. `key_id` MUST equal `seal.key_id`.

### 4.2 `principal` and approver subjects
- `subject_id` MUST be stable for the person (IdP subject or employee id preferred over email).
- `authenticated: false` MUST be set when identity comes from an unauthenticated source (env var, OS user). Verifiers and auditors MUST treat such receipts as **attributed, not authenticated**.
- `auth.assurance_level` SHOULD follow NIST SP 800-63 AAL.
- Email addresses SHOULD be carried as `email_commitment`, not plaintext, outside `subject_id`.

### 4.3 `agent`
`agent_id` MUST be stable across versions; `version`/`build_hash`/`config_hash` identify the exact build. `system_prompt_commitment` lets an auditor confirm which instructions were in force without disclosing them. `model` records provider/model/region as invoked, not as configured.

### 4.4 `session` and `trace`
`trace.trace_id`/`span_id` MUST follow W3C Trace Context when present, which enables a join with OTel traces. `jsonrpc_id` and `tool_use_id` correlate with protocol-level ids.

### 4.5 `delegation`
An ordered chain from the principal to the acting agent. `depth` starts at 0. Each hop SHOULD narrow `scope`. A sub-agent's receipts MUST carry the full chain or reference a `delegation` receipt via `links.parent_receipt_id`.

### 4.6 `action`
- `category` ∈ {tool_call, model_call, code_exec, file_write, data_read, data_write, data_delete, network_request, message_send, payment, deploy, credential_access, delegation, config_change, other}.
- `tool.tool_definition_hash` = `hash(JCS({name, description, inputSchema, annotations}))` as advertised by the server. A change between sessions MUST produce an `agent.change` receipt (`change.type = "tool_surface_changed"`) because silent tool-definition changes are a known attack (tool poisoning / "rug pull").
- `input.commitment` MUST be a commitment, never the raw value. `input.secret_scan` records whether secret material was detected **in the payload** (the secret itself is never recorded).
- `payload_commitment` MUST be computed over `{"server", "tool", "arguments"}` with the tenant commitment key.
- `consequence` ∈ {none, low, medium, high, critical}; `reversibility` ∈ {reversible, compensable, irreversible, unknown}. These come from policy, not from the model.
- `intent.stated_reason_commitment` MAY commit to the model's stated reason. It's useful in incident review and kept private by default.

### 4.7 `resources`
What was touched. `identifier_commitment` instead of plaintext identifiers; `classification` includes Canadian government levels (protected_a/b/c) and national levels; `records_affected` when known; `jurisdiction` for residency analysis.

### 4.8 `credentials`
`credential_id` MUST identify the credential (key id, role ARN, client id, fingerprint) and MUST NOT contain secret material. `exposure` answers the auditor's question "did a credential reach somewhere readable, and was it real or a placeholder?":
- `secret_material_in_model_context`: real secret material entered a prompt/context.
- `placeholder_used`: the agent operated with a placeholder/reference and the secret was injected outside the model (the desired pattern).
- `reached_sinks[]`: logs, files, tool outputs, tickets, network destinations where secret material landed, with commitments to locations.

### 4.9 `authorization`
Records **the decision some enforcer made**: `decision` ∈ {allow, deny, require_approval}, the `policy` (engine, id, version, **hash of the exact bundle**), `rule_id`, `evaluated_at`, `enforcer`. `allowed_by_default: true` MUST be set when no rule matched. Auditors care that "allowed because nothing said no" isn't mistaken for an explicit allow.

### 4.10 `approval`: binding rules (MUST)
1. **Payload binding.** An approval is valid only for the `payload_commitment` it was granted for. Approve-A-execute-B MUST fail.
2. **Expiry.** `expires_at` MUST be honoured at execution time.
3. **Single use by default.** A consumed single-use approval MUST NOT authorize a second execution.
4. **Separation of duties.** When required, the approver's `subject_id` MUST differ from the principal's. A self-approval MUST be recorded as `rejected_sod`.
5. **Denial wins.** If the most recent decision for a payload is `denied`, execution MUST NOT proceed.
6. **Bypass is recorded.** If an action requiring approval executed without a valid approval (e.g., enforcement was out of band), the `action` receipt MUST carry `approval.status = "bypassed"`.
7. **Break-glass** MUST name who invoked it and why, and SHOULD be reviewed later (`break_glass.reviewed_by/at`).
8. **Rubber-stamp signal.** `decision_latency_ms` MUST be recorded when known. Uniformly instant approvals are a governance finding.

`status` ∈ {not_required, pending, approved, denied, expired_or_consumed, rejected_sod, bypassed, break_glass}.

**Approvals decided by other systems.** When the decision was made by an external system (an identity-first gateway's signed mandate, an IdP approval workflow, a ticketing system, a compliance platform's inline policy), the issuer MUST still record the approver as a `subject` and MUST set `approvers[].evidence_ref` to a stable reference to the external artefact, prefixed with its system:
- `vc:<credential id or hash>` for a W3C Verifiable Credential mandate (e.g., Affinidi)
- `okta:<request or certification id>` / `entra:<request id>`
- `ticket:<system>:<id>` (Jira, ServiceNow) · `slack:<channel>/<ts>` · `drata:<decision id>`

The `approved_payload_commitment` MUST still be computed by the Histor issuer over the payload actually executed. **An external approval for a different payload MUST NOT be recorded as `approved`.** This is how one Histor stream carries evidence across vendor boundaries.

### 4.11 `cost`: accounting rules (MUST)
1. Money and rates are **decimal strings**. Non-integer JSON numbers are forbidden everywhere in Histor.
2. Usage MUST be normalized to buckets: `input_tokens` (uncached), `output_tokens` (**including** reasoning/thinking tokens), `cache_write_tokens.{ttl_5m, ttl_1h}`, `cache_read_tokens`. Each bucket MUST be priced at its own rate.
3. Normalization MUST account for provider semantics. Example: Anthropic `input_tokens` **excludes** cache tokens; OpenAI `prompt_tokens` **includes** `cached_tokens`. Summing raw fields across providers is a defect.
4. Tiered pricing (long-context thresholds), batch discounts, service tiers, regional pricing and tool fees (e.g., web search) MUST be applied when they apply, and `method` MUST say how the amount was derived (list_price, list_price_batch, contract_rate, invoice_allocated).
5. `pricing_ref` MUST identify the versioned pricing table (id, effective date, hash). Pricing is data, not code.
6. Streamed responses MUST NOT be double-counted (dedupe by provider message id).
7. `reconciliation.status` starts `unreconciled`. A `cost.reconciliation` receipt records the invoice reference, period, totals and variance. "Reconciled" means **receipts sum to the invoice within a stated tolerance.**
8. Failed or cancelled requests that were billed MUST still be costed.

### 4.12 `outcome`
`status` ∈ {success, tool_error, error, denied, cancelled, timeout, no_response, partial}. `output.commitment` commits to the result; `side_effects[]` lists known downstream effects; `compensating_action_receipt_id` links an undo.

### 4.13 `risk`, `compliance`, `privacy`, `links`
`risk.signals[]` (e.g., secret_in_model_context, prompt_injection_suspected, tool_surface_changed) and `guardrails[]` results. `compliance.controls[]` maps the receipt to framework controls (see `docs/03-compliance-mapping.md`); `retention` carries policy and legal hold. `privacy` lists commitment/shredding key ids and redactions. `links` connects related receipts.

---

## 5. Canonicalization and hashing

- Canonical form: **RFC 8785 (JCS)** with the Histor profile: integers only, within ±(2^53−1); no floats; `undefined` members omitted. Implementations MUST reject receipts containing non-integer numbers.
- `content_hash = "sha256:" + hex(SHA-256(JCS(body)))`, where `body` = receipt minus `seal` and `proof`.
- Hash strings are lowercase hex with an algorithm prefix (`sha256:`).

## 6. Commitments

- `commitment = {"alg":"hmac-sha256","key_id":<id>,"value":"hmac-sha256:"+hex(HMAC-SHA256(K, JCS(value)))}`.
- `K` is a 256-bit tenant-held key. `key_id` MUST be derived from a hash of K, never from K's bytes.
- Rationale: plain hashes of low-entropy values (ids, booleans, short strings) are brute-forceable; keyed commitments aren't, yet the tenant can disclose `value` to an auditor for verification.
- Key rotation: new commitments use the new key; old keys MUST be retained (or escrowed) for the retention period, or the corresponding commitments become unprovable (which is acceptable only for crypto-shredding).

## 7. Signing and keys

- `seal.signature = base64url(Ed25519(sk, "HISTOR-v0.1/receipt\n" + content_hash))`. The prefix gives domain separation; batches use `"HISTOR-v0.1/batch\n"`, approvals `"HISTOR-v0.1/approval\n"`.
- `key_id = "ed25519:" + first 32 hex of SHA-256(SPKI DER of public key)`.
- Issuers MUST publish a **keyring** (`histor-keyring.v0.1.schema.json`) listing every key ever used with `not_before`, `not_after`, `status` (active, retired, compromised).
- Rotation: a new key starts a new stream or continues the old one (the receipt's `key_id` changes). Old keys are retired, not deleted.
- Compromise: mark `compromised` with `compromised_since`. Receipts whose batch root was anchored **before** `compromised_since` remain trusted. Any receipt not anchored before that instant is untrusted, because the attacker could have forged it, even with a backdated `issued_at`. **That's the reason anchoring exists.**
- Production issuers SHOULD keep signing keys in an HSM/KMS. Software keys MUST be stored with 0600 permissions.

## 8. Streams and chains

**Terminal receipts.** The last receipt of a stream SHOULD carry `chain.terminal: true` and `chain.status` (`complete` or `interrupted`). Issuers MUST NOT append after a terminal receipt (start a new stream), and verifiers MUST fail any receipt that follows one. A stream without a terminal receipt is reported as `open`. The reference MCP proxy uses one stream per session and always closes it; the Claude Code hook closes its stream on `SessionEnd`.

**Out-of-band witness.** A clean tail truncation is undetectable from the chain alone. Verifiers MUST accept an optional `expectedLength` and/or `expectedFinalHash` taken from a record the attacker cannot also rewrite (an anchored batch, a checkpoint, the auditor's last copy) and fail on mismatch.

**Retries.** Duplicate `action.idempotency_key` values within a stream are a verifier warning, not a failure: retries are legitimate.

**In-chain key rotation.** To change keys, the issuer appends a `key.rotation` receipt signed with the **outgoing** key, carrying `key_rotation.new_key_id` and `new_public_pem`; every later receipt MUST be signed with the new key. A verifier holding only the original key can follow the hand-off from the chain itself. A key change without a preceding rotation receipt MUST fail verification.

**Out-of-process signing (RECOMMENDED for production).** The signing key SHOULD live in a separate signer process (`histor signer`), not in the agent-side proxy or hook. Emitters send unsealed bodies over a local socket; the signer seals, chains, fsyncs and returns. This also serializes concurrent writers. `issuer.key_id` is always set by the sealer to the sealing key.

- `chain.sequence` starts at 0 and increments by exactly 1. `chain.prev_hash` is the previous receipt's `content_hash` (null for sequence 0).
- One stream MUST have exactly one writer at a time. Multi-process writers MUST serialize appends (the reference uses an exclusive lock and re-reads the tip under the lock).
- Appends MUST be durable (fsync) before the issuer reports success.
- Recommended stream granularity: per proxy instance and host (`mcp-<server>-<host>`), per agent session for hooks (`claude-code-<session_id>`), per gateway node.
- Clock: `issued_at` SHOULD come from a synchronized clock (NTP). Non-monotonic timestamps are a verifier **warning**, not a failure; ordering truth is `sequence`.

## 9. Batches, inclusion proofs, anchoring

- A batch covers a contiguous `[first_sequence, last_sequence]` of one stream. Leaves are the receipts' `content_hash` strings.
- Tree: **RFC 9162** (leaf = H(0x00‖leaf), node = H(0x01‖left‖right), split at the largest power of two below n).
- The batch manifest (`histor-batch.v0.1.schema.json`) is signed. `anchors[]` is appended after signing.
- Anchor types: `opentimestamps`, `transparency_log`, `rfc3161_tsa`, `internal_log` (air-gapped), `permissioned_ledger` (multi-party, future).
- Cadence: SHOULD anchor at least hourly, and immediately after any `critical` action, `gap`, `agent.change` with changed tools, or key event.
- An inclusion proof (`proof` block) lets a verifier check one receipt against an anchored root without the rest of the stream.

## 10. Privacy requirements

- Receipts MUST NOT contain raw tool arguments, raw tool outputs, prompts, completions or secret material. Use commitments.
- Operator-facing approval UIs MAY show raw arguments to the approver. They MUST NOT copy them into receipts.
- PII needed for investigation SHOULD live in an encrypted side store keyed per data subject. Erasure = destroy the subject key (**crypto-shredding**). Receipts stay verifiable.
- `tenant.data_residency` and `resources[].jurisdiction` support residency audits.

## 11. Verification algorithm (stream)

Given receipts in file order and a keyring:
1. For each receipt: recompute `content_hash` over the body; compare. Verify the signature with the key named by `seal.key_id`; the key MUST be in the keyring, valid at `issued_at`, and, if the key is marked compromised, the receipt MUST be covered by a batch anchored before `compromised_since`.
2. For i > 0: `stream_id` equal; `sequence = prev.sequence + 1`; `prev_hash = prev.content_hash`.
3. Report `gap` receipts and timestamp regressions as warnings.
4. For batches: verify the manifest signature; recompute the Merkle root from the range; verify each anchor with its own verifier (e.g., `ots verify`).
5. Schema-validate every receipt.

Any failure in steps 1, 2 or 4 means the stream is **not** evidence-grade for the affected range.

## 12. Transport and storage

- **File:** JSON Lines, one sealed receipt per line, one file per stream (`<stream_id>.jsonl`).
- **OTel:** receipts MAY be exported as span events or log records with attribute `histor.receipt` (the JSON) plus `histor.*` index attributes (see `docs/04-otel-mapping.md`).
- **Ingestion API (SL Histor hosted, informative):** `POST /v1/streams/{stream_id}/receipts` (ordered batch of sealed receipts) → server verifies seals and chain continuity, rejects forks, returns accepted range and current root.
- Storage for evidence MUST be append-only (WORM / object lock) for the retention period.

## 13. Versioning and extension

- `histor_version` is `MAJOR.MINOR`. Minor versions only **add optional** fields/kinds/enum values; verifiers MUST ignore unknown enum values only when told the producer's minor version is newer. Major versions may break.
- Vendor extensions go under `extensions["x-<vendor>"]`. They're signed and never change the meaning of standard fields.
- Proposals: `docs/` RFC process in `GOVERNANCE.md`.

## 14. Conformance levels

| Level | Name | Requirements |
|---|---|---|
| **L1** | Emitter | Schema-valid, sealed receipts; commitments instead of raw payloads |
| **L2** | Chained | L1 + single-writer hash chain + gap receipts + published keyring |
| **L3** | Anchored | L2 + Merkle batches anchored at least hourly + inclusion proofs on request |
| **L4** | Approval-bound | L3 + §4.10 approval rules enforced for high/critical actions + SoD |
| **L5** | Reconciled | L4 + §4.11 cost rules + periodic `cost.reconciliation` against invoices |

The reference implementation in this repository meets L4 locally (anchoring is supported via `histor seal` plus an external anchor tool) and the L5 cost rules; reconciliation runs through `histor reconcile`.

## 15. Security considerations (threat model summary)

| Threat | Control |
|---|---|
| Edit a past receipt | content_hash + signature |
| Delete / insert / reorder receipts | hash chain + contiguous sequence |
| Issuer rewrites entire history | external anchoring of batch roots |
| Stolen signing key | keyring status + anchoring before compromise time + HSM |
| Approve A, execute B | payload-commitment binding |
| Replay an approval | single-use consumption records |
| Self-approval | separation of duties → `rejected_sod` |
| Brute-force private args from hashes | keyed commitments (HMAC) |
| Secrets leaking into evidence | no raw payloads; secret scanning records only types |
| Tool-definition poisoning | tool_definition_hash + `agent.change` on drift |
| Evidence store outage hides actions | fail-closed for high consequence; `gap` receipts |
| Clock manipulation | sequence is the ordering truth; anchors give external time |
| Unauthenticated principal spoofing | `authenticated:false` flag; production uses IdP-bound identity |
| Canonicalization ambiguity | RFC 8785 + integer-only profile |

## 16a. Risk signals recorded by the reference emitters
Signals never block on their own; policy decides. `tool_definition_suspicious` (invisible/bidirectional characters, instruction-override phrases, encoded blobs or URLs in a tool description), `loop_suspected` (identical payload repeated within a window), `policy_flag` (a rule marked `flag: true`), `secret_in_model_context`. Each appears in `risk.signals[]` with a severity and source.

## 17. Export to W3C Verifiable Credentials
- `exportAgentReceipts()` / `histor export` converts a stream's `action` and `denial` receipts to W3C Verifiable Credential receipts (receipt profile v0.5.0), chained and signed (RFC 8785 over the receipt minus `proof`, Ed25519, multibase `u` proof value).
- Mapping: `action.type` (or a taxonomy mapping from tool and category; `unknown` with `target.system` otherwise) · risk = max(consequence, taxonomy default), never downgraded · approved actions carry `authorization.grant_ref = histor:approval:<id>` · denials become `outcome.status = failure` · `issuer.runtime` links back to the Histor receipt id, content hash and stream.
- The test suite checks byte-for-byte agreement with third-party canonicalization and receipt-hash vectors, verifies signed credentials produced by other implementations, and validates every exported credential against the profile's JSON Schema.

## 18. Open issues for v0.2
1. Approval signatures by approver keys (WebAuthn/passkey assertion over the payload commitment).
2. Cross-stream ordering for multi-agent systems (vector clocks or a session-level coordinator stream).
3. Formal OTel semantic-convention proposal for `histor.*`.
4. Selective-disclosure proofs for auditors (Merkle-ized receipt fields).
5. Standard `cost.reconciliation` invoice adapters per provider.
6. Permissioned multi-party ledger profile for cross-organisation and coalition use.
7. **Alignment with the OWASP Agent Control Standard (ACS).** ACS standardizes runtime control hooks (session start, user message, tool call, memory read/write, retrieval, subagent spawn, response, session end). Histor should be proposed as the tamper-evident evidence profile emitted at those hooks, with a published hook → receipt-kind mapping (draft in `docs/04-otel-mapping.md` §ACS). If ACS defines its own audit-record format, Histor v0.2 adopts or maps to it rather than competing.
