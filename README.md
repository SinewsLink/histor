# SL Histor

**Independent, verifiable evidence of what your AI agents did, who approved it, and what it truly cost.** By [SinewsLink](https://sinewslink.com).

In Homer, the *histor* is the trusted witness whose account settles a dispute. Gateways answer *"can this happen?"* and observability answers *"why did it break?"*. SL Histor answers the auditor: **"what did your agents do, who approved it, and can you prove it?"** It sits beside your stack, never in your traffic path.

**Built on open standards, not a new silo.** Receipts are canonicalized with RFC 8785, signed with Ed25519 (RFC 8032), chained by hash and batched into Merkle trees with inclusion proofs (RFC 9162, the design behind Certificate Transparency). Histor works where agents already run, the Model Context Protocol and Claude Code hooks, and exports to W3C Verifiable Credentials so evidence is never locked in. OpenTelemetry GenAI mapping is documented in `docs/04-otel-mapping.md`; the exporter is in progress.

**What it adds that logs and traces don't:** approvals bound to the exact payload and usable once, with separation of duties; keyed commitments so receipts prove what happened without holding the data; cost per token bucket reconciled to the provider invoice; and detection of edited, deleted or replayed actions.

```
$ npm run demo
1) low-consequence read: ok
2) destructive call, no approval yet → blocked, request created
3) the operator approves their own request → rejected (separation of duties)
4) a different human approves that exact payload → executed, once
5) payload swapped after approval → blocked
6) approved call replayed → blocked (single use)
7) every receipt signed and chained; stream closed with a terminal receipt
8) Merkle root ready to anchor; inclusion proof verifies
9) edited receipt detected · deleted receipt detected
10) cached agent turn priced correctly vs naive → naive is off by 369%
```

## What's in the box
| Package | What it does |
|---|---|
| `packages/histor-core` | Zero-dependency core: RFC 8785 canonicalization, keyed commitments, Ed25519 seals, hash-chained ledger (multi-process safe), terminal markers, in-chain key rotation, RFC 9162 Merkle batches and proofs, verifier with out-of-band witness, exact-decimal cost engine, secret and tool-poisoning scanners, loop detection, policy and approval binding, out-of-process signer, export to W3C Verifiable Credentials |
| `packages/mcp-proxy` | `histor-mcp-proxy`: wraps **any** stdio MCP server with no code change |
| `packages/claude-code-hook` | `histor-claude-hook`: Claude Code PreToolUse / PostToolUse / Stop / SessionEnd |
| `packages/cli` | `histor`: init · pending · approve · deny · inspect · verify · seal · prove · export · rotate · signer · serve · cost · reconcile |
| `web-verifier/` | One self-contained HTML page: drop in receipts and a keyring, and verify in the browser with nothing uploaded |
| `spec/` | Histor receipt format v0.1, JSON Schemas, signed examples, conformance vectors (positive + MUST-reject) |
| `docs/` | Integration guide, compliance and OpenTelemetry mappings, edge-case checklist |
| `examples/goose-crash-test/` | Crash test with goose: a durable-execution retry moves the same $500 twice without Histor, once with it |
| `.claude/skills/` | Claude skills for building integrations and evolving the spec safely (Claude Code loads them automatically in this repo) |

## Quickstart
```
npm install && npm test && npm run demo
npx histor init                      # keys, config and a starter policy in .histor/
npx histor serve                     # local viewer at http://127.0.0.1:7337
```
Wrap an MCP server or add the Claude Code hook: see [docs/05-integration-guide.md](docs/05-integration-guide.md). For production, run `histor signer` so the signing key never sits in the agent's process.

## Measured overhead
`npm test` runs a benchmark that fails CI on regression. On a typical runner: about **0.13 ms** median to commit, scan and seal a receipt in memory, and about **0.5 ms** median for a durable (fsync'd) append.

## Status and licence
v0.2.0, a working reference implementation of the Histor receipt spec v0.1, with 33 tests. Apache-2.0. © 2026 SinewsLink Inc. See NOTICE for third-party credits. Commercial SL Histor (self-hosted ledger, approvals app, auditor portal, framework packs, invoice reconciliation) is available from SinewsLink.
