#!/usr/bin/env node
// Usage: histor-mcp-proxy --config histor.config.json -- <upstream MCP server command...>
import { loadHistorConfig as loadConfig } from '@sinewslink/histor-core';
import { runProxy } from '../src/proxy.js';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 0 || sep === argv.length - 1) {
  process.stderr.write('usage: histor-mcp-proxy --config <histor.config.json> -- <upstream command> [args...]\n');
  process.exit(64);
}
const opts = argv.slice(0, sep);
const ci = opts.indexOf('--config');
const config = loadConfig(ci >= 0 ? opts[ci + 1] : 'histor.config.json');
const code = await runProxy(config, argv.slice(sep + 1));
process.exit(code);
