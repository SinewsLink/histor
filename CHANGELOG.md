# Changelog
## 0.2.0 (2026-10-25): SL Histor
- Repository is github.com/SinewsLink/histor (working folder previously `sl-histor`); all packages at 0.2.0 with repository metadata and public publish access; emitted `software.version` now 0.2.0
- Claude skills moved to `.claude/skills/` so Claude Code loads them in this repo; added CLAUDE.md
- Windows: the signer maps its socket path to a named pipe (`ipcPath`), so `histor signer` and `"signer": {"socket": …}` work unchanged on Windows; tests resolve repo paths with `fileURLToPath`, fixing failures on Windows and on any checkout path containing spaces
- Renamed SL Witness → SL Histor; receipt format → Histor receipt (`histor_version`); CLI `histor`; packages `@sinewslink/histor-*`; config `.histor/histor.config.json`
- Agent Receipt Protocol interop: export signed v0.5.0 chains, verify theirs; their canonicalization, receipt-hash and signature vectors pass in our suite; exports validate against their schema
- Terminal receipts (one stream per proxy session; SessionEnd in the hook); verifier fails receipts after terminal and supports out-of-band length/hash witnesses
- In-chain key rotation signed by the outgoing key (`histor rotate`); commitment key never rotated
- Out-of-process signer daemon (`histor signer`); proxy and hook can run with no signing key
- Tool-definition poisoning scan, loop detection, policy `flag`
- Deterministic conformance vectors (positive + MUST-reject); browser web verifier proven equal to the reference verifier
- `histor init` quickstart, `histor serve` local viewer, `histor export`
- Overhead benchmark gated in CI; evidence errors never block forwarding
- NOTICE with third-party credits; vendored Agent Receipts schema/taxonomy/vectors (Apache-2.0)

## 0.1.1 (2026-10-17)
- Spec §4.10: approvals decided by external systems (`evidence_ref` prefixes); §16.7 OWASP ACS alignment
- OTel doc: ACS hook → receipt mapping; compliance mapping: AIUC-1 row

## 0.1.0 (2026-10-10)
- Histor v0.1 spec and JSON Schemas (receipt, batch, keyring, approval decision, pricing)
- histor-core, histor-mcp-proxy, histor-claude-hook, aar CLI
- Real signed examples; 15 tests; end-to-end demo
