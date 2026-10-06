import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { parseConfigFromEnv, buildHostBridge, registerStdioTool, VISION_UNAVAILABLE_NOTICE } from './stdio-entry.js';
import type { McpTool } from './tools.js';

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
      chatThreadId: undefined,
      bridgeUrl: undefined,
      bridgeRunId: undefined,
      vision: true,
    });
  });

  it('MCP_VISION=0 이면 vision=false, 1 이면 true(WP-241)', () => {
    expect(parseConfigFromEnv(baseEnv({ MCP_VISION: '0' })).vision).toBe(false);
    expect(parseConfigFromEnv(baseEnv({ MCP_VISION: '1' })).vision).toBe(true);
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

  // WP-244: chat 도구 실행 스레드 바인딩.
  it('MCP_CHAT_THREAD_ID 를 숫자로 파싱한다', () => {
    expect(parseConfigFromEnv(baseEnv({ MCP_CHAT_THREAD_ID: '17' })).chatThreadId).toBe(17);
  });

  it.each(['abc', '0', '-3', '1.5'])('MCP_CHAT_THREAD_ID 가 양의 정수가 아니면(%s) throw', (v) => {
    expect(() => parseConfigFromEnv(baseEnv({ MCP_CHAT_THREAD_ID: v }))).toThrow(/MCP_CHAT_THREAD_ID/);
  });

  // WP-234: 메인 AI 채팅 세션 바인딩(home_session.id, UUID).
  it('MCP_HOME_SESSION_ID 를 그대로 homeSessionId 로 파싱한다', () => {
    const sid = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';
    expect(parseConfigFromEnv(baseEnv({ MCP_HOME_SESSION_ID: sid })).homeSessionId).toBe(sid);
    expect(parseConfigFromEnv(baseEnv()).homeSessionId).toBeUndefined();
  });

  it.each(['abc', '12', '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f/../x'])('MCP_HOME_SESSION_ID 가 UUID 가 아니면(%s) throw', (v) => {
    expect(() => parseConfigFromEnv(baseEnv({ MCP_HOME_SESSION_ID: v }))).toThrow(/MCP_HOME_SESSION_ID/);
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

// WP-240: stdio 경로(opencode)도 도구가 반환한 content 블록을 MCP 응답에 그대로 싣는지 실제 서버·클라이언트 왕복으로 확인.
describe('registerStdioTool', () => {
  async function callVia(handler: McpTool['handler'], opts?: { vision: boolean }) {
    const server = new McpServer({ name: 'workplace', version: '1.0.0' });
    registerStdioTool(server, { name: 't', description: 'd', inputSchema: z.object({}), handler }, opts);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 'test', version: '0.0.1' });
    await client.connect(clientT);
    try {
      return await client.callTool({ name: 't', arguments: {} });
    } finally {
      await client.close();
    }
  }

  it('문자열 반환은 text 블록 하나(기존 동작)', async () => {
    const res = await callVia(async () => '{"ok":true}');
    expect(res.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
  });

  it('이미지 블록 배열은 그대로 전달', async () => {
    const blocks = [
      { type: 'text' as const, text: '첨부:' },
      { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' },
    ];
    const res = await callVia(async () => blocks);
    expect(res.content).toEqual(blocks);
  });

  it('비전 미지원(vision=false)이면 이미지 블록을 안내 문구로 바꾼다(WP-241)', async () => {
    const res = await callVia(
      async () => [
        { type: 'text' as const, text: '첨부:' },
        { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ],
      { vision: false },
    );
    expect(res.content).toEqual([
      { type: 'text', text: '첨부:' },
      { type: 'text', text: `[image/png 1KB] ${VISION_UNAVAILABLE_NOTICE}` },
    ]);
  });

  it('핸들러 throw 는 isError 텍스트', async () => {
    const res = await callVia(async () => {
      throw new Error('boom');
    });
    expect(res).toMatchObject({ isError: true, content: [{ type: 'text', text: 'boom' }] });
  });
});
