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

  it('inputSchema 를 ZodObject.shape 로 추출', () => {
    const shape = { issueKey: z.string() };
    const adapted = adaptMcpTool({
      name: 't', description: 'd', inputSchema: z.object(shape),
      handler: async () => 'x',
    });
    expect(Object.keys(adapted.inputSchema)).toEqual(['issueKey']);
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
    expect(buildTools).toHaveBeenCalledWith(client, 99, 'messaging', threadBinding, delegationContext);
    // lastCall: 테스트 순서·다른 호출에 영향받지 않게 마지막 호출 인자로 단언.
    const opts = vi.mocked(createSdkMcpServer).mock.lastCall![0] as { name: string; tools: unknown[] };
    expect(opts.name).toBe('workplace');
    expect(opts.tools).toHaveLength(1);
    expect((server as { name: string }).name).toBe('workplace');
  });
});
