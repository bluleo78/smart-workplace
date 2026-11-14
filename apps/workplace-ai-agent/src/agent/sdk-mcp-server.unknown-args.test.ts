// src/agent/sdk-mcp-server.unknown-args.test.ts — 모르는 인자 이름 거절(WP-1568)을 실제 SDK 서버 경로로 확인한다.
// sdk-mcp-server.test.ts 는 SDK 를 가짜로 바꾸므로, 여기서는 진짜 createSdkMcpServer 인스턴스에 MCP 클라이언트를 붙여 왕복한다 —
// SDK 의 입력 검증을 거친 뒤에도 모르는 키가 핸들러까지 오는지, 모델에 보이는 tools/list 가 전과 같은지가 SDK 동작에 달려 있어서다.
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildSharedTools, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools, type McpProfile, type McpTool } from '../mcp/tools.js';
import { adaptMcpTool, buildInProcessWorkplaceMcpServer, type ToolUseLine } from './sdk-mcp-server.js';

/** SDK 서버 인스턴스에 메모리 전송으로 MCP 클라이언트를 붙인다(CLI 가 인-프로세스 서버와 주고받는 JSON-RPC 와 같은 요청). */
async function connect(config: McpSdkServerConfigWithInstance): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await config.instance.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.1' });
  await client.connect(clientT);
  return client;
}

// 공유 create_issue 의 입력 스키마를 그대로 쓰고 핸들러만 가짜로 둔다(API 호출 여부 = 핸들러 호출 여부).
const sharedCreateIssue = buildSharedTools({} as unknown as SharedToolClient).find((t) => t.name === 'create_issue')!;

describe('adaptMcpTool — 모르는 인자 이름 (WP-1568)', () => {
  async function serverWith(tool: McpTool, onTool?: (l: ToolUseLine) => void) {
    let seq = 0;
    const config = createSdkMcpServer({ name: 'workplace', tools: [adaptMcpTool(tool, { onTool, nextSeq: () => (seq += 1) })] });
    return connect(config);
  }

  it('create_issue 에 description·parentKey 를 보내면 핸들러를 부르지 않고 isError 와 쓸 수 있는 인자를 돌려준다', async () => {
    const handler = vi.fn(async () => '{"ok":true}');
    const lines: ToolUseLine[] = [];
    const client = await serverWith({ ...sharedCreateIssue, handler }, (l) => lines.push(l));
    try {
      const res = await client.callTool({
        name: 'create_issue',
        arguments: { projectKey: 'WP', title: 't', description: '본문', parentKey: 'WP-9' },
      });
      expect(res.isError).toBe(true);
      const text = (res.content as { text: string }[])[0].text;
      expect(text).toMatch(/^알 수 없는 인자: description, parentKey — 쓸 수 있는 인자: projectKey, title, /);
      expect(text).toContain('parent');
      expect(handler).not.toHaveBeenCalled();
      // 실행 기록(도구 줄)에도 오류로 남는다.
      expect(lines.map((l) => [l.event, l.isError])).toEqual([['tool_use_start', undefined], ['tool_result', true]]);
    } finally {
      await client.close();
    }
  });

  it('아는 인자만 보내면(null 포함) 그 값 그대로 핸들러가 실행된다', async () => {
    const handler = vi.fn(async () => 'ok');
    const client = await serverWith({ ...sharedCreateIssue, handler });
    try {
      const res = await client.callTool({ name: 'create_issue', arguments: { projectKey: 'WP', title: 't', body: '본문' } });
      expect(res.isError).toBeFalsy();
      expect(handler).toHaveBeenCalledWith({ projectKey: 'WP', title: 't', body: '본문' });
    } finally {
      await client.close();
    }
    // 공유 read_file 은 쓰지 않는 입력을 null 로 받는다(WP-346) — 아는 이름의 null 은 막지 않는다.
    const readFile = buildSharedTools({} as unknown as SharedToolClient).find((t) => t.name === 'read_file')!;
    const readHandler = vi.fn(async () => 'ok');
    const client2 = await serverWith({ ...readFile, handler: readHandler });
    try {
      const args = { source: 'drive', driveFileId: 9, issueKey: null, attachmentId: null, offset: null, limit: null };
      const res = await client2.callTool({ name: 'read_file', arguments: args });
      expect(res.isError).toBeFalsy();
      expect(readHandler).toHaveBeenCalledWith(args);
    } finally {
      await client2.close();
    }
  });
});

// 모델은 SDK 서버의 tools/list 로 도구 입력 스키마를 본다. 전에는 shape 를 넘겼으므로, 프로필마다 shape 로 만든 서버의 목록과 같아야
// 모델에 보이는 정의(토큰 포함)가 바뀌지 않은 것이다 — 특히 .loose() 가 더하는 additionalProperties 가 새지 않는지.
describe('모델에 보이는 도구 정의는 shape 를 넘기던 때와 같다 (WP-1568)', () => {
  const profiles: McpProfile[] = ['issue', 'chat', 'home', 'messaging', 'assistant', 'recurring', 'recurring-test'];
  // 도구 구성 시점에는 API 를 부르지 않는다 — 공유 도구 클라이언트 생성만 받아 준다.
  const client = { toolClient: () => ({}) } as unknown as WorkplaceApiClient;
  const ctx = {
    threadBinding: { channelId: 1, parentMessageId: 2 },
    delegationContext: { actorId: 1, channelId: 1, parentMessageId: 2 },
    chatThreadId: 3,
    homeSessionId: 'sess',
  };

  /** 전송과 같은 JSON 직렬화(undefined 키는 빠진다)로 비교한다. */
  async function listed(config: McpSdkServerConfigWithInstance): Promise<unknown> {
    const c = await connect(config);
    try {
      return JSON.parse(JSON.stringify((await c.listTools()).tools));
    } finally {
      await c.close();
    }
  }

  it.each(profiles)('%s 프로필', async (profile) => {
    const now = buildInProcessWorkplaceMcpServer({ client, onBehalfOfId: 1, profile, ...ctx });
    const tools = buildTools(client, 1, profile, ctx.threadBinding, ctx.delegationContext, undefined, ctx.chatThreadId, ctx.homeSessionId, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 예전 어댑터 그대로(shape 를 넘김)
    const before: SdkMcpToolDefinition<any>[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape,
      annotations: t.annotations,
      handler: async () => ({ content: [] }),
    }));
    const expected = await listed(createSdkMcpServer({ name: 'workplace', tools: before }));
    const actual = await listed(now);
    expect(actual).toEqual(expected);
    // 최상위 입력 객체에 .loose() 의 additionalProperties 가 붙지 않았다(값 안의 z.record 는 원래부터 additionalProperties 를 쓴다).
    for (const t of actual as { name: string; inputSchema: object }[]) expect(t.inputSchema, t.name).not.toHaveProperty('additionalProperties');
  });
});
