---
name: histor-spec-steward
description: Safely change or extend the Histor receipt specification and JSON Schemas for SL Histor, including adding a field, kind, enum value, framework mapping or conformance rule, handling a newly discovered edge case, or preparing a version bump. Use this whenever the user says the schema "is missing", wants to "add X to the receipt", "support Y in the spec", "bump the version", or reports a gap ("we missed…") in the Histor / SL Histor / agent-evidence project.
---

# Histor Spec Steward

The spec is the moat: if Histor becomes the default format, everything else becomes a translation layer to it. Every change must keep it **neutral, additive, verifiable and boring**.

## Step 1: Classify the change
- **Additive (minor):** new optional field, new kind, new enum value, new extension guidance. Allowed in 0.x minors.
- **Breaking (major):** renaming/removing fields, changing hashing/canonicalization/signing, making an optional field required, changing meaning. Needs explicit founder sign-off and a migration note.
- **Not a spec change:** vendor-specific data → `extensions["x-<vendor>"]`; presentation → docs/portal.

## Step 2: Run the six questions
For the proposed field/kind, answer in writing (paste into the PR):
1. **Which auditor or finance question does it answer?** If none, it doesn't belong in the core.
2. **Privacy:** could it carry raw data, PII or secrets? If yes, it must be a commitment or identifier, never a value.
3. **Integrity:** is it in the signed body? (Everything except `seal`/`proof` is.) Does it change verification?
4. **Neutrality:** would a competitor be comfortable emitting it? No SinewsLink-specific semantics.
5. **Emittability:** can at least the MCP proxy, the Claude Code hook, or a gateway adapter actually populate it? If not, mark it optional and document the source.
6. **Export alignment:** if the change affects an action, denial or approval, update the Verifiable Credential export mapping in `agentReceipts.js` and keep the export tests green. Do not propose Histor fields to outside projects from this repo.
7. **OTel alignment:** is there an existing OTel GenAI attribute? Map to it rather than inventing a parallel name.

## Step 3: Make the change everywhere, in one commit
1. `spec/schema/*.json`: edit the schema (keep `additionalProperties: false` at the top level; add `$defs` for reuse; add kind conditionals in `allOf` if required-ness depends on kind).
2. `spec/HISTOR-RECEIPT-v0.1.md`: the field semantics and any MUST/SHOULD rules the schema can't express.
3. Emitters: update `packages/*` if the reference implementation should populate it.
4. `npm run vectors && npm run examples`: regenerate conformance vectors and real signed examples (add a MUST-reject vector for every new MUST); add an example exercising the new field if none does.
5. Tests: add or adjust; `npm test` must pass (it validates every real receipt against the schema).
6. `docs/02-dont-miss-checklist.md`: add or upgrade the row (status ✅ / 📐 / 🗺️).
7. `docs/03-compliance-mapping.md` / `docs/04-otel-mapping.md` if relevant.
8. `CHANGELOG.md`.

## Step 4: Never do
- Never allow non-integer JSON numbers (money and rates are decimal strings).
- Never store raw arguments/outputs/prompts/secrets.
- Never change canonicalization, hashing or signature input within a major version.
- Never make the signed body depend on data added after sealing (that's what `proof`/`anchors` are for).

## Output to the user
The classification, the six answers, the diff summary across files, and test results.
