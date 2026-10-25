# The "Don't Say We Missed It" Checklist

Every edge case we've identified, with where it's handled. **Status:** ✅ implemented and tested in v0.1 · 📐 specified in schema/spec, emitter support partial · 🗺️ roadmap.
Before any release, walk this list. When you find a new case, add it here **first**.

## A. Identity and attribution
| # | Case | Status | Where |
|---|---|---|---|
| A1 | Agent action with no accountable human | ✅ | `principal` required on action/denial/model.call |
| A2 | Principal from unauthenticated source (env/OS user) | ✅ | `principal.authenticated:false`; spec §4.2 |
| A3 | Shared/service account used as principal | 📐 | spec §2 MUST NOT; detection is the deployer's job |
| A4 | Sub-agent acting on delegated authority | 📐 | `delegation[]`, example 09 |
| A5 | Delegation scope widening at a hop | 📐 | spec §4.5 SHOULD narrow; verifier check 🗺️ |
| A6 | Human vs agent indistinguishable in logs | ✅ | every receipt names agent and principal separately |
| A7 | Agent identity stable across versions | 📐 | `agent_id` vs `version/build_hash/config_hash` |
| A8 | Which instructions were in force | 📐 | `system_prompt_commitment` |

## B. Approvals
| # | Case | Status | Where |
|---|---|---|---|
| B1 | Approve A, execute B (payload swap) | ✅ | payload commitment binding; demo step 5 |
| B2 | Approval replay | ✅ | single-use consumption; demo step 6 |
| B3 | Self-approval | ✅ | SoD → `rejected_sod`; demo step 3 |
| B4 | Expired approval | ✅ | `expires_at` checked at execution |
| B5 | Newer denial overrides older approval | ✅ | "denial wins" |
| B6 | Executed without approval (out-of-band enforcement) | ✅ | hook marks `bypassed` |
| B7 | Rubber-stamping (instant approvals) | ✅ | `decision_latency_ms` recorded |
| B8 | Break-glass emergency override | 📐 | `approval.break_glass` |
| B9 | Quorum (2-person rule) | 📐 | `approval.quorum`; reference = 1 🗺️ |
| B10 | Approver identity authenticated (passkey/OIDC) | 🗺️ | v0.2 approver signatures |
| B11 | Approver can see what they approve | ✅ | `histor pending` shows args; receipts keep only commitments |

## C. Integrity
| # | Case | Status | Where |
|---|---|---|---|
| C1 | Edited receipt | ✅ | content_hash + signature |
| C2 | Deleted / inserted / reordered receipt | ✅ | chain + sequence; tests |
| C3 | Whole history rewritten by issuer | ✅/🗺️ | Merkle batch ✅; anchoring via external tool (OTS) |
| C4 | Crash mid-write / forked chain | ✅ | fsync + tip re-read under lock |
| C5 | Concurrent writers (parallel hooks) | ✅ | exclusive lock per stream |
| C6 | Stale lock after crash | ✅ | 30 s stale-lock recovery |
| C7 | Key rotation | ✅ | keyring with validity windows (`histor init --rotate`) |
| C8 | Key compromise | 📐 | keyring `compromised` + anchoring rule |
| C9 | Canonicalization differences across languages | ✅/🗺️ | integer-only JCS profile; cross-language vectors 🗺️ |
| C10 | Float rounding in money | ✅ | decimal strings; BigInt engine |
| C11 | Clock skew / backdating | ✅ | sequence is ordering truth; verifier warns; anchors give external time |
| C12 | Evidence store unavailable | ✅ | fail-closed for high consequence (configurable) |
| C13 | Records lost | ✅/📐 | `gap` kind; emitter auto-gap on recovery 🗺️ |
| C16 | Tail truncation | ✅ | terminal receipts + `--expected-hash` witness |
| C17 | Receipt appended after the stream ended | ✅ | terminal marker; verifier fails |
| C18 | Key change without hand-off | ✅ | in-chain `key.rotation` signed by outgoing key |
| C19 | Signing key exposed in the agent process | ✅ | `histor signer` out-of-process daemon |
| C20 | Cross-implementation drift | ✅ | conformance vectors (positive + MUST-reject); third-party canonicalization vectors pass byte for byte |
| C14 | Signature replay across contexts | ✅ | domain-separated signing prefixes |
| C15 | Merkle second-preimage | ✅ | RFC 9162 leaf/node prefixes |

