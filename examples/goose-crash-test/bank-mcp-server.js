// A tiny "bank" MCP server whose side effects persist on disk, like a real database.
// Every executed transfer appends one line to transfers.log, so a double execution is visible.
import readline from 'node:readline';
import fs from 'node:fs';
const LOGF = process.env.BANK_LOG || new URL('./transfers.log', import.meta.url).pathname;
const tools = [
  { name: 'list_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'transfer_funds', description: 'Move money between accounts.', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, amount: { type: 'string' } }, required: ['from', 'to', 'amount'] }, annotations: { destructiveHint: true } },
];
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id == null) return;
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'bank', version: '1.0.0' } } });
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  if (msg.method === 'tools/call') {
    const { name, arguments: a = {} } = msg.params;
    if (name === 'list_accounts') return send({ jsonrpc: '2.0', id: msg.id, result: text('acct-A, acct-B') });
    if (name === 'transfer_funds') {
      fs.appendFileSync(LOGF, `${new Date().toISOString()} TRANSFERRED ${a.amount} ${a.from}->${a.to} pid=${process.pid}\n`);
      return send({ jsonrpc: '2.0', id: msg.id, result: text(`transferred ${a.amount} from ${a.from} to ${a.to}`) });
    }
    return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `unknown tool ${name}` } });
  }
  if (msg.method === 'ping') return send({ jsonrpc: '2.0', id: msg.id, result: {} });
  return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
});
