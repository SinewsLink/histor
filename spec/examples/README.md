# Histor v0.1 examples

Every receipt here is real output, signed by the key in `keyring.json` and verifiable with
`histor verify` once placed back in stream order. 01–07 come from the MCP proxy demo (stream `demo-stream`);
08–12 exercise the remaining schema blocks (stream `examples-rich`); 13 is a Merkle batch over 08–12.
Regenerate with `node scripts/make-examples.js`. Note: 13 carries an unsigned anchors array, which is appended after sealing by design.
