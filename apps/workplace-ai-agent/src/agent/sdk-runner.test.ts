import { vi } from 'vitest';
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('../logger.js', () => ({ log: { info: vi.fn(), error: vi.fn() } }));
import { query } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { buildSdkOptions, runSdkStream, type SdkRunInput } from './sdk-runner.js';

function baseInput(over: Partial<SdkRunInput> = {}): SdkRunInput {
  return {
    userMessage: 'hello',
    systemPrompt: 'sys',
    model: 'claude-sonnet-4-6',
    maxTurns: 8,
    token: 'tok-abc',
    agentId: 7,
    timeoutMs: 60_000,
    logTag: 'wiki-compose:7',
    ...over,
  };
}

describe('buildSdkOptions', () => {
  it('hermetic 3종 + bypassPermissions 고정', () => {
    const o = buildSdkOptions(baseInput());
    expect(o.settingSources).toEqual([]);
    expect(o.strictMcpConfig).toBe(true);
    expect(typeof o.cwd).toBe('string');
    expect(o.cwd!.length).toBeGreaterThan(0);
    expect(o.permissionMode).toBe('bypassPermissions');
  });

  it('model·maxTurns·systemPrompt(string) 매핑 + includePartialMessages 기본 true', () => {
    const o = buildSdkOptions(baseInput());
    expect(o.model).toBe('claude-sonnet-4-6');
    expect(o.maxTurns).toBe(8);
    expect(o.systemPrompt).toBe('sys');
    expect(o.includePartialMessages).toBe(true);
  });

  it('includePartialMessages=false 명시 시 false', () => {
    expect(buildSdkOptions(baseInput({ includePartialMessages: false })).includePartialMessages).toBe(false);
  });

  it('allowedTools 화이트리스트: 기본은 mcp 와일드카드만, built-in 은 disallowed', () => {
    const o = buildSdkOptions(baseInput());
    expect(o.allowedTools).toEqual(['mcp__workplace__*']);
    expect(o.disallowedTools).toContain('Bash');
    expect(o.disallowedTools).toContain('Write');
  });

  it('env: OAuth 토큰·ACTING_AGENT_ID 주입, ANTHROPIC_API_KEY 삭제(키가 있어도)', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'leak-me';
    try {
      const o = buildSdkOptions(baseInput({ agentId: 7 }));
      expect(o.env!.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok-abc');
      expect(o.env!.ACTING_AGENT_ID).toBe('7');
      // 실제 키가 process.env 에 있어도 반환된 env 에서 제거됐는지 검증
      expect(o.env!.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('userId 지정 시 ACTING_USER_ID 주입, 미지정 시 미설정', () => {
    expect(buildSdkOptions(baseInput({ userId: 12 })).env!.ACTING_USER_ID).toBe('12');
    expect(buildSdkOptions(baseInput()).env!.ACTING_USER_ID).toBeUndefined();
  });
});

// 가짜 Query: 메시지 배열을 yield + interrupt() 보유. mode='gate' 면 interrupt 까지 대기 후 throw(SDK 실측 동작).
function makeQuery(messages: unknown[], opts: { gate?: boolean; hang?: boolean } = {}) {
  let release!: (how: string) => void;
  const gated = new Promise<string>((r) => { release = r; });
  const interrupt = vi.fn(async () => release('interrupt'));
  const gen = (async function* () {
    for (const m of messages) yield m;
    if (opts.hang) { await gated; } // result 안 옴 — timeout 유도. gated 대기: interrupt() 호출 시 해제되어 아래 gate 분기로 throw(brief 오류수정: 원본 `new Promise(()=>{})` 는 interrupt 에 반응 못해 test hang)
    if (opts.gate) {
      const how = await gated;
      if (how === 'interrupt') throw new Error('Interrupted by user'); // 실측: interrupt 후 throw
    }
  })();
  return Object.assign(gen, { interrupt });
}

describe('runSdkStream', () => {
  const input = (): SdkRunInput => ({
    userMessage: 'u', systemPrompt: 's', model: 'm', maxTurns: 1,
    token: 't', agentId: 1, timeoutMs: 60_000, logTag: 'test',
  });

  it('각 SDKMessage 를 JSON.stringify 해 onLine 에 흘리고 result 후 done resolve', async () => {
    const msgs = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'result', subtype: 'success', is_error: false },
    ];
    vi.mocked(query).mockReturnValue(makeQuery(msgs) as never);
    const lines: string[] = [];
    const h = runSdkStream(input(), (l) => lines.push(l));
    await h.done;
    expect(lines).toEqual(msgs.map((m) => JSON.stringify(m)));
  });

  it('result.is_error=true 면 done reject', async () => {
    vi.mocked(query).mockReturnValue(makeQuery([{ type: 'result', subtype: 'error', is_error: true }]) as never);
    const h = runSdkStream(input(), () => {});
    await expect(h.done).rejects.toThrow();
  });

  it('kill() → interrupt 호출 + done 은 정상 resolve(throw 흡수)', async () => {
    const q = makeQuery([{ type: 'assistant', message: { content: [] } }], { gate: true });
    vi.mocked(query).mockReturnValue(q as never);
    const h = runSdkStream(input(), () => {});
    await new Promise((r) => setTimeout(r, 0));
    h.kill();
    await expect(h.done).resolves.toBeUndefined();
    expect(q.interrupt).toHaveBeenCalledOnce();
  });

  it('timeout → interrupt 호출 + done reject(timeout)', async () => {
    const q = makeQuery([{ type: 'assistant', message: { content: [] } }], { hang: true, gate: true });
    vi.mocked(query).mockReturnValue(q as never);
    const h = runSdkStream({ ...input(), timeoutMs: 20 }, () => {});
    await expect(h.done).rejects.toThrow(/timeout/);
    expect(q.interrupt).toHaveBeenCalled();
  });
});
