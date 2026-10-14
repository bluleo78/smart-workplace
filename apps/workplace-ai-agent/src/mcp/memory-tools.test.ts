import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import {
  buildMemorySearchTool,
  buildMemoryTools,
  isEndpointMissing,
  MEMORY_SEARCH_OFF,
  MEMORY_SEARCH_UNAVAILABLE,
  parseMemoryToolResult,
  rememberMemoryInput,
  searchMemoryInput,
  updateMemoryInput,
} from './memory-tools.js';

const USER = 42;
const SID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';

function item(over: Record<string, unknown> = {}) {
  return { id: 12, kind: 'PREFERENCE', content: '짧은 목록으로 보여 준다', source: 'AI', createdAt: 't', updatedAt: 't', ...over };
}

// null = 세션 없는 실행(undefined 는 기본 인자가 SID 로 채우므로 구분해서 쓴다).
function setup(homeSessionId: string | null = SID) {
  const c = { createAiMemory: vi.fn(), updateAiMemory: vi.fn(), deleteAiMemory: vi.fn() };
  const tools = buildMemoryTools(c as unknown as WorkplaceApiClient, USER, homeSessionId ?? undefined);
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { c, tools, tool };
}

describe('buildMemoryTools (WP-55)', () => {
  // 실모델 확인: 이유를 지어내 붙였다 — 입력 설명도 "사용자가 말했을 때만" 으로 시스템 프롬프트 규칙과 맞춘다.
  it('content 입력 설명은 이유를 사용자가 직접 말했을 때만 붙이라고 한다', () => {
    expect(rememberMemoryInput.shape.content.description).toContain('이유는 사용자가 직접 말했을 때만');
    expect(updateMemoryInput.shape.content.description).toContain('지어내지 않는다');
  });

  // 스펙 3.8: 도구 설명도 프롬프트와 같은 범위 — 자기 취향·사실 포함, 묻지 않고 저장.
  it('WP-383: remember_memory 설명·kind 설명이 자기 취향·사실을 저장 대상으로 담고 묻지 말라고 한다', () => {
    const { tool } = setup();
    const d = tool('remember_memory').description;
    expect(d).toContain('자기 자신에 대해 밝힌 오래 갈 취향·관심사·습관·사실');
    expect(d).toContain('저장할지 묻지 말고 바로 저장');
    expect(d).toContain('건강·종교·정치·금융');
    expect(rememberMemoryInput.shape.kind.description).toContain('본인의 취향·관심사');
    expect(rememberMemoryInput.shape.kind.description).toContain('본인에 관한 사실·습관');
  });

  it('remember_memory → 대행 POST(source AI + 이 대화 세션) → saved 결과', async () => {
    const { c, tool } = setup();
    c.createAiMemory.mockResolvedValue(item());
    const out = await tool('remember_memory').handler({ kind: 'PREFERENCE', content: '짧은 목록으로 보여 준다' });
    expect(c.createAiMemory).toHaveBeenCalledWith(USER, {
      kind: 'PREFERENCE',
      content: '짧은 목록으로 보여 준다',
      source: 'AI',
      sessionId: SID,
    });
    expect(JSON.parse(out as string)).toEqual({
      action: 'saved',
      memoryId: 12,
      kind: 'PREFERENCE',
      content: '짧은 목록으로 보여 준다',
      source: 'AI',
    });
  });

  it('세션이 없는 실행이면 sessionId 를 싣지 않는다', async () => {
    const { c, tool } = setup(null);
    c.createAiMemory.mockResolvedValue(item());
    await tool('remember_memory').handler({ kind: 'CONTEXT', content: '백엔드 팀이다' });
    expect(c.createAiMemory.mock.calls[0][1]).toEqual({ kind: 'CONTEXT', content: '백엔드 팀이다', source: 'AI' });
  });

  it('update_memory → PATCH(kind 생략 시 안 보냄) → updated 결과(이전 내용 포함)', async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(item({ content: '표 대신 목록', previousContent: '짧은 목록으로 보여 준다' }));
    const out = await tool('update_memory').handler({ memoryId: 12, content: '표 대신 목록' });
    expect(c.updateAiMemory).toHaveBeenCalledWith(USER, 12, { content: '표 대신 목록' });
    expect(JSON.parse(out as string)).toEqual({
      action: 'updated',
      memoryId: 12,
      kind: 'PREFERENCE',
      content: '표 대신 목록',
      previousContent: '짧은 목록으로 보여 준다',
      source: 'AI',
    });
  });

  // CR1: API 가 이전 종류를 돌려주면 결과에 싣는다 — 되돌리기가 AI 가 바꾼 종류까지 돌려놓는 근거.
  it('update_memory → 이전 종류(previousKind)도 결과에 싣는다', async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(
      item({ kind: 'CONTEXT', content: '백엔드 팀이다', previousContent: '짧은 목록으로 보여 준다', previousKind: 'PREFERENCE' }),
    );
    const out = await tool('update_memory').handler({ memoryId: 12, content: '백엔드 팀이다', kind: 'CONTEXT' });
    expect(c.updateAiMemory).toHaveBeenCalledWith(USER, 12, { content: '백엔드 팀이다', kind: 'CONTEXT' });
    expect(JSON.parse(out as string)).toEqual({
      action: 'updated',
      memoryId: 12,
      kind: 'CONTEXT',
      content: '백엔드 팀이다',
      previousContent: '짧은 목록으로 보여 준다',
      previousKind: 'PREFERENCE',
      source: 'AI',
    });
    expect(parseMemoryToolResult(out as string)?.previousKind).toBe('PREFERENCE');
  });

  it('forget_memory → DELETE → forgotten 결과(지운 항목의 source 포함)', async () => {
    const { c, tool } = setup();
    c.deleteAiMemory.mockResolvedValue(item({ id: 9, kind: 'CONTEXT', content: '백엔드 팀이다', source: 'USER' }));
    const out = await tool('forget_memory').handler({ memoryId: 9 });
    expect(c.deleteAiMemory).toHaveBeenCalledWith(USER, 9);
    expect(JSON.parse(out as string)).toEqual({
      action: 'forgotten',
      memoryId: 9,
      kind: 'CONTEXT',
      content: '백엔드 팀이다',
      source: 'USER',
    });
  });

  it('API 오류(가득 참·꺼짐·길이·없는 id)는 도구 오류로 그대로 던진다 — AI 가 말로 안내', async () => {
    const { c, tool } = setup();
    c.createAiMemory.mockRejectedValue(new Error('API 오류 409: 메모리가 가득 찼어요 — code: AI_MEMORY_FULL'));
    await expect(tool('remember_memory').handler({ kind: 'PREFERENCE', content: 'x' })).rejects.toThrow('AI_MEMORY_FULL');
  });

  it('입력이 틀리면 API 를 부르지 않고 던진다', async () => {
    const { c, tool } = setup();
    await expect(tool('remember_memory').handler({ kind: 'OTHER', content: 'x' })).rejects.toThrow();
    await expect(tool('forget_memory').handler({ memoryId: 0 })).rejects.toThrow();
    await expect(tool('update_memory').handler({ memoryId: 12, content: '' })).rejects.toThrow();
    await expect(tool('update_memory').handler({ memoryId: 0, content: '표 대신 목록' })).rejects.toThrow();
    expect(c.createAiMemory).not.toHaveBeenCalled();
    expect(c.updateAiMemory).not.toHaveBeenCalled();
    expect(c.deleteAiMemory).not.toHaveBeenCalled();
  });
});

