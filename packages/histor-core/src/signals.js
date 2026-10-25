// Risk signals recorded as evidence. SL Histor is not a firewall: these never
// block on their own (policy decides). They make the receipt say what an
// auditor would want flagged.

const INVISIBLE = /[\u{E0000}-\u{E007F}\u200B-\u200F\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/u;
const OVERRIDE = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i,
  /do not (tell|inform|mention to) the user/i,
  /\b(secretly|silently|without (telling|asking) the user)\b/i,
  /<\s*important\s*>/i,
  /before (using|calling) (this|any) tool/i,
  /(read|cat|send|upload)[^.]{0,60}(~\/\.ssh|id_rsa|\.env\b|credentials|private key)/i,
  /(send|post|forward|exfiltrate)[^.]{0,80}https?:\/\//i,
];
const BLOB = /[A-Za-z0-9+/=_-]{120,}/;

// Scan one MCP / function tool definition for poisoning indicators.
export function scanToolDefinition(tool) {
  const text = [tool?.name, tool?.description, JSON.stringify(tool?.inputSchema ?? {})].filter(Boolean).join('\n');
  const findings = [];
  if (INVISIBLE.test(text)) findings.push('invisible_or_bidi_characters');
  for (const re of OVERRIDE) if (re.test(text)) { findings.push('instruction_override_phrase'); break; }
  if (BLOB.test(tool?.description ?? '')) findings.push('encoded_blob_in_description');
  if (/https?:\/\//i.test(tool?.description ?? '')) findings.push('url_in_description');
  return findings;
}

// Repeated identical intent inside a short window = runaway loop suspicion.
export class LoopDetector {
  constructor({ windowSeconds = 30, maxRepeats = 5 } = {}) {
    this.windowMs = windowSeconds * 1000;
    this.max = maxRepeats;
    this.seen = new Map();
  }
  record(key, now = Date.now()) {
    if (!this.max) return { count: 0, loop: false };
    const hits = (this.seen.get(key) || []).filter((t) => now - t < this.windowMs);
    hits.push(now);
    this.seen.set(key, hits);
    return { count: hits.length, loop: hits.length >= this.max };
  }
}
