// Out-of-process signer. The agent-side proxy or hook never holds the signing
// key: it sends unsigned receipt bodies over a local socket, and the signer
// seals, chains, fsyncs and returns them. This also serializes all writers, so
// parallel hook processes can never interleave a chain.
//
// Protocol: newline-delimited JSON over a Unix socket (named pipe on Windows).
//   {"id":1,"op":"append","stream":"…","receipt":{…},"terminal":false,"status":null}
//   {"id":2,"op":"ping"}
// Response: {"id":1,"ok":true,"sealed":{…}} | {"id":1,"ok":false,"error":"…"}
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Ledger } from './ledger.js';
import { loadIssuerKey } from './keys.js';

// Node on Windows only listens on named pipes (\\.\pipe\…), never on file paths.
// Map a socket path to a stable pipe name so one config works on every platform.
export function ipcPath(socketPath, platform = process.platform) {
  if (platform !== 'win32' || /^\\\\[.?]\\pipe\\/i.test(socketPath)) return socketPath;
  const id = createHash('sha256').update(path.win32.resolve(socketPath).toLowerCase()).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\histor-${id}`;
}

export function startSigner({ socketPath, keysDir, ledgerDir }) {
  const issuerKey = loadIssuerKey(keysDir);
  const ledgers = new Map();
  const ledgerFor = (stream) => {
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(stream)) throw new Error('invalid stream id');
    if (!ledgers.has(stream)) ledgers.set(stream, new Ledger({ dir: ledgerDir, streamId: stream, issuerKey }));
    return ledgers.get(stream);
  };
  if (process.platform !== 'win32' && fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let req;
        try { req = JSON.parse(line); } catch { sock.write(JSON.stringify({ ok: false, error: 'bad json' }) + '\n'); continue; }
        try {
          if (req.op === 'ping') sock.write(JSON.stringify({ id: req.id, ok: true, key_id: issuerKey.keyId }) + '\n');
          else if (req.op === 'append') {
            if (req.receipt?.seal || req.receipt?.chain) throw new Error('send unsealed bodies only');
            const sealed = ledgerFor(req.stream).append(req.receipt, { terminal: !!req.terminal, status: req.status || null });
            sock.write(JSON.stringify({ id: req.id, ok: true, sealed }) + '\n');
          } else throw new Error(`unknown op ${req.op}`);
        } catch (e) { sock.write(JSON.stringify({ id: req.id, ok: false, error: e.message }) + '\n'); }
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(ipcPath(socketPath), () => {
      if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600);
      resolve({ server, keyId: issuerKey.keyId, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// Client used by the proxy and hook when config.signer.socket is set.
export class RemoteLedger {
  constructor({ socketPath, streamId }) { this.socketPath = socketPath; this.streamId = streamId; this.n = 0; this.pending = new Map(); this.sock = null; this.buf = ''; }
  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const s = net.createConnection(ipcPath(this.socketPath), () => resolve(s));
      s.on('error', (e) => { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); this.ready = null; reject(e); });
      s.on('data', (d) => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const res = JSON.parse(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 1);
          const p = this.pending.get(res.id); if (!p) continue;
          this.pending.delete(res.id);
          res.ok ? p.resolve(res.sealed ?? res) : p.reject(new Error(res.error));
        }
      });
      this.sock = s;
    });
    return this.ready;
  }
  async request(msg) {
    const s = await this.connect();
    const id = ++this.n;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); s.write(JSON.stringify({ id, ...msg }) + '\n'); });
  }
  append(receipt, { terminal = false, status = null } = {}) { return this.request({ op: 'append', stream: this.streamId, receipt, terminal, status }); }
  ping() { return this.request({ op: 'ping' }); }
  close() { this.sock?.end(); }
}

// One interface for both modes: append() always returns a Promise of the sealed receipt.
export function openLedger(config, { streamId, issuerKey }) {
  if (config.signer?.socket) return new RemoteLedger({ socketPath: config.signer.socket, streamId });
  const l = new Ledger({ dir: config.ledger_dir, streamId, issuerKey });
  return { local: l, append: async (r, o) => l.append(r, o), ping: async () => ({ ok: true }), close() {} };
}
