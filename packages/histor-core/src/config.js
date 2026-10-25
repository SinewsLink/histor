import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function loadHistorConfig(file) {
  const abs = path.resolve(file);
  const base = path.dirname(abs);
  const c = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const r = (p) => (p ? path.resolve(base, p) : p);
  const principalEnv = process.env.HISTOR_PRINCIPAL;
  return {
    ...c,
    ledger_dir: r(c.ledger_dir || '.histor/ledger'),
    keys_dir: r(c.keys_dir || '.histor/keys'),
    approvals_dir: r(c.approvals_dir || '.histor/approvals'),
    policy: r(c.policy),
    signer: c.signer ? { ...c.signer, socket: r(c.signer.socket) } : null,
    principal: principalEnv
      ? { subject_id: principalEnv, idp: process.env.HISTOR_PRINCIPAL_IDP || 'env', authenticated: false }
      : c.principal || { subject_id: `${os.userInfo().username}@${os.hostname()}`, idp: 'os-user', authenticated: false },
    capture: { input: 'commitment', output: 'commitment', ...(c.capture || {}) },
  };
}
