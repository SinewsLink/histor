// RFC 8785 JSON Canonicalization Scheme (JCS), restricted profile for Histor.
// Histor forbids non-integer numbers (money and rates are decimal strings), which
// removes the hardest part of JCS (ECMAScript float serialization) and makes
// every implementation byte-identical across languages.

export class CanonicalizationError extends Error {}

export function canonicalize(value) {
  return serialize(value, '$');
}

function serialize(v, path) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return JSON.stringify(v); // JSON.stringify string escaping matches RFC 8785
    case 'number':
      if (!Number.isFinite(v)) throw new CanonicalizationError(`${path}: non-finite number`);
      if (!Number.isInteger(v)) throw new CanonicalizationError(`${path}: non-integer numbers are forbidden in Histor; use a decimal string`);
      if (!Number.isSafeInteger(v)) throw new CanonicalizationError(`${path}: integer exceeds 2^53-1; use a decimal string`);
      return Object.is(v, -0) ? '0' : String(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map((x, i) => serialize(x, `${path}[${i}]`)).join(',') + ']';
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      // RFC 8785: sort by UTF-16 code units. JS default sort compares UTF-16 code units.
      keys.sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(v[k], `${path}.${k}`)).join(',') + '}';
    }
    default:
      throw new CanonicalizationError(`${path}: unsupported type ${typeof v}`);
  }
}

// Full RFC 8785, including non-integer numbers (ECMAScript Number serialization,
// which JSON.stringify implements). Used ONLY for interop with formats that allow
// floats (Agent Receipt Protocol). Histor's own receipts use the strict profile.
export function canonicalizeFull(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new CanonicalizationError('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalizeFull).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalizeFull(value[k])).join(',') + '}';
}
