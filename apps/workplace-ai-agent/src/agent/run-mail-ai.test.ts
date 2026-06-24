import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'x']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCliCollect: vi.fn(),
}));
vi.mock('./mcp-config.js', () => ({
  writeTempMcpConfig: vi.fn(() => '/tmp/cfg.json'),
  cleanupTempMcpConfig: vi.fn(),
}));

import { runMailClassify, runMailSummarize, runMailReplyDraft, runMailDraftCoaching } from './run-mail-ai.js';
import { runClaudeCliCollect } from './cli-runner.js';
import { cleanupTempMcpConfig } from './mcp-config.js';

const fakeClient = { getOAuthToken: vi.fn() } as never;
const cfg = { assistantAgentId: 7, model: 'claude-sonnet-4-6', maxTurns: 1, timeoutMs: 60_000 };

beforeEach(() => {
  vi.clearAllMocks();
  (fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken =
    vi.fn().mockResolvedValue({ token: 'tok', label: null });
});

describe('runMailClassify', () => {
  it('분류 JSON 결과 반환 + 비서 토큰 fetch', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([
      JSON.stringify({ type: 'result', subtype: 'success', result: '{"category":"업무","needsReply":true}' }),
    ]);
    const out = await runMailClassify({ ...cfg, subject: '회의', from: 'a@b', snippet: '내일 2시' }, { client: fakeClient });
    expect(out).toEqual({ category: '업무', needsReply: true });
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(7);
  });
});

describe('runMailSummarize', () => {
  it('요약 텍스트 반환', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([
      JSON.stringify({ type: 'result', subtype: 'success', result: '• 핵심' }),
    ]);
    const out = await runMailSummarize({ ...cfg, subject: 's', from: 'a@b', body: '본문' }, { client: fakeClient });
    expect(out).toEqual({ summary: '• 핵심' });
  });
});

describe('runMailReplyDraft', () => {
  it('답장 본문 반환 + 실패 시 temp 정리', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([
      JSON.stringify({ type: 'result', subtype: 'success', result: '안녕하세요, …' }),
    ]);
    const out = await runMailReplyDraft({ ...cfg, replyingAs: 'me@x', thread: [{ from: 'a@b', date: 'd', body: '원문' }] }, { client: fakeClient });
    expect(out.draftBody).toContain('안녕하세요');
    expect(cleanupTempMcpConfig).toHaveBeenCalledWith('/tmp/cfg.json');
  });
});

describe('runMailDraftCoaching', () => {
  it('코칭 JSON 파싱 결과 반환', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: '{"notes":[{"dimension":"TONE","message":"명령조"}],"improvedBodyHtml":"<p>개선</p>"}',
      }),
    ]);
    const out = await runMailDraftCoaching(
      { ...cfg, replyingAs: 'me@x', draftBody: '빨리 보내', thread: [] },
      { client: fakeClient },
    );
    expect(out.notes).toEqual([{ dimension: 'TONE', message: '명령조' }]);
    expect(out.improvedBodyHtml).toBe('<p>개선</p>');
    expect(cleanupTempMcpConfig).toHaveBeenCalledWith('/tmp/cfg.json');
  });
});
