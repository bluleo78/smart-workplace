import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runTextEventsSpy } = vi.hoisted(() => ({ runTextEventsSpy: vi.fn() }));
vi.mock('./run-messaging-ai.js', () => ({ runTextEvents: runTextEventsSpy }));

import {
  buildContextSummaryMessage,
  runHomeContextSummary,
  homeContextSummaryInput,
} from './run-home-context-summary.js';

const base = { assistantAgentId: 7, model: 'm', maxTurns: 3, timeoutMs: 60_000 };

beforeEach(() => vi.clearAllMocks());

describe('buildContextSummaryMessage', () => {
  it('기존 요약과 새 구간을 채팅과 같은 라벨로 싣는다', () => {
    const msg = buildContextSummaryMessage({
      ...base,
      previousSummary: '이전 요약',
      messages: [
        { role: 'USER', content: 'WP-100 마감 10/31 로' },
        { role: 'ASSISTANT', content: '변경했습니다.' },
        { role: 'ACTION_DONE', content: '승인 완료: 마감 변경 (key: WP-100)' },
      ],
    });
    expect(msg).toContain('기존 요약:\n이전 요약');
    expect(msg).toContain('사용자: WP-100 마감 10/31 로');
    expect(msg).toContain('AI: 변경했습니다.');
    expect(msg).toContain('[승인 결과]: 승인 완료: 마감 변경 (key: WP-100)');
  });

  it('기존 요약이 없으면 (없음) 으로 표시한다', () => {
    const msg = buildContextSummaryMessage({ ...base, messages: [{ role: 'USER', content: 'a' }] });
    expect(msg).toContain('기존 요약:\n(없음)');
  });
});

describe('runHomeContextSummary', () => {
  // 러너 이벤트 픽스처 — result 이벤트의 ok/text 만 바꿔 성공·실패 실행을 흉내 낸다.
  const resultEvents = (ok: boolean, text: string | null) => [{ type: 'result', ok, text, usage: null }];

  it('러너 결과 텍스트를 trim 해 summary 로 반환하고 태그를 home-context-summary 로 둔다', async () => {
    runTextEventsSpy.mockResolvedValue(resultEvents(true, '  갱신된 요약  '));
    const out = await runHomeContextSummary(
      { ...base, messages: [{ role: 'USER', content: 'a' }] },
      { client: {} as never },
    );
    expect(out).toEqual({ summary: '갱신된 요약' });
    expect(runTextEventsSpy.mock.calls[0][4]).toBe('home-context-summary');
    expect(runTextEventsSpy.mock.calls[0][2]).toEqual(base);
  });

  it('빈 결과면 예외(라우트가 502 로 매핑)', async () => {
    runTextEventsSpy.mockResolvedValue(resultEvents(true, '   '));
    await expect(
      runHomeContextSummary({ ...base, messages: [{ role: 'USER', content: 'a' }] }, { client: {} as never }),
    ).rejects.toThrow();
  });
});

describe('runHomeContextSummary 실패 실행', () => {
  // 러너가 실패(ok:false)로 끝나도 부분 텍스트가 있으면 runText 는 그걸 돌려준다 — 그 조각을 요약으로
  // 저장하면 이후 턴 맥락이 오염되므로 요약 경로는 실패 실행을 거부해야 한다(라우트가 502 로 매핑).
  it('result ok:false 면 부분 텍스트가 있어도 예외', async () => {
    runTextEventsSpy.mockResolvedValue([{ type: 'result', ok: false, text: '부분 요약 조각', usage: null }]);
    await expect(
      runHomeContextSummary({ ...base, messages: [{ role: 'USER', content: 'a' }] }, { client: {} as never }),
    ).rejects.toThrow();
  });

  it('result 이벤트가 없으면(중단된 실행) assistant_text 가 있어도 예외', async () => {
    runTextEventsSpy.mockResolvedValue([{ type: 'assistant_text', text: '중간 텍스트' }]);
    await expect(
      runHomeContextSummary({ ...base, messages: [{ role: 'USER', content: 'a' }] }, { client: {} as never }),
    ).rejects.toThrow();
  });
});

describe('homeContextSummaryInput', () => {
  it('messages 비면 실패, previousSummary null 허용', () => {
    expect(homeContextSummaryInput.safeParse({ ...base, messages: [] }).success).toBe(false);
    expect(
      homeContextSummaryInput.safeParse({ ...base, previousSummary: null, messages: [{ role: 'USER', content: 'a' }] })
        .success,
    ).toBe(true);
  });
});
