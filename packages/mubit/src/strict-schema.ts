import { z } from 'zod';

/**
 * Converts a zod schema into the subset of JSON Schema that OpenAI strict structured output accepts:
 * every object closed (`additionalProperties: false`) with every key required, optional keys made
 * nullable, and the validation keywords strict mode rejects stripped. `enum` is kept. Bounds that
 * get stripped here are still enforced when the client parses the answer with the zod schema.
 */

type Json = Record<string, unknown>;

const STRIPPED = new Set([
  '$schema',
  '$id',
  'id',
  'default',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'propertyNames',
  'examples',
]);

const PRIMITIVES = new Set(['string', 'number', 'integer', 'boolean']);

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNullable(node: Json): boolean {
  if (node.type === 'null') return true;
  if (Array.isArray(node.type) && node.type.includes('null')) return true;
  return Array.isArray(node.anyOf) && node.anyOf.some((b) => isObject(b) && b.type === 'null');
}

function makeNullable(node: Json): Json {
  if (isNullable(node)) return node;
  // Primitives take a type array; objects, arrays and enums go in anyOf, which strict mode always accepts.
  if (PRIMITIVES.has(node.type as string) && node.enum === undefined && node.anyOf === undefined) {
    return { ...node, type: [node.type, 'null'] };
  }
  return { anyOf: [node, { type: 'null' }] };
}

function strictify(node: unknown, path: string): unknown {
  if (Array.isArray(node)) return node.map((n, i) => strictify(n, `${path}[${i}]`));
  if (!isObject(node)) return node;

  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED.has(key)) continue;
    if (key === 'const') {
      out.enum = [value];
      continue;
    }
    out[key] = value;
  }

  if (out.type === 'object' || out.properties !== undefined) {
    if (isObject(out.additionalProperties) || out.additionalProperties === true) {
      throw new Error(`strict-schema: ${path || 'root'} is a record or open object, which strict JSON schema cannot express`);
    }
    const props = isObject(out.properties) ? out.properties : {};
    const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
    const next: Json = {};
    for (const [key, value] of Object.entries(props)) {
      const child = strictify(value, `${path}.${key}`) as Json;
      next[key] = required.has(key) ? child : makeNullable(child);
    }
    out.type = 'object';
    out.properties = next;
    out.required = Object.keys(next);
    out.additionalProperties = false;
    return out;
  }

  if (Array.isArray(out.allOf)) {
    // zod puts stacked string checks (regex + email) in allOf; once stripped, those branches are empty.
    const kept = (out.allOf as unknown[]).filter((b) => isObject(b) && Object.keys(b).some((k) => !STRIPPED.has(k)));
    if (kept.length === 0) delete out.allOf;
    else out.allOf = kept;
  }

  for (const key of ['items', 'anyOf', 'oneOf', 'allOf', 'prefixItems', '$defs', 'definitions'] as const) {
    if (out[key] === undefined) continue;
    if (key === '$defs' || key === 'definitions') {
      const defs = out[key] as Json;
      out[key] = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, strictify(v, `${path}#${k}`)]));
    } else {
      out[key] = strictify(out[key], `${path}.${key}`);
    }
  }
  if (out.oneOf !== undefined) {
    // Strict mode documents anyOf, not oneOf; for our schemas the branches never overlap.
    out.anyOf = out.oneOf;
    delete out.oneOf;
  }
  if (out.type === undefined && out.anyOf === undefined && out.enum === undefined && out.$ref === undefined) {
    throw new Error(`strict-schema: ${path || 'root'} has no type (unknown/any), which strict JSON schema cannot express`);
  }
  return out;
}

export function toStrictJsonSchema(schema: z.ZodType): Json {
  // `io: 'input'` because the model writes what we then parse: optional and defaulted keys are inputs.
  const raw = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' });
  const strict = strictify(raw, '') as Json;
  if (strict.type !== 'object') throw new Error('strict-schema: the root of a structured output must be an object');
  return strict;
}
