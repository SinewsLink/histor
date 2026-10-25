// Cost truth engine. Exact decimal arithmetic (BigInt, no floats), all token
// buckets priced separately, provider usage normalized to one shape.
//
// The four billable buckets (cache writes split by TTL where the provider does):
//   input_tokens            uncached input
//   output_tokens           output, INCLUDING reasoning/thinking tokens
//   cache_write_tokens      {ttl_5m, ttl_1h}
//   cache_read_tokens       cache hits
//
// Trap this module exists to prevent: providers disagree on whether "input"
// includes cached tokens. Anthropic's input_tokens EXCLUDES cache reads/writes;
// OpenAI's prompt_tokens INCLUDES cached_tokens. Summing raw fields across
// providers silently double-counts or drops money.

const SCALE = 18n; // fixed-point digits

function toFixed(dec) {
  if (typeof dec !== 'string' || !/^-?\d+(\.\d+)?$/.test(dec)) throw new Error(`price must be a decimal string, got ${dec}`);
  const neg = dec.startsWith('-');
  const [i, f = ''] = dec.replace('-', '').split('.');
  if (BigInt(f.length) > SCALE) throw new Error(`too many decimals: ${dec}`);
  const v = BigInt(i) * 10n ** SCALE + BigInt((f + '0'.repeat(Number(SCALE))).slice(0, Number(SCALE)) || '0');
  return neg ? -v : v;
}

function fromFixed(v, places = 8) {
  const neg = v < 0n;
  if (neg) v = -v;
  const div = 10n ** (SCALE - BigInt(places));
  let q = v / div;
  if ((v % div) * 2n >= div) q += 1n; // round half up at `places`
  const s = q.toString().padStart(places + 1, '0');
  return (neg ? '-' : '') + s.slice(0, -places) + '.' + s.slice(-places);
}

export function emptyBuckets() {
  return { input_tokens: 0, output_tokens: 0, cache_write_tokens: { ttl_5m: 0, ttl_1h: 0 }, cache_read_tokens: 0 };
}

export function normalizeAnthropicUsage(u = {}) {
  const b = emptyBuckets();
  b.input_tokens = u.input_tokens || 0;
  b.output_tokens = u.output_tokens || 0;
  b.cache_read_tokens = u.cache_read_input_tokens || 0;
  const cc = u.cache_creation || null;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    b.cache_write_tokens.ttl_5m = cc.ephemeral_5m_input_tokens || 0;
    b.cache_write_tokens.ttl_1h = cc.ephemeral_1h_input_tokens || 0;
  } else {
    b.cache_write_tokens.ttl_5m = u.cache_creation_input_tokens || 0; // default TTL is 5m
  }
  return b;
}

export function normalizeOpenAIUsage(u = {}) {
  const b = emptyBuckets();
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
  const prompt = u.prompt_tokens ?? u.input_tokens ?? 0;
  b.input_tokens = Math.max(0, prompt - cached);
  b.cache_read_tokens = cached;
  b.output_tokens = u.completion_tokens ?? u.output_tokens ?? 0; // includes reasoning tokens
  return b;
}

export function addBuckets(a, b) {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_write_tokens: {
      ttl_5m: a.cache_write_tokens.ttl_5m + b.cache_write_tokens.ttl_5m,
      ttl_1h: a.cache_write_tokens.ttl_1h + b.cache_write_tokens.ttl_1h,
    },
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
  };
}

function ratesFor(pricing, model, buckets, opts) {
  const m = pricing.models[model];
  if (!m) throw new Error(`no pricing for model "${model}" in ${pricing.pricing_id}`);
  let rates = m;
  if (m.long_context) {
    const totalIn = buckets.input_tokens + buckets.cache_read_tokens + buckets.cache_write_tokens.ttl_5m + buckets.cache_write_tokens.ttl_1h;
    if (totalIn > m.long_context.threshold_input_tokens) rates = { ...m, ...m.long_context.rates };
  }
  return rates;
}

export function priceUsage(pricing, model, buckets, opts = {}) {
  const r = ratesFor(pricing, model, buckets, opts);
  const per = (tokens, rate) => (BigInt(tokens) * toFixed(rate)) / 1_000_000n;
  const lines = {
    input: per(buckets.input_tokens, r.input),
    output: per(buckets.output_tokens, r.output),
    cache_write_5m: per(buckets.cache_write_tokens.ttl_5m, r.cache_write_5m ?? r.input),
    cache_write_1h: per(buckets.cache_write_tokens.ttl_1h, r.cache_write_1h ?? r.cache_write_5m ?? r.input),
    cache_read: per(buckets.cache_read_tokens, r.cache_read ?? r.input),
  };
  let total = Object.values(lines).reduce((a, b) => a + b, 0n);
  if (opts.batch && pricing.modifiers?.batch_multiplier) total = (total * toFixed(pricing.modifiers.batch_multiplier)) / 10n ** SCALE;
  return {
    currency: pricing.currency,
    amount: fromFixed(total),
    lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, fromFixed(v)])),
    method: opts.batch ? 'list_price_batch' : 'list_price',
    pricing_ref: { pricing_id: pricing.pricing_id, effective_date: pricing.effective_date },
  };
}

// What most dashboards do: price every token as plain input/output.
export function naivePrice(pricing, model, buckets) {
  const flat = {
    ...emptyBuckets(),
    input_tokens: buckets.input_tokens + buckets.cache_read_tokens + buckets.cache_write_tokens.ttl_5m + buckets.cache_write_tokens.ttl_1h,
    output_tokens: buckets.output_tokens,
  };
  return priceUsage(pricing, model, flat).amount;
}

export function sumAmounts(amounts) {
  return fromFixed(amounts.reduce((a, s) => a + toFixed(s), 0n));
}

// Reconcile receipts against the provider invoice (the ground truth).
export function reconcile(receiptAmounts, invoiceAmount, tolerancePct = '0.5') {
  const sum = amountsTotal(receiptAmounts);
  const inv = toFixed(invoiceAmount);
  const variance = sum - inv;
  const abs = variance < 0n ? -variance : variance;
  const within = inv === 0n ? abs === 0n : abs * 100n * 10n ** SCALE <= toFixed(tolerancePct) * inv;
  return { receipts_total: fromFixed(sum), invoice_total: fromFixed(inv), variance: fromFixed(variance), status: within ? 'reconciled' : 'variance' };
}

function amountsTotal(a) { return a.reduce((acc, s) => acc + toFixed(s), 0n); }