## D. Privacy and secrets
| # | Case | Status | Where |
|---|---|---|---|
| D1 | Raw args/outputs in evidence | ✅ | commitments only; test asserts no plaintext |
| D2 | Brute-forcing low-entropy hashes | ✅ | HMAC commitments with tenant key |
| D3 | Secret in tool input/output | ✅ | secret scan records types only |
| D4 | Real secret vs placeholder | ✅/📐 | `isPlaceholder()`; `credentials[].exposure.placeholder_used` |
| D5 | Secret reached a readable sink (log, prompt) | 📐 | `exposure.reached_sinks[]`; example 10 |
| D6 | Right to erasure vs immutable evidence | 📐 | crypto-shredding side store (spec §10) 🗺️ implementation |
| D7 | Data residency | 📐 | `tenant.data_residency`, `resources[].jurisdiction` |
| D8 | Commitment key id leaking key bits | ✅ | key id = hash of key |
| D9 | Classified environments | 📐 | Canadian/national classification enums; sovereign edition 🗺️ |

## E. Cost
| # | Case | Status | Where |
|---|---|---|---|
| E1 | Cache reads priced as input | ✅ | separate bucket |
| E2 | Cache write TTL tiers (5m/1h) | ✅ | `cache_write_tokens.ttl_5m/ttl_1h` |
| E3 | Provider "input" semantics differ | ✅ | Anthropic vs OpenAI normalizers; tests |
| E4 | Reasoning tokens | ✅ | counted in output; informational `reasoning_tokens` |
| E5 | Long-context tier pricing | ✅ | `long_context.threshold_input_tokens` |
| E6 | Batch API discount | ✅ | `batch_multiplier` |
| E7 | Streaming double count | ✅ | dedupe by message id; Stop hook idempotent |
| E8 | Unknown model | ✅ | recorded with `note: unpriced_model`, amount null |
| E9 | Tool fees (web search etc.) | 📐 | `usage[].tool_fees[]` |
| E10 | Contract rates vs list price | 📐 | `method: contract_rate`; pricing file per contract |
| E11 | Currency conversion | 🗺️ | record in billing currency; FX receipt in v0.2 |
| E12 | Billed failed requests | 📐 | spec §4.11 rule 8 |
| E13 | Reconcile to invoice | ✅/🗺️ | `reconcile()` + CLI; provider invoice adapters 🗺️ |
| E14 | Cost allocation to team/customer/feature | 📐 | `cost.allocation` |
| E15 | Regional / priority service tier pricing | 📐 | `service_tier`, `region` |

## F. Agent and tool surface
| # | Case | Status | Where |
|---|---|---|---|
| F1 | Tool definition changes silently (rug pull) | ✅ | `agent.change` with diff; test |
| F2 | Destructive tools | ✅ | policy + MCP annotations recorded |
| F3 | Shell exfiltration patterns | ✅ | example deny rule; test |
| F4 | Tool never responds | ✅ | `no_response` at session end |
| F5 | Cancelled calls | ✅ | `notifications/cancelled` → `cancelled` |
| F6 | Batched JSON-RPC | ✅ | arrays handled element-wise |
| F7 | Non-JSON noise on stdio | ✅ | forwarded untouched, logged |
| F8 | Server→client requests (sampling) | ✅ | passed through untouched |
| F9 | Remote MCP (Streamable HTTP) | 🗺️ | HTTP proxy mode v0.2 |
| F10 | Prompt-injection signals | 📐 | `risk.signals[]` (detector is pluggable) |
| F11 | Multi-agent cross-stream ordering | 🗺️ | spec §16.2 |
| F12 | Poisoned tool descriptions (hidden instructions, invisible characters) | ✅ | tool scan → `tool_definition_suspicious` signal |
| F13 | Runaway agent loops | ✅ | loop detector → `loop_suspected` signal (optional deny) |
| F14 | Evidence failure breaking agent traffic | ✅ | responses always forwarded; evidence errors logged |

## G. Operations and adoption
| # | Case | Status | Where |
|---|---|---|---|
| G1 | Zero-code-change install | ✅ | proxy wraps any stdio server; hook via settings |
| G2 | Hook failure bricking dev sessions | ✅ | non-blocking error unless `HISTOR_FAIL_CLOSED=1` |
| G3 | Latency overhead | ✅ | benchmark gated in CI (≈0.13 ms seal, ≈0.5 ms durable append) |
| G4 | Large ledgers | 🗺️ | tail read ✅; rotation/segmenting 🗺️ |
| G5 | Air-gapped anchoring | 📐 | `internal_log` anchor type |
| G6 | Legal admissibility | 🗺️ | evidence pack doc (Canada Evidence Act electronic-records provisions; get counsel review) |
| G7 | Sampling of telemetry | 📐 | spec §3.1: medium+ consequence, denials, approvals, credentials and changes MUST NOT be sampled |
| G8 | Vendor neutrality of spec | 📐 | `GOVERNANCE.md` |
| G9 | Approvals decided in other vendors' systems | 📐 | spec §4.10 `evidence_ref` prefixes; integration guide §6 |
| G12 | Portable export (W3C Verifiable Credentials) | ✅ | export + verify; third-party schema and vectors in tests |
| G10 | Alignment with OWASP Agent Control Standard | 🗺️ | spec §16.7; hook mapping in docs/04 |
