# Compliance Mapping (v0.1)

How Histor fields produce evidence for common frameworks. This is the seed of the paid **framework packs**. Control identifiers are given for orientation. **Verify against the current licensed text of each standard before putting this in front of an auditor.** ISO/IEC 42001 Annex A numbering in particular must be checked against the purchased standard.

| Framework | Control (orientation) | Auditor question | Histor evidence |
|---|---|---|---|
| **SOC 2 (TSC 2017)** | CC6.1 logical access | Who/what can access systems and data? | `principal`, `agent`, `credentials[]`, `delegation[]`, `authorization.policy` |
| | CC6.2 / CC6.3 provisioning and removal | Was access granted and scoped appropriately? | `delegation[].scope/expires_at`, `credentials[].just_in_time/expires_at` |
| | CC7.2 monitoring for anomalies | Are unusual actions detected? | `risk.signals[]`, `agent.change` (tool drift), `secret_scan` |
| | CC7.3 / CC7.4 incident evaluation and response | Can you reconstruct what happened? | stream verification + `outcome`, `side_effects`, `links` |
| | CC8.1 change management | Were changes authorized before deployment? | `action.category=deploy` + `approval` (bound, SoD) + `policy.change` |
| **ISO/IEC 42001 (AIMS)** | Event logging for AI systems (Annex A) | Are AI system events recorded? | every receipt; anchored batches |
| | Human oversight / roles and responsibilities | Who is accountable for the AI system's actions? | `principal`, `agent.owner`, `approval.approvers[]` |
| **EU AI Act** | Art. 12 record-keeping | Automatic logging over the system lifetime | streams + retention + anchoring |
| | Art. 14 human oversight | Can humans intervene and are interventions recorded? | `approval` (status, approver, latency), `denial` receipts, `break_glass` |
| **NIST AI RMF 1.0** | GOVERN (accountability) | Are roles and accountability defined? | `principal`, `agent.owner`, `delegation` |
| | MEASURE / MANAGE | Are risks tracked and responded to? | `risk`, `outcome`, `gap`, reconciliation |
| **NIST SP 800-171 / CMMC L2** | 3.3.1 create and retain audit records | Audit records exist and are retained | streams + `compliance.retention` |
| | 3.3.2 actions traceable to users | Can actions be traced to individual users? | `principal` (+ `authenticated`), delegation chain |
| | 3.3.8 protect audit information | Are audit records protected from modification? | seals, chain, anchoring, WORM storage |
| **NIST SP 800-53 / ITSG-33 (Canada)** | AU-2/AU-3 event content | Do records contain what/when/where/who/outcome? | full receipt structure |
| | AU-9 protection of audit information | Tamper protection | seals, chain, anchors, keyring |
| | AU-10 non-repudiation | Can the actor deny the action? | issuer signatures; approver signatures (v0.2) |
| | IA-5 authenticator management | Are credentials managed and exposure detected? | `credentials[].exposure` |
| **AIUC-1** (AI agent standard; Drata maps to it) | Agent accountability, oversight and logging controls (check the current AIUC-1 control list before mapping IDs) | Can you prove agent oversight to a certifier? | approvals, denials, delegation, anchored streams |
| **PIPEDA (Canada) / GDPR** | Accountability; minimization; erasure | Is personal data minimized and erasable? | commitments only; crypto-shredding (spec §10) |
| **FinOps / internal audit** | Cost allocation and invoice reconciliation | Does AI spend tie to the invoice and to owners? | `cost` buckets, `allocation`, `cost.reconciliation` |

**Export pack contents (Phase 2):** PDF summary per control, the JSONL streams for the period, keyring, batch manifests plus anchors, inclusion proofs for sampled receipts, verifier output, and a methodology note.
