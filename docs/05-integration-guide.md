# Integration Guide

## 1. Wrap any MCP server (zero code change)
```bash
npx histor init --witness .histor                      # issuer key, commitment key, keyring
cp examples/histor.config.example.json .histor/histor.config.json   # edit tenant/principal/agent/policy paths
```
Claude Desktop / any MCP client, replacing the server command:
```json
"command": "npx",
"args": ["histor-mcp-proxy", "--config", "/Users/you/project/.histor/histor.config.json", "--",
         "npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/you/project"]
```
When a high-consequence call is blocked, the model sees the reason and a request id. The approver runs:
```bash
npx histor pending --witness .histor
npx histor approve <request_id> --approver ops-lead@yourco.com --witness .histor
```
The agent retries the identical call and it goes through once.

## 2. Claude Code
1. `npx histor init --witness .histor` in the repo; create `.histor/histor.config.json` (set `"pricing"` to get dollar costs).
2. Merge `examples/claude-code-settings.example.json` into `.claude/settings.json`.
3. Work normally. Every tool call gets a receipt; risky ones need approval; on Stop, token usage from the transcript is priced across all four buckets.
4. `npx histor verify .histor/ledger/claude-code-<session>.jsonl --witness .histor`.

## 3. Your own code (SDK)
```js
import { Ledger, draftReceipt, loadIssuerKey, loadCommitmentKey, commit, normalizeAnthropicUsage, priceUsage } from '@sinewslink/histor-core';
const key = loadIssuerKey('.histor/keys'); const ck = loadCommitmentKey('.histor/keys');
const ledger = new Ledger({ dir: '.histor/ledger', streamId: 'my-agent-prod-1', issuerKey: key });
const res = await anthropic.messages.create({...});
const buckets = normalizeAnthropicUsage(res.usage);
const priced = priceUsage(pricing, res.model, buckets);
ledger.append(draftReceipt('model.call', { issuer: {...}, principal, agent, session,
  cost: { currency: 'USD', usage: [{ provider: 'anthropic', model: res.model, requests: 1, buckets, amount: priced.amount, lines: priced.lines }],
          amount: priced.amount, method: 'list_price', pricing_ref: priced.pricing_ref, reconciliation: { status: 'unreconciled' } } }));
```

## 4. Seal, anchor, prove
```bash
npx histor seal .histor/ledger/<stream>.jsonl --witness .histor   # writes batch manifest with Merkle root
echo -n "<root>" > root.txt && ots stamp root.txt                # OpenTimestamps (pip install opentimestamps-client)
npx histor prove .histor/ledger/<stream>.jsonl <batch.json> <receipt_id> --witness .histor
```

## 5. Reconcile cost
```bash
npx histor reconcile .histor/ledger/*.jsonl --invoice 1234.56 --tolerance 0.5
```

## 6. Recording decisions made by other systems (multi-vendor evidence)
SL Histor doesn't replace Affinidi, Okta, Drata or your gateway; it records their decisions in one verifiable stream. When an action was approved elsewhere, write the receipt with that system's artefact as evidence:
```js
approval: {
  required: true, status: 'approved', approval_id, request_id,
  approvers: [{
    approver: { subject_id: 'alice@yourco.com', idp: 'okta', authenticated: true },
    method: 'api', decision: 'approved', decided_at,
    approved_payload_commitment: payloadCommitment,      // computed by Histor over the payload actually executed
    evidence_ref: 'vc:urn:uuid:3f6c…'                     // Affinidi mandate; or okta:…, entra:…, ticket:jira:OPS-4471, drata:…
  }],
  quorum: { required: 1, obtained: 1 }, separation_of_duties: { required: true, satisfied: true }
}
```
Rule: if the external approval covered a different payload than the one executed, record `bypassed`, not `approved` (spec §4.10).

## 7. Production hardening: keep the signing key out of the agent's process
```
npx histor signer --witness /secure/histor --socket /run/histor/signer.sock
```
Then add `"signer": { "socket": "/run/histor/signer.sock" }` to each `histor.config.json`. On Windows the same path works: the signer maps it to a named pipe. The proxy and hook keep only the commitment key; the signer seals, chains and fsyncs, and serializes every writer.

## 8. Rotate keys inside the chain
`npx histor rotate .histor/ledger/<stream>.jsonl --reason "quarterly"` appends a rotation receipt signed with the outgoing key; verifiers follow the hand-off from the chain. The commitment key is never rotated by this command.

## 9. Publish as Agent Receipts
`npx histor export .histor/ledger/<stream>.jsonl --issuer did:web:yourco.com:agents --operator did:web:yourco.com --operator-name "Your Co"` writes a signed Agent Receipt v0.5.0 chain that any Agent Receipt Protocol verifier accepts.

## 10. Look at it
`npx histor serve` opens a local viewer of the latest stream. For auditors, send `web-verifier/index.html` plus the receipts and keyring; it verifies everything in their browser.

## 11. Detect truncation
`npx histor verify <stream>.jsonl --expected-hash <last content_hash from your anchor>` fails if the tail was cut or rewritten.
