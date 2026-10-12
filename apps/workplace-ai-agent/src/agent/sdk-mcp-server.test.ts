import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// SDK createSdkMcpServer mock — 전달된 tools 를 캡처해 반환.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: vi.fn((opts: unknown) => ({ type: 'sdk', name: 'workplace', instance: {}, __opts: opts })),
}));
// buildTools mock — 호출 인자 캡처 + 가짜 도구 1개 반환.
const fakeHandler = vi.fn(async () => '{"ok":true}');
vi.mock('../mcp/tools.js', () => ({
  buildTools: vi.fn(() => [
    { name: 'get_issue_detail', description: 'd', inputSchema: z.object({ issueKey: z.string() }), handler: fakeHandler },
  ]),
}));

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { buildTools } from '../mcp/tools.js';
import { adaptMcpTool, buildInProcessWorkplaceMcpServer } from './sdk-mcp-server.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { toolAnnotations, type SharedTool } from '@smart-workplace/mcp-tools-shared';

describe('adaptMcpTool', () => {
  it('string 반환을 CallToolResult content 로 래핑', async () => {
    const adapted = adaptMcpTool({
      name: 't', description: 'd', inputSchema: z.object({ a: z.string() }),
      handler: async () => 'hello',
    });
    const res = await adapted.handler({ a: 'x' }, undefined);
    expect(res).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('handler throw 를 isError CallToolResult 로 변환', async () => {
    const adapted = adaptMcpTool({
      name: 't', description: 'd', inputSchema: z.object({}),
      handler: async () => { throw new Error('boom'); },
    });
    const res = await adapted.handler({}, undefined);
    expect(res).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] });
  });

  it('McpTool.annotations 를 SDK 도구 정의에 그대로 싣는다(WP-342)', () => {
    const annotations = { title: '이슈 수정', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
    const adapted = adaptMcpTool({ name: 't', description: 'd', inputSchema: z.object({}), handler: async () => 'x', annotations });
    expect(adapted.annotations).toEqual(annotations);
    // 로컬 전용 도구는 힌트가 없다.
    expect(adaptMcpTool({ name: 't', description: 'd', inputSchema: z.object({}), handler: async () => 'x' }).annotations).toBeUndefined();
  });

  it('inputSchema 를 ZodObject.shape 로 추출', () => {
    const shape = { issueKey: z.string() };
    const adapted = adaptMcpTool({
      name: 't', description: 'd', inputSchema: z.object(shape),
      handler: async () => 'x',
    });
    expect(Object.keys(adapted.inputSchema)).toEqual(['issueKey']);
  });
});

describe('adaptMcpTool onTool emit (#462 슬라이스4)', () => {
  it('핸들러 호출 직전 tool_use_start, 직후 tool_result 를 같은 seq 로 emit', async () => {
    const lines: import('./sdk-mcp-server.js').ToolUseLine[] = [];
    let seq = 0;
    const adapted = adaptMcpTool(
      { name: 'list_issues', description: 'd', inputSchema: z.object({ a: z.string() }), handler: async () => 'OUT' },
      { onTool: (l) => lines.push(l), nextSeq: () => (seq += 1) },
    );
    const res = await adapted.handler({ a: 'x' }, undefined);
    expect(res).toEqual({ content: [{ type: 'text', text: 'OUT' }] });
    expect(lines).toEqual([
      { seq: 1, event: 'tool_use_start', toolName: 'list_issues', args: { a: 'x' } },
      { seq: 1, event: 'tool_result', toolName: 'list_issues', isError: false, result: 'OUT' },
    ]);
  });

  it('핸들러 throw 시 tool_result isError:true 로 emit + isError CallToolResult', async () => {
    const lines: import('./sdk-mcp-server.js').ToolUseLine[] = [];
    let seq = 0;
    const adapted = adaptMcpTool(
      { name: 't', description: 'd', inputSchema: z.object({}), handler: async () => { throw new Error('boom'); } },
      { onTool: (l) => lines.push(l), nextSeq: () => (seq += 1) },
    );
    const res = await adapted.handler({}, undefined);
    expect(res).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    expect(lines[1]).toEqual({ seq: 1, event: 'tool_result', toolName: 't', isError: true, result: 'boom' });
  });

  it('content 블록 배열(이미지)은 그대로 전달하고 onTool result 에는 base64 대신 요약을 남긴다 (WP-240)', async () => {
    const lines: import('./sdk-mcp-server.js').ToolUseLine[] = [];
    let seq = 0;
    const image = { type: 'image' as const, data: 'A'.repeat(8192), mimeType: 'image/png' };
    const adapted = adaptMcpTool(
      {
        name: 'read_chat_attachment', description: 'd', inputSchema: z.object({}),
        handler: async () => [{ type: 'text' as const, text: '첨부:' }, image],
      },
      { onTool: (l) => lines.push(l), nextSeq: () => (seq += 1) },
    );
    const res = await adapted.handler({}, undefined);
    expect(res).toEqual({ content: [{ type: 'text', text: '첨부:' }, image] });
    expect(lines[1]).toEqual({
      seq: 1, event: 'tool_result', toolName: 'read_chat_attachment', isError: false, result: '첨부:\n[image/png 6KB]',
    });
  });

  it('공유 도구(SharedTool)가 돌려준 이미지도 같은 경로로 전달되고 onTool result 에 base64 가 새지 않는다 (WP-345)', async () => {
    const lines: import('./sdk-mcp-server.js').ToolUseLine[] = [];
    let seq = 0;
    const image = { type: 'image' as const, data: 'A'.repeat(8192), mimeType: 'image/png' };
    const shared: SharedTool = {
      name: 'fake_shared_image', description: 'd', inputSchema: z.object({}), kind: 'read',
      handler: async () => [{ type: 'text', text: '첨부:' }, image],
    };
    // tools.ts 의 sharedTool() 이 하는 것과 같다 — 핸들러는 그대로 두고 annotations 만 얹는다.
    const adapted = adaptMcpTool({ ...shared, annotations: toolAnnotations(shared) }, { onTool: (l) => lines.push(l), nextSeq: () => (seq += 1) });
    const res = await adapted.handler({}, undefined);
    expect(res).toEqual({ content: [{ type: 'text', text: '첨부:' }, image] });
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain('AAAA');
    expect(lines[1]).toMatchObject({ event: 'tool_result', result: '첨부:\n[image/png 6KB]' });
  });

  it('ctx 없으면 onTool emit 없이 기존 동작(하위호환)', async () => {
    const adapted = adaptMcpTool({ name: 't', description: 'd', inputSchema: z.object({}), handler: async () => 'x' });
    expect(await adapted.handler({}, undefined)).toEqual({ content: [{ type: 'text', text: 'x' }] });
  });
});

