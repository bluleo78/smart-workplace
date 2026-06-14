import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Wiki S3(A1): runClaudeCliStream 의 라인 분리/잔여 flush/kill 을 spawn 없이 단위 검증하기 위해
// node:child_process 의 spawn 을 가짜 child(EventEmitter)로 모킹한다.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { buildCliArgs, buildChildEnv, runClaudeCliStream } from './cli-runner.js';

// 가짜 child: stdout/stderr 는 EventEmitter, kill 은 spy.
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

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

describe('runClaudeCliStream (라인 스트리밍)', () => {
  beforeEach(() => spawnMock.mockReset());

  const input = {
    args: ['--print', 'x'],
    env: {} as NodeJS.ProcessEnv,
    timeoutMs: 60_000,
    logTag: 'wiki-test',
  };

  it('stdout chunk 를 개행 단위로 분리해 onLine 을 순서대로 호출', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const lines: string[] = [];
    const handle = runClaudeCliStream(input, (l) => lines.push(l));
    // 한 청크에 1.5 라인 → 다음 청크로 나머지 + 완결 라인.
    child.stdout.emit('data', Buffer.from('{"a":1}\n{"b":'));
    child.stdout.emit('data', Buffer.from('2}\n{"c":3}\n'));
    child.emit('close', 0);
    await handle.done;
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('마지막 개행 없는 잔여 라인도 close 시 flush', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const lines: string[] = [];
    const handle = runClaudeCliStream(input, (l) => lines.push(l));
    child.stdout.emit('data', Buffer.from('{"x":1}\n{"y":2}')); // 마지막 개행 없음
    child.emit('close', 0);
    await handle.done;
    expect(lines).toEqual(['{"x":1}', '{"y":2}']);
  });

  it('non-zero exit → done reject', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const handle = runClaudeCliStream(input, () => {});
    child.emit('close', 1);
    await expect(handle.done).rejects.toThrow(/exited 1/);
  });

  it('kill() → child SIGTERM + done 정상 resolve(연결 종료)', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const handle = runClaudeCliStream(input, () => {});
    handle.kill();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    // kill 은 의도적 종료 — close 후 reject 가 아니라 resolve.
    child.emit('close', null);
    await expect(handle.done).resolves.toBeUndefined();
  });

  it('spawn error → done reject', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const handle = runClaudeCliStream(input, () => {});
    child.emit('error', new Error('spawn boom'));
    await expect(handle.done).rejects.toThrow('spawn boom');
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
