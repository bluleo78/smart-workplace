import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runTextSpy } = vi.hoisted(() => ({ runTextSpy: vi.fn() }));
vi.mock('./run-messaging-ai.js', () => ({ runText: runTextSpy }));

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
  it('runText 결과를 trim 해 summary 로 반환하고 태그를 home-context-summary 로 둔다', async () => {
    runTextSpy.mockResolvedValue('  갱신된 요약  ');
    const out = await runHomeContextSummary(
      { ...base, messages: [{ role: 'USER', content: 'a' }] },
      { client: {} as never },
    );
    expect(out).toEqual({ summary: '갱신된 요약' });
    expect(runTextSpy.mock.calls[0][4]).toBe('home-context-summary');
    expect(runTextSpy.mock.calls[0][2]).toEqual(base);
  });

  it('빈 결과면 예외(라우트가 502 로 매핑)', async () => {
    runTextSpy.mockResolvedValue('   ');
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
