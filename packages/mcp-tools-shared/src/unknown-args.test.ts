// src/unknown-args.test.ts — 모르는 인자 이름 판정과 SDK 에 넘길 스키마(WP-1568).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildSharedTools, type SharedToolClient } from './shared-tools.js';
import { inputSchemaKeepingUnknownArgs, unknownArgsMessage } from './unknown-args.js';

// 도구 구성 시점에는 클라이언트 메서드를 부르지 않으므로 빈 객체로 충분하다.
const tools = buildSharedTools({} as unknown as SharedToolClient);
const createIssue = tools.find((t) => t.name === 'create_issue')!;

/** SDK(MCP tools/list)와 같은 변환 옵션으로 JSON Schema 를 만들고, 전송처럼 JSON 으로 직렬화해 undefined 키를 떨군다. */
const wire = (s: z.ZodType) => JSON.parse(JSON.stringify(z.toJSONSchema(s, { target: 'draft-07', io: 'input' })));

describe('unknownArgsMessage', () => {
  it('모르는 이름을 모두 짚고 쓸 수 있는 인자 이름을 스키마 순서대로 알려 준다', () => {
    const msg = unknownArgsMessage(createIssue.inputSchema, { projectKey: 'WP', title: 't', description: 'd', parentKey: 'WP-1' });
    const known = Object.keys((createIssue.inputSchema as z.ZodObject<z.ZodRawShape>).shape);
    expect(known.slice(0, 2)).toEqual(['projectKey', 'title']);
    expect(msg).toBe(`알 수 없는 인자: description, parentKey — 쓸 수 있는 인자: ${known.join(', ')}`);
  });

  it('아는 인자의 null 값은 막지 않는다(WP-346)', () => {
    expect(unknownArgsMessage(z.object({ a: z.string(), b: z.number().nullish() }), { a: 'x', b: null })).toBeNull();
  });

  it('모르는 키가 없으면(빈 인자 포함) null', () => {
    expect(unknownArgsMessage(createIssue.inputSchema, { projectKey: 'WP', title: 't' })).toBeNull();
    expect(unknownArgsMessage(z.object({}), {})).toBeNull();
  });

  it('인자가 없는 도구에 인자를 보내면 쓸 수 있는 인자를 「없음」으로 알린다', () => {
    expect(unknownArgsMessage(z.object({}), { x: 1 })).toBe('알 수 없는 인자: x — 쓸 수 있는 인자: 없음');
  });

  it('인자가 객체가 아니거나 스키마가 객체가 아니면 판정하지 않는다', () => {
    expect(unknownArgsMessage(z.object({ a: z.string() }), undefined)).toBeNull();
    expect(unknownArgsMessage(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]), { c: 1 })).toBeNull();
  });
});

describe('inputSchemaKeepingUnknownArgs', () => {
  it('검증을 거친 값에 모르는 키가 남는다(기본 z.object 는 지운다)', () => {
    const s = z.object({ a: z.string(), b: z.number().nullish() });
    expect(s.parse({ a: 'x', zz: 1 })).toEqual({ a: 'x' });
    expect(inputSchemaKeepingUnknownArgs(s).parse({ a: 'x', b: null, zz: 1 })).toEqual({ a: 'x', b: null, zz: 1 });
  });

  it('아는 인자의 값 검증은 그대로다', () => {
    expect(inputSchemaKeepingUnknownArgs(z.object({ a: z.string() })).safeParse({ a: 1 }).success).toBe(false);
  });

  it('모델에 보이는 JSON Schema 는 원래 스키마와 같다 — 공유 도구 전부(additionalProperties 를 더하지 않는다)', () => {
    for (const t of tools) expect(wire(inputSchemaKeepingUnknownArgs(t.inputSchema)), t.name).toEqual(wire(t.inputSchema));
  });

  it('객체 자체의 메타(description)는 유지한다', () => {
    const s = z.object({ a: z.string() }).describe('설명');
    expect(wire(inputSchemaKeepingUnknownArgs(s))).toEqual(wire(s));
    expect(wire(inputSchemaKeepingUnknownArgs(s)).description).toBe('설명');
  });

  it('이미 모르는 키 정책을 정한 객체(.strict())와 객체가 아닌 스키마는 그대로 돌려준다', () => {
    const strict = z.object({ a: z.string() }).strict();
    expect(inputSchemaKeepingUnknownArgs(strict)).toBe(strict);
    const union = z.union([z.string(), z.number()]);
    expect(inputSchemaKeepingUnknownArgs(union)).toBe(union);
  });
});
