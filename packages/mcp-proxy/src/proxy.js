import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openLedger, draftReceipt, loadIssuerKey, loadCommitmentKey, commit, hashValue,
  loadPolicy, evaluatePolicy, failClosed, scanForSecrets, uuidv7, nowRfc3339,
  requestApproval, findValidApproval, consumeApproval, scanToolDefinition, LoopDetector,
} from '@sinewslink/histor-core';

const SOFTWARE = { name: 'histor-mcp-proxy', version: '0.2.0' };

export async function runProxy(config, upstreamCmd, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const log = (...a) => stderr.write('[histor] ' + a.join(' ') + '\n');
  const issuerKey = config.signer ? null : loadIssuerKey(config.keys_dir); // with a signer daemon the key never enters this process
  const ck = loadCommitmentKey(config.keys_dir);
  const policy = config.policy ? loadPolicy(config.policy) : { policy_id: 'none', version: '0', rules: [], default: { decision: 'allow', consequence: 'low' } };
  const serverLabel = config.server?.name || path.basename(upstreamCmd[upstreamCmd.length - 1] || 'mcp-server').replace(/\W+/g, '-');
  // One stream per proxy session: each session ends with a terminal receipt, so a
  // truncated or missing ending is visible. Streams of one deployment share a prefix.
  const baseStream = (config.stream_id || `mcp-${serverLabel}-${os.hostname()}`).toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  const sessionId = uuidv7();
  const streamId = `${baseStream}.${sessionId}`;
  const ledger = openLedger(config, { streamId, issuerKey });
  const keyId = config.signer ? (await ledger.ping()).key_id : issuerKey.keyId;
  const loops = new LoopDetector({ windowSeconds: config.loop?.window_seconds ?? 30, maxRepeats: config.loop?.max_repeats ?? 5 });
  let interrupted = false;

  const session = { client: null, server: null, protocol: null, tools: new Map() };
  const pending = new Map(); // jsonrpc id -> call context (client-initiated tools/call)
  const issuer = { type: 'mcp-proxy', software: SOFTWARE, host: os.hostname(), key_id: keyId };
  const common = () => ({
    issuer,
    tenant: config.tenant || null,
    principal: config.principal,
    agent: { ...(config.agent || {}), client: session.client },
    session: { session_id: sessionId, protocol: 'mcp', protocol_version: session.protocol },
  });
  const cm = (v) => (config.capture.input === 'none' ? null : commit(v ?? null, ck.key, ck.keyId));
  const size = (v) => Buffer.byteLength(JSON.stringify(v ?? null));

  // Appends are issued in order; a local ledger seals synchronously, a remote
  // signer receives them in order over one socket.
  const write = async (receipt, consequence = 'low', opts) => {
    try { return await ledger.append(receipt, opts); }
    catch (e) { log('LEDGER WRITE FAILED:', e.message); if (failClosed(policy, consequence)) throw e; return null; }
  };

  const child = spawn(upstreamCmd[0], upstreamCmd.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  child.stderr.on('data', (d) => stderr.write(d));
  const toServer = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  const toClient = (msg) => stdout.write(JSON.stringify(msg) + '\n');

  // ---------- client -> server ----------
  const onClientMessage = (msg) => {
    if (Array.isArray(msg)) { msg.forEach(onClientMessage); return; }
    if (msg.method === 'initialize') {
      session.client = msg.params?.clientInfo || null;
      session.protocol = msg.params?.protocolVersion || null;
      pending.set(msg.id, { type: 'initialize' });
      return toServer(msg);
    }
    if (msg.method === 'tools/list' && msg.id != null) { pending.set(msg.id, { type: 'tools/list' }); return toServer(msg); }
    if (msg.method === 'notifications/cancelled') {
      const ctx = pending.get(msg.params?.requestId);
      if (ctx) ctx.cancelled = true;
      return toServer(msg);
    }
    if (msg.method === 'tools/call' && msg.id != null) return handleToolCall(msg);
    return toServer(msg);
  };

  const handleToolCall = (msg) => {
    const tool = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    const evald = evaluatePolicy(policy, { server: serverLabel, tool, args });
    const binding = commit({ server: serverLabel, tool, arguments: args }, ck.key, ck.keyId).value;
    const signals = [];
    if (evald.flag) signals.push({ type: 'policy_flag', severity: 'medium', source: `policy:${evald.rule_id}`, detail: evald.reason || null });
    const loop = loops.record(binding);
    if (loop.loop) signals.push({ type: 'loop_suspected', severity: 'medium', source: 'histor-loop-detector', detail: `identical call ${loop.count}x within ${config.loop?.window_seconds ?? 30}s` });
    const toolMeta = session.tools.get(tool);
    if (toolMeta?.findings?.length) signals.push({ type: 'tool_definition_suspicious', severity: 'high', source: 'histor-tool-scan', detail: toolMeta.findings.join(',') });
    const ctx = {
      receiptId: uuidv7(),
      signals,
      type: 'tools/call', tool, args, evald, binding,
      started_at: nowRfc3339(), t0: process.hrtime.bigint(),
      traceparent: msg.params?._meta?.traceparent || null,
      approval: { required: evald.decision === 'require_approval', status: 'not_required' },
    };

    if (loop.loop && config.loop?.action === 'deny') return deny(msg, ctx, `Loop suspected: identical call repeated ${loop.count} times`);
    if (evald.decision === 'deny') return deny(msg, ctx, `Blocked by policy rule ${evald.rule_id}${evald.reason ? ': ' + evald.reason : ''}`);

    if (evald.decision === 'require_approval') {
      const found = findValidApproval(config.approvals_dir, { payload_hash: binding, principalId: config.principal.subject_id, separationOfDuties: policy.approval?.separation_of_duties !== false });
      if (found.status !== 'approved') {
        const req = requestApproval(config.approvals_dir, {
          payload_hash: binding, server: serverLabel, tool, arguments: args,
          principal: config.principal, agent_id: config.agent?.agent_id || null, rule_id: evald.rule_id, consequence: evald.consequence,
        });
        ctx.approval = { required: true, status: { denied: 'denied', sod_violation: 'rejected_sod', expired_or_consumed: 'expired_or_consumed' }[found.status] || 'pending', request_id: req.request_id };
        return deny(msg, ctx, `Human approval required (${evald.consequence} consequence, rule ${evald.rule_id}). ` +
          ({ denied: 'A human DENIED this exact action. ', sod_violation: 'Approval rejected: approver cannot be the requesting principal. ', expired_or_consumed: 'The previous approval for this exact action was already used or has expired. ' }[found.status] || '') +
          `Request ${req.request_id} is waiting. Run: histor approve ${req.request_id} --approver <you>. Then retry the identical call.`);
      }
      const a = found.approval;
      ctx.approvalRecord = a;
      consumeApproval(config.approvals_dir, a, ctx.receiptId); // single use: consumed the moment execution is allowed
      ctx.approval = {
        required: true, status: 'approved', approval_id: a.approval_id, request_id: a.request_id,
        approvers: [{ approver: a.approver, method: a.method, decision: 'approved', decided_at: a.decided_at, expires_at: a.expires_at, decision_latency_ms: a.decision_latency_ms, approved_payload_commitment: a.payload_hash }],
        quorum: { required: 1, obtained: 1 },
        separation_of_duties: { required: policy.approval?.separation_of_duties !== false, satisfied: true },
      };
    }

    if (!config.signer && failClosed(policy, evald.consequence)) {
      try { fs.accessSync(config.ledger_dir, fs.constants.W_OK); }
      catch { return deny(msg, ctx, 'Evidence ledger unavailable; high-consequence actions fail closed.'); }
    }
    pending.set(msg.id, ctx);
    toServer(msg);
  };

  const deny = (msg, ctx, text) => {
    const r = draftReceipt('denial', {
      ...common(),
      trace: { jsonrpc_id: msg.id, traceparent: ctx.traceparent },
      action: actionBlock(ctx),
      authorization: authBlock(ctx),
      approval: ctx.approval,
      ...(ctx.signals?.length ? { risk: { signals: ctx.signals } } : {}),
      outcome: { status: 'denied', started_at: ctx.started_at, ended_at: nowRfc3339(), detail: text },
    });
    write(r, ctx.evald.consequence).catch(() => { /* already logged; still deny */ });
    toClient({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `[SL Histor] ${text}` }], isError: true } });
  };

  const actionBlock = (ctx) => {
    const meta = session.tools.get(ctx.tool);
    return {
      category: 'tool_call',
      tool: {
        protocol: 'mcp', server_name: serverLabel, server_version: session.server?.version || null,
        tool_name: ctx.tool, tool_definition_hash: meta?.hash || null,
        annotations: meta?.annotations || null,
      },
      input: { commitment: cm(ctx.args), size_bytes: size(ctx.args), secret_scan: scanForSecrets(ctx.args) },
      payload_commitment: ctx.binding,
      consequence: ctx.evald.consequence,
      reversibility: ctx.evald.reversibility,
    };
  };
  const authBlock = (ctx) => ({
    decision: ctx.evald.decision, rule_id: ctx.evald.rule_id, allowed_by_default: !!ctx.evald.allowed_by_default,
    policy: ctx.evald.policy, evaluated_at: ctx.started_at, enforcer: { type: 'mcp-proxy', key_id: keyId },
  });

  // ---------- server -> client ----------
  const onServerMessage = (msg) => {
    if (Array.isArray(msg)) { msg.forEach(onServerMessage); return; }
    const ctx = msg.id != null && (msg.result !== undefined || msg.error !== undefined) ? pending.get(msg.id) : null;
    if (ctx) {
      pending.delete(msg.id);
      // Evidence must never break agent traffic: record, but always forward.
      try { recordResponse(msg, ctx); } catch (e) { log('evidence error (response still forwarded):', e.message); }
    }
    toClient(msg);
  };

  const recordResponse = (msg, ctx) => {
    {
      if (ctx.type === 'initialize') {
        session.server = msg.result?.serverInfo || null;
        write(draftReceipt('session.start', { ...common(), server: session.server, capabilities_hash: msg.result?.capabilities ? hashValue(msg.result.capabilities) : null })).catch(() => {});
      } else if (ctx.type === 'tools/list') {
        recordToolSurface(msg.result?.tools || []);
      } else if (ctx.type === 'tools/call') {
        finishCall(msg, ctx);
      }
    }
  };

  const recordToolSurface = (tools) => {
    const manifest = {};
    for (const t of tools) {
      const h = hashValue({ name: t.name, description: t.description ?? null, inputSchema: t.inputSchema ?? null, annotations: t.annotations ?? null });
      manifest[t.name] = h;
      const findings = scanToolDefinition(t);
      session.tools.set(t.name, { hash: h, annotations: t.annotations || null, findings });
      if (findings.length) log(`WARNING tool "${t.name}" definition looks suspicious: ${findings.join(', ')}`);
    }
    const suspicious = [...session.tools.entries()].filter(([, m]) => m.findings.length).map(([n, m]) => ({ type: 'tool_definition_suspicious', severity: 'high', source: 'histor-tool-scan', detail: `${n}: ${m.findings.join(',')}` }));
    fs.mkdirSync(config.ledger_dir, { recursive: true });
    const stateFile = path.join(config.ledger_dir, `${baseStream}.tools.json`);
    const prev = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
    const surfaceHash = hashValue(manifest);
    if (!prev || prev.surface_hash !== surfaceHash) {
      const before = prev?.manifest || {};
      const diff = {
        added: Object.keys(manifest).filter((k) => !(k in before)),
        removed: Object.keys(before).filter((k) => !(k in manifest)),
        changed: Object.keys(manifest).filter((k) => k in before && before[k] !== manifest[k]),
      };
      write(draftReceipt('agent.change', {
        ...common(),
        change: { type: prev ? 'tool_surface_changed' : 'tool_surface_first_seen', server_name: serverLabel, previous_surface_hash: prev?.surface_hash || null, surface_hash: surfaceHash, diff },
        ...(suspicious.length ? { risk: { signals: suspicious } } : {}),
      }), diff.changed.length || suspicious.length ? 'high' : 'low').catch(() => {});
      fs.writeFileSync(stateFile, JSON.stringify({ surface_hash: surfaceHash, manifest }, null, 2));
      if (prev && diff.changed.length) log(`WARNING tool definitions changed since last session: ${diff.changed.join(', ')} (possible tool poisoning / rug-pull)`);
    }
  };

  const finishCall = (msg, ctx) => {
    const ended = nowRfc3339();
    const durationMs = Number((process.hrtime.bigint() - ctx.t0) / 1_000_000n);
    const isErr = msg.error !== undefined || msg.result?.isError === true;
    const output = msg.error ?? msg.result;
    const r = draftReceipt('action', {
      receipt_id: ctx.receiptId,
      ...common(),
      trace: { jsonrpc_id: msg.id, traceparent: ctx.traceparent },
      action: actionBlock(ctx),
      authorization: authBlock(ctx),
      approval: ctx.approval,
      ...(ctx.signals?.length ? { risk: { signals: ctx.signals } } : {}),
      outcome: {
        status: ctx.cancelled ? 'cancelled' : msg.error ? 'error' : isErr ? 'tool_error' : 'success',
        started_at: ctx.started_at, ended_at: ended, duration_ms: durationMs,
        output: { commitment: config.capture.output === 'none' ? null : commit(output ?? null, ck.key, ck.keyId), size_bytes: size(output), secret_scan: scanForSecrets(output) },
        error: msg.error ? { code: msg.error.code, message_commitment: commit(msg.error.message ?? '', ck.key, ck.keyId) } : null,
      },
    });
    write(r, ctx.evald.consequence).catch(() => {});
  };

  // ---------- wiring ----------
  const parseLines = (stream, handler, label) => {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch { log(`non-JSON line from ${label}, forwarding untouched`); (label === 'client' ? child.stdin : stdout).write(line + '\n'); return; }
      try { handler(msg); } catch (e) { log(`error handling ${label} message:`, e.stack || e.message); }
    });
    return rl;
  };
  parseLines(stdin, onClientMessage, 'client');
  parseLines(child.stdout, onServerMessage, 'server');
  stdin.on('end', () => child.stdin.end());

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { interrupted = true; child.kill(sig); });
  return new Promise((resolve) => {
    child.on('exit', async (code, signal) => {
      for (const [id, ctx] of pending) {
        if (ctx.type !== 'tools/call') continue;
        await write(draftReceipt('action', { receipt_id: ctx.receiptId, ...common(), trace: { jsonrpc_id: id }, action: actionBlock(ctx), authorization: authBlock(ctx), approval: ctx.approval, outcome: { status: 'no_response', started_at: ctx.started_at, ended_at: nowRfc3339() } }), ctx.evald.consequence).catch(() => {});
      }
      try { await ledger.append(draftReceipt('session.end', { ...common(), exit: { code, signal } }), { terminal: true, status: interrupted || signal ? 'interrupted' : 'complete' }); }
      catch (e) { log('could not write terminal receipt:', e.message); }
      ledger.close();
      resolve(code ?? 0);
    });
  });
}
