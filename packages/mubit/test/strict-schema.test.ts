import { TASK_IDS, TASK_OUTPUT } from '@cue/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toStrictJsonSchema } from '../src/strict-schema';

type Node = Record<string, unknown>;

/** Calls `visit` on every subschema (a `properties` map is not itself a schema). */
function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== 'object' || node === null) return;
  visit(node as Node);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties') Object.values(v as Node).forEach((p) => walk(p, visit));
    else if (k !== 'enum' && k !== 'required') walk(v, visit);
  }
}

const FORBIDDEN = ['$schema', 'default', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'format', 'const', 'propertyNames'];

describe('toStrictJsonSchema', () => {
  it.each(TASK_IDS)('%s output is OpenAI-strict', (task) => {
    const schema = toStrictJsonSchema(TASK_OUTPUT[task]);
    expect(schema.type).toBe('object');
    walk(schema, (n) => {
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false);
        expect(new Set(n.required as string[])).toEqual(new Set(Object.keys(n.properties as Node)));
      }
      for (const key of FORBIDDEN) expect(key in n, `${task}: found ${key}`).toBe(false);
    });
  });

  it('keeps enums and nullables of the read_moment and write_line schemas', () => {
    const rm = toStrictJsonSchema(TASK_OUTPUT.read_moment) as { properties: Record<string, Node> };
    expect(rm.properties.moment!.enum).toContain('whats_this_regarding');
    expect((rm.properties.signals!.items as Node).enum).toContain('asked_price');
    const wl = toStrictJsonSchema(TASK_OUTPUT.write_line) as { properties: Record<string, Node> };
    expect(wl.properties.risky_claim!.type).toEqual(['string', 'null']);
  });

  it('makes optional keys required and nullable, strips bounds and defaults, turns const into enum', () => {
    const s = toStrictJsonSchema(
      z.object({
        a: z.string().min(2).max(9).optional(),
        b: z.number().int().min(0).default(3),
        c: z.object({ d: z.enum(['x', 'y']).optional() }).optional(),
        e: z.literal('k'),
        f: z.string().regex(/^a/).email(),
      }),
    ) as { properties: Record<string, Node>; required: string[]; additionalProperties: boolean };
    expect(s.required).toEqual(['a', 'b', 'c', 'e', 'f']);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.a).toEqual({ type: ['string', 'null'] });
    expect(s.properties.b).toEqual({ type: ['integer', 'null'] });
    const c = s.properties.c!.anyOf as Node[];
    expect(c[1]).toEqual({ type: 'null' });
    expect(c[0]!.additionalProperties).toBe(false);
    expect(c[0]!.required).toEqual(['d']);
    expect((c[0]!.properties as Record<string, Node>).d).toEqual({ anyOf: [{ type: 'string', enum: ['x', 'y'] }, { type: 'null' }] });
    expect(s.properties.e).toEqual({ type: 'string', enum: ['k'] });
    expect(s.properties.f).toEqual({ type: 'string' });
    expect(JSON.stringify(s)).not.toContain('$schema');
  });

  it('refuses records and unknowns, which strict mode cannot express', () => {
    expect(() => toStrictJsonSchema(z.object({ r: z.record(z.string(), z.string()) }))).toThrow(/record/);
    expect(() => toStrictJsonSchema(z.object({ u: z.unknown() }))).toThrow(/no type/);
  });
});
