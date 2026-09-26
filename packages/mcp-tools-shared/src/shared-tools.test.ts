import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';

// 도구 구성 시점에는 클라이언트 메서드를 부르지 않으므로 빈 객체로 충분하다.
const tools = buildSharedTools({} as unknown as SharedToolClient);

describe('buildSharedTools', () => {
  // 개수는 적지 않는다 — 이름 전체는 아래 스냅샷이 고정한다.
  it('이름이 중복되지 않는다', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('모든 inputSchema 는 z.ZodObject 인스턴스다(MCP 입력 스키마는 객체여야 한다)', () => {
    for (const t of tools) expect(t.inputSchema, t.name).toBeInstanceOf(z.ZodObject);
  });

  it('모든 도구에 설명이 있다', () => {
    for (const t of tools) expect(t.description.length, t.name).toBeGreaterThan(0);
  });

  // 파라미터 이름·기본값·제약 변경이 스냅샷 diff 로 리뷰에 드러나도록 고정한다.
  it('도구별 입력 JSON 스키마 스냅샷', () => {
    const schemas = tools
      .map((t) => ({ name: t.name, schema: z.toJSONSchema(t.inputSchema) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(schemas).toMatchSnapshot();
  });
});
