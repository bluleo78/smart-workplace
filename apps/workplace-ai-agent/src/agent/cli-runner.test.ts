import { describe, expect, it } from 'vitest';
import { buildCliArgs, buildChildEnv } from './cli-runner.js';

describe('buildCliArgs', () => {
  it('필수 옵션 포함', () => {
    const args = buildCliArgs({
      userMessage: 'hello',
      systemPrompt: 'sys',
      model: 'claude-sonnet-4-6',
      maxTurns: 10,
      mcpConfigPath: '/abs/mcp.json',
    });
    expect(args).toContain('--print');
    expect(args).toContain('hello');
    expect(args).toContain('--system-prompt');
    expect(args).toContain('sys');
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-6');
    expect(args).toContain('--max-turns');
    expect(args).toContain('10');
    expect(args).toContain('--allowedTools');
    expect(args).toContain('mcp__workplace__*');
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/abs/mcp.json');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--dangerously-skip-permissions');
  });
});

describe('buildChildEnv', () => {
  it('token 인자 → CLAUDE_CODE_OAUTH_TOKEN 으로 주입', () => {
    const env = buildChildEnv({ FOO: 'bar' }, 'tk-X');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tk-X');
    expect(env.FOO).toBe('bar');
  });

  it('parent 의 CLAUDE_CODE_OAUTH_TOKEN 은 무시되고 인자 token 으로 override', () => {
    const env = buildChildEnv(
      { CLAUDE_CODE_OAUTH_TOKEN: 'parent-stale', OTHER: 'keep' },
      'tk-fresh',
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tk-fresh');
    expect(env.OTHER).toBe('keep');
  });

  it('ANTHROPIC_API_KEY 는 항상 제거 (구독 모드 강제)', () => {
    const env = buildChildEnv({ ANTHROPIC_API_KEY: 'should-go' }, 'tk-X');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
