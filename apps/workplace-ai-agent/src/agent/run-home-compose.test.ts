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

import { runHomeCompose, HomeComposerNotConfiguredError } from './run-home-compose.js';
import { runClaudeCliCollect, buildCliArgs } from './cli-runner.js';
import { cleanupTempMcpConfig } from './mcp-config.js';

const fakeClient = { getOAuthToken: vi.fn() } as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKPLACE_HOME_COMPOSER_AGENT_ID = '7';
  (fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken =
    vi.fn().mockResolvedValue({ token: 'tok', label: null });
});

describe('runHomeCompose', () => {
  it('CLI 출력 라인을 파싱해 {message, widgets} 반환', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'show_my_tasks', input: {} }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: '할 일이에요.' }),
    ]);
    const out = await runHomeCompose({ query: '내 할 일' }, { client: fakeClient });
    expect(out).toEqual({ message: '할 일이에요.', widgets: [{ type: 'my_tasks', params: {} }] });
    // 회귀 가드: composer 토큰을 env 의 agentId(7)로 실제 fetch 했는지 검증.
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(7);
  });

  it('composer agentId 미설정 → HomeComposerNotConfiguredError', async () => {
    delete process.env.WORKPLACE_HOME_COMPOSER_AGENT_ID;
    await expect(runHomeCompose({ query: 'x' }, { client: fakeClient })).rejects.toBeInstanceOf(
      HomeComposerNotConfiguredError,
    );
  });

  it('CLI 실패(reject) 가 전파되고 temp config 는 정리된다', async () => {
    vi.mocked(runClaudeCliCollect).mockRejectedValue(new Error('cli boom'));
    await expect(runHomeCompose({ query: 'x' }, { client: fakeClient })).rejects.toThrow('cli boom');
    expect(cleanupTempMcpConfig).toHaveBeenCalledWith('/tmp/cfg.json');
  });

  it('recentContext 를 프롬프트에 임베드해 buildCliArgs 에 전달', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([]);
    await runHomeCompose(
      { query: '그 중 HIGH 만', recentContext: [{ role: 'USER', content: '내 담당 보여줘' }] },
      { client: fakeClient },
    );
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0].userMessage;
    expect(passed).toContain('내 담당 보여줘');
    expect(passed).toContain('그 중 HIGH 만');
  });
});
