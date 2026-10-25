#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initKeyDir, loadIssuerKey, loadKeyring, readLedger, verifyStream, createBatch, verifyBatch,
  proofFor, verifyProof, listPending, decide, priceUsage, naivePrice, normalizeAnthropicUsage,
  normalizeOpenAIUsage, reconcile, startSigner, Ledger, loadIssuerKey as loadKey, generateIssuerKey, draftReceipt,
  exportAgentReceipts, readLedger as readL,
} from '@sinewslink/histor-core';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };
const pos = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
const dir = (d) => path.resolve(flag('witness', '.histor'), d);
const out = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o, null, 2)) + '\n');
const die = (m, c = 1) => { process.stderr.write(m + '\n'); process.exit(c); };

const cmds = {
  init() {
    const keys = dir('keys');
    if (fs.existsSync(path.join(keys, 'issuer.key')) && !rest.includes('--rotate')) die(`keys already exist in ${keys} (use --rotate to add a new key)`);
    const id = initKeyDir(keys, { rotate: rest.includes('--rotate') });
    const base = path.resolve(flag('witness', '.histor'));
    const cfgPath = path.join(base, 'histor.config.json');
    if (!fs.existsSync(cfgPath)) {
      fs.writeFileSync(path.join(base, 'policy.json'), JSON.stringify({ policy_id: 'default', version: new Date().toISOString().slice(0, 10) + '.1', default: { decision: 'allow', consequence: 'low' },
        rules: [ { id: 'destructive', match: { tool: '*delete*' }, approval: 'required', consequence: 'high', reversibility: 'irreversible' },
                 { id: 'money', match: { tool: '*transfer*' }, approval: 'required', consequence: 'critical', reversibility: 'compensable' },
                 { id: 'deploy', match: { tool: '*deploy*' }, approval: 'required', consequence: 'high', reversibility: 'compensable' } ],
        approval: { ttl_seconds: 3600, separation_of_duties: true }, fail_mode: 'closed_for_high' }, null, 2));
      fs.writeFileSync(cfgPath, JSON.stringify({ ledger_dir: './ledger', keys_dir: './keys', approvals_dir: './approvals', policy: './policy.json',
        principal: { subject_id: `${os.userInfo().username}@${os.hostname()}`, idp: 'os-user', authenticated: false },
        agent: { agent_id: 'my-agent', name: 'My agent' }, loop: { window_seconds: 30, max_repeats: 5 } }, null, 2));
    }
    out(`issuer key ${id} written to ${keys}\nconfig: ${cfgPath} (edit principal and agent)\npublish keyring.json to verifiers; keep issuer.key and commitment.key secret`);
  },
  pending() {
    const p = listPending(dir('approvals'));
    if (!p.length) return out('no pending approvals');
    for (const r of p) out(`${r.request_id}  ${r.created_at}  ${r.server}/${r.tool}  consequence=${r.consequence}  principal=${r.principal?.subject_id}\n  args: ${JSON.stringify(r.arguments)}`);
  },
  approve() { decision('approved'); },
  deny() { decision('denied'); },
  verify() {
    const file = pos[0] || die('usage: histor verify <ledger.jsonl> [--keyring keyring.json]');
    const o = {};
    if (flag('expected-length')) o.expectedLength = Number(flag('expected-length'));
    if (flag('expected-hash')) o.expectedFinalHash = flag('expected-hash');
    const res = verifyStream(readLedger(file), loadKeyring(flag('keyring', dir('keys'))), o);
    out(res);
    process.exit(res.ok ? 0 : 2);
  },
  seal() {
    const file = pos[0] || die('usage: histor seal <ledger.jsonl> [--from N] [--to M] [--out batch.json]');
    const all = readLedger(file);
    const from = Number(flag('from', all[0]?.chain.sequence ?? 0));
    const to = Number(flag('to', all[all.length - 1]?.chain.sequence ?? 0));
    const batch = createBatch(all.filter((r) => r.chain.sequence >= from && r.chain.sequence <= to), loadIssuerKey(dir('keys')));
    const dest = flag('out', `${file.replace(/\.jsonl$/, '')}.batch-${from}-${to}.json`);
    fs.writeFileSync(dest, JSON.stringify(batch, null, 2));
    out({ batch: dest, root: batch.root, tree_size: batch.tree_size, next: 'anchor batch.root (e.g. `ots stamp` on a file containing the root, or submit to your transparency log) and record it in batch.anchors' });
  },
  prove() {
    const [file, batchFile, receiptId] = pos;
    if (!receiptId) die('usage: histor prove <ledger.jsonl> <batch.json> <receipt_id>');
    const batch = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
    const rs = readLedger(file).filter((r) => r.chain.sequence >= batch.first_sequence && r.chain.sequence <= batch.last_sequence);
    const proof = proofFor(rs, batch, receiptId);
    const receipt = rs.find((r) => r.receipt_id === receiptId);
    out({ receipt_id: receiptId, proof, batch_signature_ok: verifyBatch(batch, loadKeyring(flag('keyring', dir('keys')))).length === 0, inclusion_ok: verifyProof(receipt, proof) });
  },
  inspect() {
    const file = pos[0] || die('usage: histor inspect <ledger.jsonl>');
    for (const r of readLedger(file)) {
      const a = r.action?.tool;
      out(`${String(r.chain.sequence).padStart(5)}  ${r.issued_at}  ${r.kind.padEnd(14)} ${a ? `${a.server_name}/${a.tool_name}` : ''}  ${r.authorization?.decision ?? ''} ${r.approval?.status && r.approval.status !== 'not_required' ? 'approval=' + r.approval.status : ''} ${r.outcome?.status ?? ''}  principal=${r.principal?.subject_id ?? '-'}`);
    }
  },
  cost() {
    const pricing = JSON.parse(fs.readFileSync(flag('pricing') || die('--pricing <file> required'), 'utf8'));
    const usage = JSON.parse(flag('usage') || die("--usage '<provider usage json>' required"));
    const model = flag('model') || die('--model required');
    const buckets = flag('provider', 'anthropic') === 'openai' ? normalizeOpenAIUsage(usage) : normalizeAnthropicUsage(usage);
    const priced = priceUsage(pricing, model, buckets, { batch: rest.includes('--batch') });
    out({ buckets, ...priced, naive_amount: naivePrice(pricing, model, buckets) });
  },
  async signer() {
    const sock = flag('socket', path.join(os.tmpdir(), 'histor-signer.sock'));
    const sgn = await startSigner({ socketPath: sock, keysDir: dir('keys'), ledgerDir: dir('ledger') });
    out(`histor signer listening on ${sock} (key ${sgn.keyId}); set "signer": {"socket": "${sock}"} in histor.config.json`);
  },
  rotate() {
    const file = pos[0] || die('usage: histor rotate <ledger.jsonl> [--reason "..."]');
    const keysDir = dir('keys');
    const oldKey = loadKey(keysDir);
    const streamId = path.basename(file).replace(/\.jsonl$/, '');
    const l = new Ledger({ dir: path.dirname(path.resolve(file)), streamId, issuerKey: oldKey });
    const newKeyId = initKeyDir(keysDir, { rotate: true });
    const sealed = l.rotateKey(loadKey(keysDir), draftReceipt, flag('reason', 'scheduled rotation'));
    out(`rotated ${oldKey.keyId} -> ${newKeyId}; rotation receipt ${sealed.receipt_id} signed with the outgoing key`);
  },
  export() {
    const file = pos[0] || die('usage: histor export <ledger.jsonl> --issuer did:web:yourco.com:agent [--out receipts.ar.json]');
    const key = loadKey(dir('keys'));
    const ars = exportAgentReceipts(readLedger(file), { privatePem: key.privatePem, verificationMethod: flag('verification-method', `${flag('issuer', 'did:web:example.com:histor')}#${key.keyId}`), issuerId: flag('issuer', 'did:web:example.com:histor'), operator: flag('operator') ? { id: flag('operator'), name: flag('operator-name', flag('operator')) } : undefined });
    const dest = flag('out', file.replace(/\.jsonl$/, '.agent-receipts.json'));
    fs.writeFileSync(dest, JSON.stringify(ars, null, 2));
    out(`${ars.length} Agent Receipts (v0.5.0) written to ${dest}`);
  },
  serve() {
    const port = Number(flag('port', 7337));
    const ledgerDir = dir('ledger');
    const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'verifier.html'));
    http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); }
      if (req.url.startsWith('/api/bundle')) {
        const files = fs.existsSync(ledgerDir) ? fs.readdirSync(ledgerDir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f, t: fs.statSync(path.join(ledgerDir, f)).mtimeMs })).sort((a, b) => b.t - a.t) : [];
        const want = new URL(req.url, 'http://x').searchParams.get('stream');
        const pick = files.find((x) => x.f === want) || files[0];
        if (!pick) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ stream: pick.f, receipts: readLedger(path.join(ledgerDir, pick.f)), keyring: JSON.parse(fs.readFileSync(path.join(dir('keys'), 'keyring.json'), 'utf8')) }));
      }
      res.writeHead(404); res.end();
    }).listen(port, '127.0.0.1', () => out(`SL Histor viewer on http://127.0.0.1:${port} (latest stream in ${ledgerDir})`));
  },
  reconcile() {
    const invoice = flag('invoice') || die('--invoice <amount> required');
    const amounts = pos.flatMap((f) => readLedger(f)).filter((r) => r.cost?.amount).map((r) => r.cost.amount);
    out(reconcile(amounts, invoice, flag('tolerance', '0.5')));
  },
};

function decision(kind) {
  const id = pos[0] || die(`usage: histor ${kind === 'approved' ? 'approve' : 'deny'} <request_id> --approver <subject_id> [--idp oidc] [--ttl 3600] [--reason "..."]`);
  const approver = { subject_id: flag('approver') || die('--approver required (the accountable human)'), idp: flag('idp', 'local-cli'), host: os.hostname() };
  const { request, decision: d } = decide(dir('approvals'), { requestId: id, approver, decision: kind, ttlSeconds: Number(flag('ttl', 3600)), reason: flag('reason', null) });
  out(`${kind} ${request.server}/${request.tool} for ${request.principal?.subject_id}; valid until ${d.expires_at}, single use, bound to ${d.payload_hash.slice(0, 24)}…`);
}

if (!cmds[cmd]) die('commands: init | pending | approve | deny | inspect | verify | seal | prove | export | rotate | signer | serve | cost | reconcile', cmd ? 1 : 0);
await cmds[cmd]();
