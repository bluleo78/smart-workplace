import { describe, expect, it, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildMemoryTools, parseMemoryToolResult, rememberMemoryInput, updateMemoryInput } from './memory-tools.js';

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
