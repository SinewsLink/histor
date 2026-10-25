// Scripted OpenAI-compatible "model" so the test is deterministic and needs no API key.
// Rule: if the latest user prompt asks for a transfer and the last message is that user prompt,
// call the transfer tool with fixed arguments. After a tool result, signal and reply with text.
import http from 'node:http';
import fs from 'node:fs';
const PORT = Number(process.env.PORT || 8765);
const here = (f) => new URL('./' + f, import.meta.url).pathname;
const LOG = process.env.FAKE_LOG || here('fake-model.log');
const log = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');
let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    log('REQ', req.method, req.url);
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] })); }
    let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    const msgs = j.messages || []; const last = msgs[msgs.length - 1] || {};
    const tools = (j.tools || []).map((t) => t.function?.name).filter(Boolean);
    const transfer = tools.find((t) => t.endsWith('transfer_funds'));
    log('  tools=', tools.join(','), 'last.role=', last.role, 'stream=', !!j.stream);
    let reply;
    if (transfer && last.role === 'user' && /transfer/i.test(JSON.stringify(last.content))) {
      reply = { tool: { id: 'call_' + (++n), name: transfer, args: JSON.stringify({ from: 'acct-A', to: 'acct-B', amount: '500.00' }) } };
    } else if (last.role === 'tool') {
      const t = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
      log('  TOOL_RESULT', t.slice(0, 300));
      fs.writeFileSync(here('tool-result-seen'), t);
      reply = { text: 'Done. Tool said: ' + t.slice(0, 200) };
      if (fs.existsSync(here('hang.flag'))) { log('  hanging (simulated crash window)'); return; } // never answers: harness kills goose here
    } else {
      reply = { text: 'ok' };
    }
    const id = 'chatcmpl-' + Date.now();
    const base = { id, created: Math.floor(Date.now() / 1000), model: j.model || 'fake-model' };
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o) => res.write('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', ...o }) + '\n\n');
      if (reply.tool) {
        send({ choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: reply.tool.id, type: 'function', function: { name: reply.tool.name, arguments: reply.tool.args } }] }, finish_reason: null }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        send({ choices: [{ index: 0, delta: { role: 'assistant', content: reply.text }, finish_reason: null }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      send({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
      res.write('data: [DONE]\n\n'); return res.end();
    }
    const message = reply.tool
      ? { role: 'assistant', content: null, tool_calls: [{ id: reply.tool.id, type: 'function', function: { name: reply.tool.name, arguments: reply.tool.args } }] }
      : { role: 'assistant', content: reply.text };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: reply.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
  });
}).listen(PORT, '127.0.0.1', () => log('listening', PORT));
