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
    expect(args).toContain('--allowed-tools');
    expect(args).toContain('mcp__workplace__*');
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/abs/mcp.json');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--disallowed-tools');
  });
});

describe('buildChildEnv', () => {
  it('token + agentId 인자 → 둘 다 child env 에 주입', () => {
    const env = buildChildEnv({ FOO: 'bar' }, 'tk-X', 201);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tk-X');
    expect(env.ACTING_AGENT_ID).toBe('201');
    expect(env.FOO).toBe('bar');
  });

  it('parent 의 CLAUDE_CODE_OAUTH_TOKEN 은 인자 token 으로 override', () => {
    const env = buildChildEnv(
      { CLAUDE_CODE_OAUTH_TOKEN: 'parent-stale' },
      'tk-fresh',
      99,
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tk-fresh');
    expect(env.ACTING_AGENT_ID).toBe('99');
  });

  it('parent INTERNAL_SERVICE_TOKEN 은 그대로 전달 (MCP child 가 사용)', () => {
    const env = buildChildEnv(
      { INTERNAL_SERVICE_TOKEN: 'srv-tk' },
      'tk-X',
      201,
    );
    expect(env.INTERNAL_SERVICE_TOKEN).toBe('srv-tk');
  });

  it('ANTHROPIC_API_KEY 는 항상 제거', () => {
    const env = buildChildEnv({ ANTHROPIC_API_KEY: 'should-go' }, 'tk-X', 201);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