describe('메모리 도구 범위 (WP-379)', () => {
  it('remember_memory: scope 를 그대로 POST 하고 결과에 scope 를 싣는다', async () => {
    const { c, tool } = setup(null);
    c.createAiMemory.mockResolvedValue(item({ scope: 'ISSUE' }));
    const out = await tool('remember_memory').handler({ kind: 'PREFERENCE', content: '짧은 목록으로 보여 준다', scope: 'ISSUE' });
    expect(c.createAiMemory.mock.calls[0][1]).toEqual({
      kind: 'PREFERENCE',
      content: '짧은 목록으로 보여 준다',
      source: 'AI',
      scope: 'ISSUE',
    });
    expect(JSON.parse(out as string)).toMatchObject({ action: 'saved', scope: 'ISSUE' });
  });

  it('remember_memory: scope 생략이면 키를 보내지 않고 결과 scope 는 null(공통)', async () => {
    const { c, tool } = setup(null);
    c.createAiMemory.mockResolvedValue(item({ scope: null }));
    const out = await tool('remember_memory').handler({ kind: 'CONTEXT', content: '백엔드 팀이다' });
    expect(c.createAiMemory.mock.calls[0][1]).not.toHaveProperty('scope');
    expect(JSON.parse(out as string).scope).toBeNull();
  });

  it("update_memory: scope 'COMMON' 은 PATCH scope:null 로, 결과에 이전 범위(없으면 null)를 싣는다", async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(item({ scope: null, previousContent: '짧은 목록으로 보여 준다', previousScope: 'ISSUE' }));
    const out = await tool('update_memory').handler({ memoryId: 12, content: '짧은 목록으로 보여 준다', scope: 'COMMON' });
    expect(c.updateAiMemory).toHaveBeenCalledWith(USER, 12, { content: '짧은 목록으로 보여 준다', scope: null });
    expect(JSON.parse(out as string)).toMatchObject({ action: 'updated', scope: null, previousScope: 'ISSUE' });
  });

  it('update_memory: 범위를 바꾸지 않으면 scope 를 보내지 않고, 응답에 previousScope 가 없으면(공통) null 로 싣는다', async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(item({ scope: null, previousContent: 'a' }));
    const out = await tool('update_memory').handler({ memoryId: 12, content: '짧은 목록으로 보여 준다' });
    expect(c.updateAiMemory.mock.calls[0][2]).toEqual({ content: '짧은 목록으로 보여 준다' });
    expect(JSON.parse(out as string)).toMatchObject({ scope: null, previousScope: null });
  });

  it('구 API(응답에 scope 없음)면 결과에 scope·previousScope 를 싣지 않는다', async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(item({ previousContent: 'a' }));
    const out = JSON.parse((await tool('update_memory').handler({ memoryId: 12, content: 'b' })) as string);
    expect(out).not.toHaveProperty('scope');
    expect(out).not.toHaveProperty('previousScope');
  });

  it('forget_memory: 지운 항목의 scope 를 싣는다(되돌리기 재생성용)', async () => {
    const { c, tool } = setup();
    c.deleteAiMemory.mockResolvedValue(item({ scope: 'MAIL' }));
    expect(JSON.parse((await tool('forget_memory').handler({ memoryId: 12 })) as string)).toMatchObject({
      action: 'forgotten',
      scope: 'MAIL',
    });
  });

  it('입력 scope 가 모르는 값이면 API 를 부르지 않고 던진다', async () => {
    const { c, tool } = setup();
    await expect(tool('remember_memory').handler({ kind: 'PREFERENCE', content: 'a', scope: 'CONTACTS' })).rejects.toThrow();
    await expect(tool('remember_memory').handler({ kind: 'PREFERENCE', content: 'a', scope: 'COMMON' })).rejects.toThrow();
    expect(c.createAiMemory).not.toHaveBeenCalled();
  });
});

