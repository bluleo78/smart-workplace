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

  it('allowFileRead=true → allowed-tools 에 Read 포함, disallowed 에서 Read 제외', () => {
    const args = buildCliArgs({
      userMessage: 'm',
      systemPrompt: 's',
      model: 'x',
      maxTurns: 5,
      mcpConfigPath: '/tmp/c.json',
      allowFileRead: true,
    });
    const allowed = args[args.indexOf('--allowed-tools') + 1];
    const disallowed = args[args.indexOf('--disallowed-tools') + 1];
    expect(allowed).toContain('Read');
    expect(allowed).toContain('mcp__workplace__*');
    expect(disallowed.split(',')).not.toContain('Read');
  });

  it('allowFileRead 생략 → 기존대로 Read 차단', () => {
    const args = buildCliArgs({
      userMessage: 'm',
      systemPrompt: 's',
      model: 'x',
      maxTurns: 5,
      mcpConfigPath: '/tmp/c.json',
    });
    const allowed = args[args.indexOf('--allowed-tools') + 1];
    const disallowed = args[args.indexOf('--disallowed-tools') + 1];
    expect(allowed).toBe('mcp__workplace__*');
    expect(disallowed.split(',')).toContain('Read');
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

describe('buildCliArgs includePartialMessages=false', () => {
  it('partial messages 플래그를 제외한다', () => {
    const args = buildCliArgs({
      userMessage: 'q', systemPrompt: 's', model: 'm', maxTurns: 8,
      mcpConfigPath: '/x.json', includePartialMessages: false,
    });
    expect(args).not.toContain('--include-partial-messages');
    expect(args).toContain('stream-json');
  });
  it('기본값은 partial messages 포함(기존 동작 유지)', () => {
    const args = buildCliArgs({
      userMessage: 'q', systemPrompt: 's', model: 'm', maxTurns: 8, mcpConfigPath: '/x.json',
    });
    expect(args).toContain('--include-partial-messages');
  });
});
