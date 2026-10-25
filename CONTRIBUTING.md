# Contributing
1. `npm install && npm test` must pass. Add a test for every behaviour change.
2. Regenerate fixtures after emitter or spec changes: `npm run build && npm run vectors && npm run examples`.
3. **Spec or schema changes:** follow `.claude/skills/histor-spec-steward/SKILL.md`. One change updates schema + spec text + examples (`node scripts/make-examples.js`) + tests + `docs/02-dont-miss-checklist.md` + `CHANGELOG.md`.
4. **New emitters/integrations:** follow `.claude/skills/histor-integration-builder/SKILL.md`.
5. Never put raw tool arguments, outputs, prompts or secrets in a receipt. Use `commit()`.
6. No floats for money. Decimal strings only.
7. Commits: conventional style (`feat:`, `fix:`, `spec:`, `docs:`). Sign off (DCO): `git commit -s`.
