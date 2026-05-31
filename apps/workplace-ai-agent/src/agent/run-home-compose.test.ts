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

import { runHomeCompose, type ComposeInput } from './run-home-compose.js';
import { runClaudeCliCollect, buildCliArgs } from './cli-runner.js';
import { cleanupTempMcpConfig } from './mcp-config.js';

const fakeClient = { getOAuthToken: vi.fn() } as never;

// 비서 설정은 이제 요청 본문으로 온다(env 미사용). 테스트용 기본 입력.
function baseInput(over: Partial<ComposeInput> = {}): ComposeInput {
  return {
    query: '내 할 일',
    assistantAgentId: 7,
    model: 'claude-sonnet-4-6',
    thinkingDepth: 'NORMAL',
    maxTurns: 8,
    timeoutMs: 60_000,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken =
    vi.fn().mockResolvedValue({ token: 'tok', label: null });
});

describe('runHomeCompose', () => {
  it('CLI 출력 라인을 파싱해 {message, widgets} 반환', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'show_my_tasks', input: {} }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: '할 일이에요.' }),
    ]);
    const out = await runHomeCompose(baseInput(), { client: fakeClient });
    expect(out).toEqual({ message: '할 일이에요.', widgets: [{ type: 'my_tasks', params: {} }] });
    // 회귀 가드: 비서 토큰을 요청의 assistantAgentId(7)로 실제 fetch 했는지 검증.
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(7);
  });

  it('요청의 assistantAgentId 로 토큰을 fetch 한다(env 미사용)', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([]);
    await runHomeCompose(baseInput({ assistantAgentId: 42 }), { client: fakeClient });
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(42);
  });

  it('thinkingDepth(DEEP) 를 system-prompt 에 반영해 buildCliArgs 에 전달', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([]);
    await runHomeCompose(baseInput({ thinkingDepth: 'DEEP' }), { client: fakeClient });
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(passed.systemPrompt).toContain('신중하게');
    expect(passed.model).toBe('claude-sonnet-4-6');
    expect(passed.maxTurns).toBe(8);
  });

  it('CLI 실패(reject) 가 전파되고 temp config 는 정리된다', async () => {
    vi.mocked(runClaudeCliCollect).mockRejectedValue(new Error('cli boom'));
    await expect(runHomeCompose(baseInput(), { client: fakeClient })).rejects.toThrow('cli boom');
    expect(cleanupTempMcpConfig).toHaveBeenCalledWith('/tmp/cfg.json');
  });

  it('recentContext 를 프롬프트에 임베드해 buildCliArgs 에 전달', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([]);
    await runHomeCompose(
      baseInput({ query: '그 중 HIGH 만', recentContext: [{ role: 'USER', content: '내 담당 보여줘' }] }),
      { client: fakeClient },
    );
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0].userMessage;
    expect(passed).toContain('내 담당 보여줘');
    expect(passed).toContain('그 중 HIGH 만');
  });
});
