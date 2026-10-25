import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020.js');
const addFormats = require('ajv-formats');
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function validators() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const s = (f) => JSON.parse(fs.readFileSync(path.join(root, 'spec/schema', f), 'utf8'));
  const receiptSchema = s('histor-receipt.v0.1.schema.json');
  ajv.addSchema(receiptSchema);
  return {
    receipt: ajv.getSchema(receiptSchema.$id),
    batch: ajv.compile(s('histor-batch.v0.1.schema.json')),
    keyring: ajv.compile(s('histor-keyring.v0.1.schema.json')),
    decision: ajv.compile(s('histor-approval-decision.v0.1.schema.json')),
    pricing: ajv.compile(s('histor-pricing.v0.1.schema.json')),
  };
}