describe('buildInProcessWorkplaceMcpServer', () => {
  it('컨텍스트를 buildTools 로 전달하고 server 명 workplace 로 createSdkMcpServer 호출', () => {
    const client = {} as WorkplaceApiClient;
    const threadBinding = { channelId: 5, parentMessageId: 9 };
    const delegationContext = { actorId: 7, channelId: 5, parentMessageId: 9 };
    const server = buildInProcessWorkplaceMcpServer({
      client, onBehalfOfId: 99, profile: 'messaging', threadBinding, delegationContext,
    });
    expect(buildTools).toHaveBeenCalledWith(client, 99, 'messaging', threadBinding, delegationContext, undefined, undefined, undefined);
    // lastCall: 테스트 순서·다른 호출에 영향받지 않게 마지막 호출 인자로 단언.
    const opts = vi.mocked(createSdkMcpServer).mock.lastCall![0] as { name: string; tools: unknown[] };
    expect(opts.name).toBe('workplace');
    expect(opts.tools).toHaveLength(1);
    expect((server as { name: string }).name).toBe('workplace');
  });

  it('hostBridge 를 buildTools 6번째 인자로 전달', () => {
    const client = {} as WorkplaceApiClient;
    const hostBridge = { onProposal: () => {}, onSubmitResponse: () => {}, onUnassignResult: () => {} };
    buildInProcessWorkplaceMcpServer({ client, onBehalfOfId: 1, profile: 'assistant', hostBridge });
    expect(buildTools).toHaveBeenCalledWith(client, 1, 'assistant', undefined, undefined, hostBridge, undefined, undefined);
  });

  // WP-244: chat 프로필 실행 스레드 바인딩은 7번째 인자.
  it('chatThreadId 를 buildTools 7번째 인자로 전달', () => {
    const client = {} as WorkplaceApiClient;
    buildInProcessWorkplaceMcpServer({ client, onBehalfOfId: 1, profile: 'chat', chatThreadId: 17 });
    expect(buildTools).toHaveBeenCalledWith(client, 1, 'chat', undefined, undefined, undefined, 17, undefined);
  });

  // WP-234: 메인 AI 채팅 세션 바인딩은 8번째 인자.
  it('homeSessionId 를 buildTools 8번째 인자로 전달', () => {
    const client = {} as WorkplaceApiClient;
    const sid = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';
    buildInProcessWorkplaceMcpServer({ client, onBehalfOfId: 1, profile: 'assistant', homeSessionId: sid });
    expect(buildTools).toHaveBeenCalledWith(client, 1, 'assistant', undefined, undefined, undefined, undefined, sid);
  });
});
