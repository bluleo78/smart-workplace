import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseConfigFromEnv, buildHostBridge } from './stdio-entry.js';

function baseEnv(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    WORKPLACE_API_BASE_URL: 'http://localhost:9090/api/v1',
    INTERNAL_SERVICE_TOKEN: 'tok-123',
    MCP_PROFILE: 'assistant',
    MCP_ON_BEHALF_OF: '42',
    ...over,
  } as NodeJS.ProcessEnv;
}

describe('parseConfigFromEnv', () => {
  it('필수 env 만 있으면 최소 설정을 반환한다', () => {
    const config = parseConfigFromEnv(baseEnv());
    expect(config).toEqual({
      baseURL: 'http://localhost:9090/api/v1',
      internalToken: 'tok-123',
      profile: 'assistant',
      onBehalfOfId: 42,
      threadBinding: undefined,
      delegationContext: undefined,
      bridgeUrl: undefined,
      bridgeRunId: undefined,
    });
  });

  it('WORKPLACE_API_BASE_URL 누락 시 throw', () => {
    expect(() => parseConfigFromEnv(baseEnv({ WORKPLACE_API_BASE_URL: undefined }))).toThrow(
      /WORKPLACE_API_BASE_URL/,
    );
  });

  it('INTERNAL_SERVICE_TOKEN 누락 시 throw', () => {
    expect(() => parseConfigFromEnv(baseEnv({ INTERNAL_SERVICE_TOKEN: undefined }))).toThrow(
      /INTERNAL_SERVICE_TOKEN/,
    );
  });

  it('MCP_PROFILE 이 허용값 밖이면 throw', () => {
    expect(() => parseConfigFromEnv(baseEnv({ MCP_PROFILE: 'bogus' }))).toThrow(/MCP_PROFILE/);
  });

  it('MCP_PROFILE 누락 시 throw', () => {
    expect(() => parseConfigFromEnv(baseEnv({ MCP_PROFILE: undefined }))).toThrow(/MCP_PROFILE/);
  });

  it('MCP_ON_BEHALF_OF 가 숫자가 아니면 throw', () => {
    expect(() => parseConfigFromEnv(baseEnv({ MCP_ON_BEHALF_OF: 'abc' }))).toThrow(/MCP_ON_BEHALF_OF/);
  });

  it('MCP_ON_BEHALF_OF 누락 시 throw', () => {
    expect(() => parseConfigFromEnv(baseEnv({ MCP_ON_BEHALF_OF: undefined }))).toThrow(/MCP_ON_BEHALF_OF/);
  });

  it('MCP_THREAD_BINDING JSON 을 파싱한다', () => {
    const config = parseConfigFromEnv(
      baseEnv({ MCP_THREAD_BINDING: JSON.stringify({ channelId: 5, parentMessageId: 9 }) }),
    );
    expect(config.threadBinding).toEqual({ channelId: 5, parentMessageId: 9 });
  });

  it('MCP_THREAD_BINDING 이 잘못된 JSON 이면 throw', () => {
    expect(() => parseConfigFromEnv(baseEnv({ MCP_THREAD_BINDING: '{not json' }))).toThrow(
      /MCP_THREAD_BINDING/,
    );
  });

  it('MCP_DELEGATION_CONTEXT JSON 을 파싱한다', () => {
    const config = parseConfigFromEnv(
      baseEnv({ MCP_DELEGATION_CONTEXT: JSON.stringify({ actorId: 1, channelId: 2 }) }),
    );
    expect(config.delegationContext).toEqual({ actorId: 1, channelId: 2 });
  });

  it('MCP_DELEGATION_CONTEXT 이 잘못된 JSON 이면 throw', () => {
    expect(() => parseConfigFromEnv(baseEnv({ MCP_DELEGATION_CONTEXT: '{not json' }))).toThrow(
      /MCP_DELEGATION_CONTEXT/,
    );
  });

  it('MCP_BRIDGE_URL/MCP_BRIDGE_RUN_ID 를 그대로 전달한다', () => {
    const config = parseConfigFromEnv(
      baseEnv({ MCP_BRIDGE_URL: 'http://localhost:7070/internal/bridge', MCP_BRIDGE_RUN_ID: 'run-1' }),
    );
    expect(config.bridgeUrl).toBe('http://localhost:7070/internal/bridge');
    expect(config.bridgeRunId).toBe('run-1');
  });
});

describe('buildHostBridge', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('onProposal 이 POST {bridgeUrl}/{runId} 로 kind=proposal 콜백을 보낸다', async () => {
    const bridge = buildHostBridge('http://localhost:7070/internal/bridge', 'run-1', 'tok-123');
    bridge.onProposal({ actionType: 'calendar.create_event', summary: '요약', params: { a: 1 } });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('http://localhost:7070/internal/bridge/run-1');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Internal tok-123' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      kind: 'proposal',
      data: { actionType: 'calendar.create_event', summary: '요약', params: { a: 1 } },
    });
  });

  it('onSubmitResponse 가 kind=submit_response 콜백을 보낸다', async () => {
    const bridge = buildHostBridge('http://localhost:7070/internal/bridge', 'run-1', 'tok-123');
    bridge.onSubmitResponse('답변');
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      kind: 'submit_response',
      data: '답변',
    });
  });

  it('onUnassignResult 가 kind=unassign 콜백을 보낸다', async () => {
    const bridge = buildHostBridge('http://localhost:7070/internal/bridge', 'run-1', 'tok-123');
    bridge.onUnassignResult({ ok: true });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      kind: 'unassign',
      data: { ok: true },
    });
  });

  it('fetch 실패는 throw 하지 않고 stderr 로만 로깅한다', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bridge = buildHostBridge('http://localhost:7070/internal/bridge', 'run-1', 'tok-123');
    expect(() => bridge.onSubmitResponse('답변')).not.toThrow();
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled());
  });
});
