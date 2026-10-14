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
import { ImageBudget, toolAnnotations, type SharedTool } from '@smart-workplace/mcp-tools-shared';

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
      name: 'fake_shared_image', description: 'd', inputSchema: z.object({}), app: 'drive', kind: 'read',
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
  // WP-250: Claude 경로는 늘 이미지를 볼 수 있고, 서버 하나가 실행 하나라 실행당 예산을 서버마다 새로 만들어 9번째 인자로 넘긴다.
  const IMAGES = { input: true, budget: expect.any(ImageBudget) };

  it('컨텍스트를 buildTools 로 전달하고 server 명 workplace 로 createSdkMcpServer 호출', () => {
    const client = {} as WorkplaceApiClient;
    const threadBinding = { channelId: 5, parentMessageId: 9 };
    const delegationContext = { actorId: 7, channelId: 5, parentMessageId: 9 };
    const server = buildInProcessWorkplaceMcpServer({
      client, onBehalfOfId: 99, profile: 'messaging', threadBinding, delegationContext,
    });
    expect(buildTools).toHaveBeenCalledWith(client, 99, 'messaging', threadBinding, delegationContext, undefined, undefined, undefined, IMAGES);
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
    expect(buildTools).toHaveBeenCalledWith(client, 1, 'assistant', undefined, undefined, hostBridge, undefined, undefined, IMAGES);
  });

  // WP-244: chat 프로필 실행 스레드 바인딩은 7번째 인자.
  it('chatThreadId 를 buildTools 7번째 인자로 전달', () => {
    const client = {} as WorkplaceApiClient;
    buildInProcessWorkplaceMcpServer({ client, onBehalfOfId: 1, profile: 'chat', chatThreadId: 17 });
    expect(buildTools).toHaveBeenCalledWith(client, 1, 'chat', undefined, undefined, undefined, 17, undefined, IMAGES);
  });

  // WP-234: 메인 AI 채팅 세션 바인딩은 8번째 인자.
  it('homeSessionId 를 buildTools 8번째 인자로 전달', () => {
    const client = {} as WorkplaceApiClient;
    const sid = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';
    buildInProcessWorkplaceMcpServer({ client, onBehalfOfId: 1, profile: 'assistant', homeSessionId: sid });
    expect(buildTools).toHaveBeenCalledWith(client, 1, 'assistant', undefined, undefined, undefined, undefined, sid, IMAGES);
  });
});

// WP-250: 실행당 이미지 상한 — 실제 buildTools 로 만든 서버의 read_file 이 서버(= 실행)마다 하나인 예산을 같이 쓴다.
describe('실행당 이미지 예산 (WP-250)', () => {
  type AdaptedTool = { name: string; handler: (args: unknown, extra: unknown) => Promise<{ content: { type: string; text?: string }[] }> };

  // 실제 buildTools 로 assistant 서버를 만들고, 그 read_file 호출 함수와 쪽 이미지를 돌려주는 viewDriveFile 목을 함께 돌려준다.
  async function serverReadFile() {
    const actual = await vi.importActual<typeof import('../mcp/tools.js')>('../mcp/tools.js');
    vi.mocked(buildTools).mockImplementationOnce(actual.buildTools);
    const viewDriveFile = vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png', pageCount: 40 }));
    const client = { toolClient: () => ({ viewDriveFile }) } as unknown as WorkplaceApiClient;
    buildInProcessWorkplaceMcpServer({ client, onBehalfOfId: 1, profile: 'assistant' });
    const opts = vi.mocked(createSdkMcpServer).mock.lastCall![0] as unknown as { tools: AdaptedTool[] };
    const readFile = opts.tools.find((t) => t.name === 'read_file')!;
    const call = (pages: number[]) => readFile.handler({ source: 'drive', driveFileId: 9, pages }, undefined);
    return { call, viewDriveFile };
  }

  it('3장씩 6번(18장) 본 뒤 7번째 3장 요청은 남은 장수(2장)로 거절하고, 2장을 더 보면 20장째에서 다 썼다는 안내', async () => {
    const { call, viewDriveFile } = await serverReadFile();
    for (let i = 0; i < 6; i++) {
      const res = await call([1, 2, 3]);
      expect(res.content.filter((b) => b.type === 'image'), `${i + 1}번째`).toHaveLength(3);
    }
    const seventh = await call([1, 2, 3]);
    expect(seventh.content).toHaveLength(1);
    expect(seventh.content[0].text).toContain('2장 남았습니다');
    // 예산은 받기 전에 잡으므로 거절된 7번째는 서버에 쪽 이미지를 요청하지 않는다.
    expect(viewDriveFile).toHaveBeenCalledTimes(18);

    // 남은 2장은 그대로 볼 수 있고, 다 쓰면(남은 0장) 실행당 상한을 다 썼다는 안내로 거절한다.
    const eighth = await call([1, 2]);
    expect(eighth.content.filter((b) => b.type === 'image')).toHaveLength(2);
    const ninth = await call([1]);
    expect(ninth.content).toEqual([{ type: 'text', text: '이번 대화에서 볼 수 있는 이미지를 다 썼습니다(20장). 볼 페이지를 좁혀 달라고 사용자에게 요청하세요.' }]);
    expect(viewDriveFile).toHaveBeenCalledTimes(20);
  });

  it('새 서버(= 새 실행)는 예산을 새로 받는다', async () => {
    const first = await serverReadFile();
    for (let i = 0; i < 7; i++) await first.call([1, 2, 3]);
    const second = await serverReadFile();
    const res = await second.call([1, 2, 3]);
    expect(res.content.filter((b) => b.type === 'image')).toHaveLength(3);
  });
});
