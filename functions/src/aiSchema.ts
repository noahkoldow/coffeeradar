import { HttpsError } from 'firebase-functions/v2/https';

type Schema = { type: string | string[]; properties?: Record<string, Schema>; items?: Schema;
  required?: string[]; enum?: unknown[]; additionalProperties?: boolean; description?: string;
  minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
const types = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const keys = new Set(['type', 'properties', 'items', 'required', 'enum', 'additionalProperties', 'description',
  'nullable', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum']);
const invalid = () => new HttpsError('invalid-argument', 'Unsupported response schema. Use simple types, properties, items, required, enum and bounds.');

/** Bounded schema subset used by this app. Reject refs/regex/combinators rather than executing untrusted schemas. */
export function normalizeAiSchema(raw: unknown): Schema | undefined {
  if (raw == null) return undefined;
  let encoded: string;
  try { encoded = JSON.stringify(raw); } catch { throw invalid(); }
  if (encoded.length > 16000) throw invalid();
  let nodes = 0;
  function visit(value: any, depth: number): Schema {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 12 || ++nodes > 200
      || Object.keys(value).some(key => !keys.has(key))) throw invalid();
    const nodeTypes = Array.isArray(value.type) ? value.type : [value.type];
    if (!nodeTypes.length || nodeTypes.some((type: unknown) => typeof type !== 'string' || !types.includes(type))) throw invalid();
    if (value.nullable !== undefined && typeof value.nullable !== 'boolean') throw invalid();
    const result: Schema = { type: value.nullable ? [...new Set([...nodeTypes, 'null'])] : value.type };
    if (value.properties !== undefined) {
      if (!value.properties || typeof value.properties !== 'object' || Array.isArray(value.properties)) throw invalid();
      result.properties = Object.fromEntries(Object.entries(value.properties).map(([key, child]) => [key, visit(child, depth + 1)]));
    }
    if (value.items !== undefined) result.items = visit(value.items, depth + 1);
    if (value.required !== undefined) {
      if (!Array.isArray(value.required) || value.required.some((key: unknown) => typeof key !== 'string'
        || !Object.prototype.hasOwnProperty.call(value.properties || {}, key))) throw invalid();
      result.required = value.required;
    }
    if (value.enum !== undefined) {
      if (!Array.isArray(value.enum) || !value.enum.length || value.enum.length > 100
        || value.enum.some((item: unknown) => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) throw invalid();
      result.enum = value.enum;
    }
    if (value.additionalProperties !== undefined) {
      if (typeof value.additionalProperties !== 'boolean') throw invalid();
      result.additionalProperties = value.additionalProperties;
    }
    if (value.description !== undefined) {
      if (typeof value.description !== 'string') throw invalid();
      result.description = value.description;
    }
    for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum'] as const) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== 'number' || !Number.isFinite(value[key])
          || (!['minimum', 'maximum'].includes(key) && (!Number.isInteger(value[key]) || value[key] < 0))) throw invalid();
        result[key] = value[key];
      }
    }
    for (const [min, max] of [['minItems', 'maxItems'], ['minLength', 'maxLength'], ['minimum', 'maximum']] as const) {
      if (result[min] !== undefined && result[max] !== undefined && result[min]! > result[max]!) throw invalid();
    }
    return result;
  }
  return visit(raw, 0);
}

export function matchesAiSchema(value: unknown, schema: Schema): boolean {
  const accepted = Array.isArray(schema.type) ? schema.type : [schema.type];
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!accepted.includes(kind) && !(kind === 'number' && Number.isInteger(value) && accepted.includes('integer'))) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (typeof value === 'number' && (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum)
    || (schema.maximum !== undefined && value > schema.maximum))) return false;
  if (typeof value === 'string') {
    const length = [...value].length;
    if ((schema.minLength !== undefined && length < schema.minLength) || (schema.maxLength !== undefined && length > schema.maxLength)) return false;
  }
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) return false;
    if (schema.items && !value.every(item => matchesAiSchema(item, schema.items!))) return false;
  } else if (value !== null && typeof value === 'object') {
    if (schema.required?.some(key => !Object.prototype.hasOwnProperty.call(value, key))) return false;
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        if (!matchesAiSchema(item, schema.properties[key])) return false;
      } else if (schema.additionalProperties === false) return false;
    }
  }
  return true;
}
