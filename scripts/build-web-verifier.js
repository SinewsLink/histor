#!/usr/bin/env node
// Inlines verifier-web.js into a single self-contained index.html (works from file:// and any static host).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web-verifier');
const core = fs.readFileSync(path.join(dir, 'verifier-web.js'), 'utf8').replace(/^export /gm, '');
const html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8').replace('/*__VERIFIER__*/', core);
fs.writeFileSync(path.join(dir, 'index.html'), html);
fs.mkdirSync(path.join(dir, '..', 'packages', 'cli', 'assets'), { recursive: true });
fs.writeFileSync(path.join(dir, '..', 'packages', 'cli', 'assets', 'verifier.html'), html);
console.log('web-verifier/index.html written');
