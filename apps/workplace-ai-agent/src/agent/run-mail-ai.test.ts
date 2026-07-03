import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./sdk-runner.js', () => ({
  runSdkCollect: vi.fn(),
}));

import { runMailClassify, runMailSummarize, runMailReplyDraft, runMailDraftCoaching } from './run-mail-ai.js';
import { runSdkCollect } from './sdk-runner.js';

const fakeClient = { getProviderCredential: vi.fn() } as never;
const cfg = { assistantAgentId: 7, model: 'claude-sonnet-4-6', maxTurns: 1, timeoutMs: 60_000 };

beforeEach(() => {
  vi.clearAllMocks();
  (fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential =
    vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null });
});

describe('runMailClassify', () => {
  it('분류 JSON 결과 반환 + 비서 토큰 fetch', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([
      JSON.stringify({ type: 'result', subtype: 'success', result: '{"category":"업무","needsReply":true}' }),
    ]);
    const out = await runMailClassify({ ...cfg, subject: '회의', from: 'a@b', snippet: '내일 2시' }, { client: fakeClient });
    expect(out).toEqual({ category: '업무', needsReply: true });
    expect((fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential).toHaveBeenCalledWith(7);
  });

  it('모델 결정: cfg.model(요청 body)이 credential.model 보다 우선한다', async () => {
    (fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential =
      vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: 'claude-opus-4-1' });
    vi.mocked(runSdkCollect).mockResolvedValue([
      JSON.stringify({ type: 'result', subtype: 'success', result: '{"category":"업무","needsReply":true}' }),
    ]);
    await runMailClassify({ ...cfg, subject: '회의', from: 'a@b', snippet: '내일 2시' }, { client: fakeClient });
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.model).toBe('claude-sonnet-4-6'); // cfg.model 그대로(body 우선)
  });
});

describe('runMailSummarize', () => {
  it('요약 텍스트 반환', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([
      JSON.stringify({ type: 'result', subtype: 'success', result: '• 핵심' }),
    ]);
    const out = await runMailSummarize({ ...cfg, subject: 's', from: 'a@b', body: '본문' }, { client: fakeClient });
    expect(out).toEqual({ summary: '• 핵심' });
  });
});

describe('runMailReplyDraft', () => {
  it('답장 본문 반환 + 실패 시 temp 정리', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([
      JSON.stringify({ type: 'result', subtype: 'success', result: '안녕하세요, …' }),
    ]);
    const out = await runMailReplyDraft({ ...cfg, replyingAs: 'me@x', thread: [{ from: 'a@b', date: 'd', body: '원문' }] }, { client: fakeClient });
    expect(out.draftBody).toContain('안녕하세요');
  });
});

describe('runMailDraftCoaching', () => {
  it('코칭 JSON 파싱 결과 반환', async () => {
    vi.mocked(runSdkCollect).mockResolvedValue([
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
  });
});
