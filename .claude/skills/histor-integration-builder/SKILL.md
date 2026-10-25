---
name: histor-integration-builder
description: Build an integration that emits Histor receipts for SL Histor from a new source, such as an agent framework (LangGraph, CrewAI, Agent SDKs), a model SDK wrapper, an MCP transport, a gateway (Portkey, TrueFoundry), an observability/OTel exporter, an approval app (Slack/Teams), or an invoice reconciler. Use this whenever the user wants to "add support for", "integrate", "emit receipts from", "hook into", or "make X produce evidence" for any agent tool, platform or provider in the SL Histor / Histor / SinewsLink agent-evidence project, even if they don't say "Histor".
---

# Histor Integration Builder

Goal: a new emitter that produces **schema-valid, sealed, chained receipts** without breaking the host system and without leaking data. The reference emitters are `packages/mcp-proxy/src/proxy.js` (proxy pattern) and `packages/claude-code-hook/bin/histor-claude-hook.js` (hook pattern). Read whichever is closer to your target before writing code.

## Step 1: Classify the source
| Source type | Pattern | Emits |
|---|---|---|
| Sits between agent and tools (stdio/HTTP) | **Proxy** | action, denial, session.*, agent.change |
| Framework/CLI exposes lifecycle callbacks | **Hook/callback** | action, denial, model.call |
| Model SDK | **Wrapper** around the client | model.call (cost) |
| Gateway/observability already logs everything | **Adapter/exporter** (batch, out of band) | action, model.call; authorization decisions *from the gateway* |
| Human decision UI | **Approval service** | approval decisions bound to payload commitments |
| Billing export / invoice | **Reconciler** | cost.reconciliation |

Prefer out-of-band patterns (adapter, exporter). Only gate in-line when the customer has no other enforcement, and then only for high/critical consequence.

## Step 2: Map fields with the checklist
Work through `references/field-mapping-checklist.md` for the source. For every field, decide one of: **mapped** (from what source attribute), **derived**, **not available** (leave absent; never invent). Write the mapping table into the integration's README.

Hard rules (the reviewer will reject violations):
1. Raw arguments, outputs, prompts and completions go through `commit()`. They never appear in plaintext.
2. Secrets are never recorded. Run `scanForSecrets()` and record only `types`.
3. Money uses decimal strings via `priceUsage()`. Normalize provider usage first (`normalizeAnthropicUsage` / `normalizeOpenAIUsage`, or write a new normalizer with tests for that provider's cache semantics).
4. `principal.authenticated` is `false` unless identity came from an authenticated IdP session.
5. One stream per single writer. Pick `stream_id` so two processes never append to the same stream concurrently without the `Ledger` lock.
6. Approval-gated actions use `payload_commitment` over `{server, tool, arguments}` and `findValidApproval()` semantics (binding, expiry, single use, SoD, denial wins). Executed-without-approval is `bypassed`, never omitted.
7. Unfinished actions at shutdown are written as `no_response`; lost records produce a `gap` receipt.
8. Integration failures must not break the host by default (log loudly, exit non-blocking, always forward traffic) unless policy `fail_mode` says closed.
9. Close every stream: the last receipt of a session is appended with `{ terminal: true, status }` ('interrupted' on signals/aborts). Use one stream per session or per single writer.
10. Use `openLedger(config, …)` so the emitter works both with a local key and with the out-of-process `histor signer` (production). Never require the signing key in the emitter when `config.signer` is set.
11. Record risk signals (`tool_definition_suspicious`, `loop_suspected`, `policy_flag`) as evidence; they never block on their own.
12. Check interop: the emitter's streams must export cleanly with `exportAgentReceipts()` and validate against the vendored Agent Receipts schema.

## Step 3: Build
- JS: depend on `@sinewslink/histor-core`. Python: use `histor-core-py` once it exists, and verify against `spec/test-vectors/`.
- Put the package under `packages/<name>/` with `bin/` or `src/`, a README containing the mapping table, and an example config under `examples/`.

## Step 4: Test (all required)
1. Unit: mapping of a recorded sample event → receipt fields.
2. End to end: run the real host (or a faithful fake like `examples/demo-mcp-server.js`), produce receipts, then assert:
   - every receipt validates against `spec/schema/histor-receipt.v0.1.schema.json` (use `test/helpers.js` `validators()`)
   - `verifyStream()` is ok and reports `end: 'complete'`
   - `JSON.stringify(receipts)` contains none of the sample's raw argument values
   - denial/approval paths if the integration gates anything
3. Cost: at least one case with cache reads plus cache writes, checked against a hand-computed amount.
4. `npm test` passes for the whole repo.

## Step 5: Document and register
- Add the integration to the README "What's in the box" table and to `docs/05-integration-guide.md`.
- Update `docs/02-dont-miss-checklist.md` if the source has a new edge case (e.g. a provider that bills differently).
- If you needed a field the schema doesn't have, stop and use the `histor-spec-steward` skill. Never smuggle it into a standard field; use `extensions["x-<vendor>"]` only for truly vendor-specific data.

## Output to the user
Short summary: what the integration covers, the mapping table, what's not available from this source, test results, and how to install it in 3 commands.
