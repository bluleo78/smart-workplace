import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import {
  buildConversationSearchTool,
  CONVERSATION_SEARCH_OFF,
  CONVERSATION_SEARCH_UNAVAILABLE,
  searchConversationsInput,
} from './conversation-search-tool.js';

const USER = 42;
const SID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

// 기본 인자는 undefined 를 SID 로 바꾸므로 "세션 없음"은 null 로 표현한다(브리프 코드 보정).
function setup(homeSessionId: string | null = SID) {
  const c = { searchConversations: vi.fn() };
  const tool = buildConversationSearchTool(c as unknown as WorkplaceApiClient, USER, homeSessionId ?? undefined);
  return { c, tool };
}

function hit(over: Record<string, unknown> = {}) {
  return {
    sessionId: OTHER,
    title: '고양이 사진 정리',
    lastMessageAt: '2026-10-10T03:00:00Z',
    question: '고양이 사진 어디 둘까',
    answerExcerpt: '사진/고양이 폴더에 모으세요',
    link: `/?chat=${OTHER}`,
    ...over,
  };
}

describe('search_conversations (WP-384)', () => {
  it('읽기 전용 힌트, 입력은 query(필수)·limit(1~10) — 지금 대화 id 는 입력에 없다', () => {
    const { tool } = setup();
    expect(tool.name).toBe('search_conversations');
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    expect(Object.keys(searchConversationsInput.shape).sort()).toEqual(['limit', 'query']);
    expect(searchConversationsInput.safeParse({ query: ' ' }).success).toBe(false);
    expect(searchConversationsInput.safeParse({ query: 'x', limit: 11 }).success).toBe(false);
  });

  it('지금 대화 id 를 도구가 묶어 excludeSessionId 로 보낸다(모델이 지정하지 못한다)', async () => {
    const { c, tool } = setup();
    c.searchConversations.mockResolvedValue({ memoryEnabled: true, items: [] });
    await tool.handler({ query: '고양이', limit: 3, excludeSessionId: OTHER });
    expect(c.searchConversations).toHaveBeenCalledWith(USER, { q: '고양이', excludeSessionId: SID, limit: 3 });
  });

  it('세션 없는 실행이면 excludeSessionId 를 보내지 않는다', async () => {
    const { c, tool } = setup(null);
    c.searchConversations.mockResolvedValue({ memoryEnabled: true, items: [] });
    await tool.handler({ query: '고양이' });
    expect(c.searchConversations).toHaveBeenCalledWith(USER, { q: '고양이' });
  });

  it('결과는 [제목](링크) · 날짜, 질문, 답 발췌 — 제목 없으면 "제목 없는 대화", 대괄호는 지운다', async () => {
    const { c, tool } = setup();
    c.searchConversations.mockResolvedValue({
      memoryEnabled: true,
      items: [hit(), hit({ title: null, question: null, link: '/?chat=abc', sessionId: 'abc' }), hit({ title: '[중요] 회의\n정리' })],
    });
    expect(await tool.handler({ query: '고양이' })).toBe(
      [
        '"고양이" 관련 지난 대화 3개 — 답에 쓴 대화는 결과의 [제목](링크) 를 그대로 붙여 출처를 밝힌다:',
        `1. [고양이 사진 정리](/?chat=${OTHER}) · 2026-10-10`,
        '   질문: 고양이 사진 어디 둘까',
        '   답: 사진/고양이 폴더에 모으세요',
        '2. [제목 없는 대화](/?chat=abc) · 2026-10-10',
        '   답: 사진/고양이 폴더에 모으세요',
        `3. [중요 회의 정리](/?chat=${OTHER}) · 2026-10-10`,
        '   질문: 고양이 사진 어디 둘까',
        '   답: 사진/고양이 폴더에 모으세요',
      ].join('\n'),
    );
  });

  it('링크가 딥링크 모양이 아니면 sessionId 로 다시 만든다', async () => {
    const { c, tool } = setup();
    c.searchConversations.mockResolvedValue({ memoryEnabled: true, items: [hit({ link: 'https://evil.example/x' })] });
    expect(await tool.handler({ query: '고양이' })).toContain(`[고양이 사진 정리](/?chat=${OTHER})`);
  });

  it('없으면 찾지 못함, 꺼짐이면 꺼짐 안내', async () => {
    const { c, tool } = setup();
    c.searchConversations.mockResolvedValueOnce({ memoryEnabled: true, items: [] });
    expect(await tool.handler({ query: '고양이' })).toBe('"고양이" 관련 지난 대화를 찾지 못했다.');
    c.searchConversations.mockResolvedValueOnce({ memoryEnabled: false, items: [] });
    expect(await tool.handler({ query: '고양이' })).toBe(CONVERSATION_SEARCH_OFF);
  });

  // Review Focus 4: 구 API 는 GET /home/sessions/search 를 DELETE /{id} 경로의 405 로 돌려준다.
  it('404·405 면 "지금은 쓸 수 없음" 결과, 그 밖의 오류는 던진다', async () => {
    const { c, tool } = setup();
    const err = (status: number) =>
      new AxiosError(`API 오류 ${status}`, 'ERR_BAD_REQUEST', undefined, undefined, { status } as AxiosResponse);
    c.searchConversations.mockRejectedValueOnce(err(405));
    expect(await tool.handler({ query: '고양이' })).toBe(CONVERSATION_SEARCH_UNAVAILABLE);
    c.searchConversations.mockRejectedValueOnce(err(404));
    expect(await tool.handler({ query: '고양이' })).toBe(CONVERSATION_SEARCH_UNAVAILABLE);
    c.searchConversations.mockRejectedValueOnce(err(500));
    await expect(tool.handler({ query: '고양이' })).rejects.toThrow('API 오류 500');
  });
});
