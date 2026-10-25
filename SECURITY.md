# Security Policy
Report vulnerabilities privately to **security@sinewslink.com**. Don't open a public issue. We acknowledge within 2 business days and aim to fix critical issues within 14 days.

In scope: anything that lets an attacker forge, alter, delete or reorder receipts undetected; bypass approval binding, single-use or separation of duties; recover committed values without the tenant key; or cause secrets to be written into receipts.

Operational guidance: keep `issuer.key` and `commitment.key` at 0600 (an HSM/KMS in production); publish `keyring.json`; anchor batch roots at least hourly; store ledgers on append-only (WORM) storage; never run the proxy with `capture: plaintext`.
