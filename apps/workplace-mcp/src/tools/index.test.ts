import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSharedTools, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';
import type { PatApiClient } from '../clients/workplace-api.js';
import { buildUserTools } from './index.js';

// 도구 목록 구성만 검사하므로 클라이언트 메서드는 호출되지 않는다.
const client = {} as PatApiClient;

describe('buildUserTools', () => {
  it('공유 도구 31종을 이름 중복 없이 반환한다', () => {
    const names = buildUserTools(client).map((t) => t.name);
    expect(names).toHaveLength(31);
    expect(new Set(names).size).toBe(names.length);
  });

  // #846: mcp 가 같은 이름의 도구를 따로 정의하면(드리프트의 원천) 스키마가 공유본과 달라진다.
  it('모든 도구의 이름·입력 스키마가 공유 정의와 일치한다', () => {
    const signature = (tools: { name: string; inputSchema: z.ZodType }[]) =>
      tools.map((t) => ({ name: t.name, schema: z.toJSONSchema(t.inputSchema) }));
    expect(signature(buildUserTools(client))).toEqual(signature(buildSharedTools({} as SharedToolClient)));
  });

  // 서버 레이어가 inputSchema.shape 를 registerTool 에 넘기므로 z.object 가 아니면 파라미터가 통째로 사라진다.
  it('모든 입력 스키마는 z.object 다', () => {
    for (const t of buildUserTools(client)) expect(t.inputSchema, t.name).toBeInstanceOf(z.ZodObject);
  });
});
