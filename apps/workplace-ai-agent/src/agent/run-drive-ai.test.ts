import { describe, it, expect, vi, beforeEach } from 'vitest';

// agent-runner mock — runnerFor().stream 입력(userMessage)을 확인한다(run-wiki-compose.test 와 같은 방식).
const { streamSpy } = vi.hoisted(() => ({ streamSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({
  runnerFor: vi.fn(() => ({ stream: streamSpy, collect: vi.fn() })),
}));

import { runDriveOverview } from './run-drive-ai.js';

const fakeClient = { getProviderCredential: vi.fn() } as never;

beforeEach(() => {
  vi.clearAllMocks();
  (fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential =
    vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null });
});

describe('runDriveOverview — 읽기 전용 메모리 (WP-381)', () => {
  it('요청문 맨 앞에 메모리 블록, 없으면 질문부터', async () => {
    streamSpy.mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    const base = { query: '일정은?', excerpts: [{ name: 'plan.pdf', text: '1분기' }], assistantAgentId: 7 };

    await runDriveOverview({ ...base, memories: [{ id: 4, kind: 'PREFERENCE', content: '개요는 표로', scope: 'DRIVE' }] }, { client: fakeClient }, () => {});
    expect(streamSpy.mock.calls[0][0].userMessage).toContain('- [#4 선호·드라이브] 개요는 표로\n\n질문: 일정은?');

    await runDriveOverview(base, { client: fakeClient }, () => {});
    expect(streamSpy.mock.calls[1][0].userMessage.startsWith('질문: 일정은?')).toBe(true);
  });

  it('WP-386: 공용 블록 다음 질문', async () => {
    streamSpy.mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runDriveOverview(
      { query: '일정은?', excerpts: [{ name: 'plan.pdf', text: '1분기' }], assistantAgentId: 7, sharedMemories: [{ space: '조직', content: '분기는 4월에 시작한다' }] },
      { client: fakeClient },
      () => {},
    );
    expect(streamSpy.mock.calls[0][0].userMessage).toContain('- [조직] 분기는 4월에 시작한다\n\n질문: 일정은?');
  });
});