describe('parseMemoryToolResult (WP-55)', () => {
  it('도구 결과 JSON 을 이벤트로 — 모르는 필드는 버린다', () => {
    expect(
      parseMemoryToolResult(JSON.stringify({ action: 'saved', memoryId: 1, kind: 'CONTEXT', content: 'c', source: 'AI', extra: 1 })),
    ).toEqual({ action: 'saved', memoryId: 1, kind: 'CONTEXT', content: 'c', source: 'AI' });
  });

  it('비었거나 깨졌거나 모양이 다르면 null', () => {
    expect(parseMemoryToolResult(undefined)).toBeNull();
    expect(parseMemoryToolResult('')).toBeNull();
    expect(parseMemoryToolResult('{깨짐')).toBeNull();
    expect(parseMemoryToolResult('API 오류 409: …')).toBeNull();
    expect(parseMemoryToolResult(JSON.stringify({ action: 'moved', memoryId: 1, kind: 'CONTEXT', content: 'c' }))).toBeNull();
    expect(parseMemoryToolResult(JSON.stringify({ action: 'saved', memoryId: 1, kind: 'CONTEXT', content: '' }))).toBeNull();
  });
});

describe('메모리 도구 기한 (WP-380)', () => {
  it('remember_memory: expiresOn 을 POST 하고 결과에 기한을 싣는다', async () => {
    const { c, tool } = setup(null);
    c.createAiMemory.mockResolvedValue(item({ scope: null, expiresOn: '2026-10-19', expired: false }));
    const out = await tool('remember_memory').handler({ kind: 'CONTEXT', content: '결제 모듈 집중', expiresOn: '2026-10-19' });
    expect(c.createAiMemory.mock.calls[0][1]).toEqual({ kind: 'CONTEXT', content: '결제 모듈 집중', source: 'AI', expiresOn: '2026-10-19' });
    expect(JSON.parse(out as string)).toMatchObject({ action: 'saved', expiresOn: '2026-10-19' });
  });

  it('update_memory: clearExpiry 는 PATCH clearExpiry:true, 결과에 이전 기한(없으면 null)', async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(item({ scope: null, expiresOn: null, previousContent: 'a', previousExpiresOn: '2026-10-19' }));
    const out = await tool('update_memory').handler({ memoryId: 12, content: 'a', clearExpiry: true });
    expect(c.updateAiMemory).toHaveBeenCalledWith(USER, 12, { content: 'a', clearExpiry: true });
    expect(JSON.parse(out as string)).toMatchObject({ expiresOn: null, previousExpiresOn: '2026-10-19' });
  });

  // API 는 expiresOn 과 clearExpiry 를 함께 받으면 400 이다 — 도구 스키마는 둘 다 받아도 핸들러가 clearExpiry 를 우선해 expiresOn 을 보내지 않는다.
  it('update_memory: expiresOn 과 clearExpiry 가 함께 오면 clearExpiry 만 보낸다', async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(item({ scope: null, expiresOn: null, previousContent: 'a' }));
    await tool('update_memory').handler({ memoryId: 12, content: 'a', expiresOn: '2026-10-19', clearExpiry: true });
    expect(c.updateAiMemory.mock.calls[0][2]).toEqual({ content: 'a', clearExpiry: true });
  });

  it('update_memory: expiresOn 만 오면 그대로 보낸다', async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(item({ scope: null, expiresOn: '2026-10-19', previousContent: 'a' }));
    await tool('update_memory').handler({ memoryId: 12, content: 'a', expiresOn: '2026-10-19' });
    expect(c.updateAiMemory.mock.calls[0][2]).toEqual({ content: 'a', expiresOn: '2026-10-19' });
  });

  it('update_memory: 기한을 안 바꾸면 기한 키를 보내지 않고, 이전 기한이 없으면 null', async () => {
    const { c, tool } = setup();
    c.updateAiMemory.mockResolvedValue(item({ scope: null, expiresOn: null, previousContent: 'a' }));
    const out = await tool('update_memory').handler({ memoryId: 12, content: 'b' });
    expect(c.updateAiMemory.mock.calls[0][2]).toEqual({ content: 'b' });
    expect(JSON.parse(out as string)).toMatchObject({ expiresOn: null, previousExpiresOn: null });
  });

  it('형식이 틀린 기한은 API 를 부르지 않고 던진다', async () => {
    const { c, tool } = setup();
    await expect(tool('remember_memory').handler({ kind: 'PREFERENCE', content: 'a', expiresOn: '10/19' })).rejects.toThrow();
    expect(c.createAiMemory).not.toHaveBeenCalled();
  });
});

