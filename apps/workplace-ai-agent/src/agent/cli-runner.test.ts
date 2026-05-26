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
  it('ANTHROPIC_API_KEY 제거 + CLAUDE_CODE_OAUTH_TOKEN 주입', () => {
    const parent = {
      ANTHROPIC_API_KEY: 'should-be-removed',
      CLAUDE_CODE_OAUTH_TOKEN: 'sub-token',
      WORKPLACE_AGENT_API_KEY: 'k',
      OTHER: 'keep',
    };
    const env = buildChildEnv(parent);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sub-token');
    expect(env.WORKPLACE_AGENT_API_KEY).toBe('k');
    expect(env.OTHER).toBe('keep');
  });

  it('CLAUDE_CODE_OAUTH_TOKEN 누락 시에도 단순 복사 (caller 가 부트에서 검증)', () => {
    const env = buildChildEnv({ FOO: 'bar' });
    expect(env.FOO).toBe('bar');
  });
});
