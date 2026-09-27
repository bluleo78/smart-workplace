import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSharedTools, type SharedTool, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';
import type { PatApiClient } from '../clients/workplace-api.js';
import { buildUserTools, exposableTools } from './index.js';

// 도구 목록 구성만 검사하므로 클라이언트 메서드는 호출되지 않는다.
const client = {} as PatApiClient;

describe('buildUserTools', () => {
  // 개수는 적지 않는다 — 도구 이름 전체는 공유 패키지 스냅샷이 고정하고, 아래 패리티가 공유본과 같음을 본다.
  it('공유 도구를 이름 중복 없이 반환한다', () => {
    const names = buildUserTools(client).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // #846: mcp 가 같은 이름의 도구를 따로 정의하면(드리프트의 원천) 스키마가 공유본과 달라진다.
  it('모든 도구의 이름·입력 스키마가 공유 정의와 일치한다', () => {
    const signature = (tools: { name: string; inputSchema: z.ZodType }[]) =>
      tools.map((t) => ({ name: t.name, schema: z.toJSONSchema(t.inputSchema) }));
    expect(signature(buildUserTools(client))).toEqual(signature(exposableTools(buildSharedTools({} as SharedToolClient))));
  });

  // #853: PAT 는 스코프 없이 사용자 권한을 그대로 갖는다 — 되돌릴 수 없는 도구는 확인 카드 없이 열리면 안 된다.
  it('destructive 도구는 노출하지 않는다', () => {
    const fake = (name: string, kind: SharedTool['kind']): SharedTool => ({
      name,
      kind,
      description: name,
      inputSchema: z.object({}),
      handler: async () => '',
    });
    const exposed = exposableTools([fake('r', 'read'), fake('w', 'write'), fake('d', 'destructive')]);
    expect(exposed.map((t) => t.name)).toEqual(['r', 'w']);
    expect(buildUserTools(client).filter((t) => t.kind === 'destructive')).toEqual([]);
  });

  // 노출 도구 이름·등급을 고정 — 공유 패키지에 새 도구가 들어오면 PAT 표면이 바뀐다는 사실이 이 스냅샷 diff 로 드러난다.
  it('노출 도구 이름·kind 스냅샷', () => {
    const exposed = buildUserTools(client)
      .map((t) => `${t.name}:${t.kind}`)
      .sort();
    expect(exposed).toMatchSnapshot();
  });

  // 서버 레이어가 inputSchema.shape 를 registerTool 에 넘기므로 z.object 가 아니면 파라미터가 통째로 사라진다.
  it('모든 입력 스키마는 z.object 다', () => {
    for (const t of buildUserTools(client)) expect(t.inputSchema, t.name).toBeInstanceOf(z.ZodObject);
  });
});