describe('search_memory (WP-383)', () => {
  function searchSetup() {
    const c = { searchAiMemories: vi.fn() };
    const tool = buildMemorySearchTool(c as unknown as WorkplaceApiClient, USER);
    return { c, tool };
  }

  /** 구 API 가 돌려주는 404·405 를 흉내 낸다(axios 응답 오류). */
  function httpError(status: number) {
    return new AxiosError(`API 오류 ${status}`, 'ERR_BAD_REQUEST', undefined, undefined, { status } as AxiosResponse);
  }

  it('읽기 전용 힌트와 이름·입력(query 필수, scope ALL·COMMON·앱, limit 1~20)', () => {
    const { tool } = searchSetup();
    expect(tool.name).toBe('search_memory');
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    expect(searchMemoryInput.safeParse({ query: '  ' }).success).toBe(false);
    expect(searchMemoryInput.safeParse({ query: '메일 서명', scope: 'COMMON', limit: 20 }).success).toBe(true);
    expect(searchMemoryInput.safeParse({ query: 'x', scope: 'CONTACTS' }).success).toBe(false);
    expect(searchMemoryInput.safeParse({ query: 'x', limit: 21 }).success).toBe(false);
  });

  it('요청자 대행으로 부르고 블록과 같은 줄 형식(#id·범위·고정)으로 돌려준다', async () => {
    const { c, tool } = searchSetup();
    c.searchAiMemories.mockResolvedValue({
      memoryEnabled: true,
      items: [
        { id: 3, kind: 'PREFERENCE', content: '이슈 목록은 짧게', scope: 'ISSUE', pinned: true },
        { id: 8, kind: 'CONTEXT', content: '결제 모듈 담당' },
        { id: 0, kind: 'BAD', content: 'x' },
      ],
    });
    const out = await tool.handler({ query: '이슈 목록', scope: 'ISSUE', limit: 5 });
    expect(c.searchAiMemories).toHaveBeenCalledWith(USER, { q: '이슈 목록', scope: 'ISSUE', limit: 5 });
    expect(out).toBe(
      ['"이슈 목록" 관련 메모리 2개 — # 뒤 숫자가 memoryId 다:', '- [#3 선호·이슈·고정] 이슈 목록은 짧게', '- [#8 맥락] 결제 모듈 담당'].join('\n'),
    );
  });

  it('생략한 scope·limit 은 보내지 않는다(API 기본 ALL·10)', async () => {
    const { c, tool } = searchSetup();
    c.searchAiMemories.mockResolvedValue({ memoryEnabled: true, items: [] });
    expect(await tool.handler({ query: '고양이' })).toBe('"고양이" 관련 메모리를 찾지 못했다.');
    expect(c.searchAiMemories).toHaveBeenCalledWith(USER, { q: '고양이' });
  });

  it('메모리가 꺼져 있으면 꺼짐 안내', async () => {
    const { c, tool } = searchSetup();
    c.searchAiMemories.mockResolvedValue({ memoryEnabled: false, items: [] });
    expect(await tool.handler({ query: '고양이' })).toBe(MEMORY_SEARCH_OFF);
  });

  // Review Focus 4: 구 API 는 GET …/search 를 /{id} 경로의 405(또는 404)로 돌려준다 — 채팅을 끊지 않고 결과로 알린다.
  it('404·405 면 "지금은 쓸 수 없음" 결과, 그 밖의 오류는 던진다', async () => {
    const { c, tool } = searchSetup();
    c.searchAiMemories.mockRejectedValueOnce(httpError(405));
    expect(await tool.handler({ query: '고양이' })).toBe(MEMORY_SEARCH_UNAVAILABLE);
    c.searchAiMemories.mockRejectedValueOnce(httpError(404));
    expect(await tool.handler({ query: '고양이' })).toBe(MEMORY_SEARCH_UNAVAILABLE);
    c.searchAiMemories.mockRejectedValueOnce(httpError(500));
    await expect(tool.handler({ query: '고양이' })).rejects.toThrow('API 오류 500');
    expect(isEndpointMissing(new Error('x'))).toBe(false);
  });
});
