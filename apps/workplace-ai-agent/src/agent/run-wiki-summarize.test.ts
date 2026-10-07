import { describe, it, expect, vi, beforeEach } from 'vitest';

// agent-runner mock — runnerFor().collect 로 단발 실행 결과(RunnerEvent[])를 돌려준다.
const { collectSpy } = vi.hoisted(() => ({ collectSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({
  runnerFor: vi.fn(() => ({ collect: collectSpy, stream: vi.fn() })),
}));

import { runWikiSummarize } from './run-wiki-summarize.js';
import { WIKI_SUMMARIZE_PROMPT } from './prompts/wiki.js';

const getProviderCredential = vi.fn();
const deps = { client: { getProviderCredential } } as never;

const input = {
  title: '주간회의',
  body: '## 결정\n배포 확정.',
  assistantAgentId: 7,
  model: 'claude-sonnet-4-6',
  maxTurns: 3,
  timeoutMs: 60_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  getProviderCredential.mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null });
});

describe('runWikiSummarize', () => {
  it('시스템 프롬프트와 <note> 로 감싼 본문을 러너에 전달한다', async () => {
    collectSpy.mockResolvedValue([{ type: 'result', ok: true, text: '요약', usage: null }]);
    await runWikiSummarize(input, deps);
    expect(getProviderCredential).toHaveBeenCalledWith(7);
    const passed = collectSpy.mock.calls[0][0] as { systemPrompt: string; userMessage: string; model: string };
    expect(passed.systemPrompt).toBe(WIKI_SUMMARIZE_PROMPT);
    expect(passed.userMessage).toContain('<note>');
    expect(passed.userMessage).toContain('배포 확정.');
    expect(passed.model).toBe('claude-sonnet-4-6');
  });

  it('결과 텍스트 앞뒤 공백을 trim 한다', async () => {
    collectSpy.mockResolvedValue([{ type: 'result', ok: true, text: '  배포를 확정했다.\n', usage: null }]);
    await expect(runWikiSummarize(input, deps)).resolves.toEqual({ summary: '배포를 확정했다.' });
  });
});
