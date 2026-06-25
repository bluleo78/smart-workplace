// 인-프로세스 Workplace MCP 서버(#462 슬라이스 3) — CLI 가 stdio child 로 띄우던
// workplace-mcp-server.ts 를 대체한다. buildTools()(단일 진실원천)의 McpTool[] 을
// SDK SdkMcpToolDefinition[] 로 얇게 어댑트해 createSdkMcpServer 로 인-프로세스 등록한다.
// 컨텍스트(onBehalfOf/threadBinding/delegationContext)는 env 플러밍이 아닌 인자로 직접 받는다.
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools, type McpProfile, type McpTool } from '../mcp/tools.js';

// 단일 McpTool → SDK SdkMcpToolDefinition 어댑터.
// - inputSchema: ZodObject → raw shape(.shape). 모든 도구가 z.object(...) 이므로 안전.
// - handler: string 반환 → {content:[{type:'text',text}]}, throw → {isError:true,...}.
//   (workplace-mcp-server.ts L95-103 의 try/catch 래핑 미러.)
// 반환 제네릭은 SdkMcpToolDefinition<any> — createSdkMcpServer 의 tools 파라미터
// (Array<SdkMcpToolDefinition<any>>) 와 정확히 매치한다. <z.ZodRawShape> 로 좁히면
// InferShape<ZodRawShape> 가 값 타입을 never 로 추론해 핸들러 인자가 막히므로 widen 한다.
export function adaptMcpTool(t: McpTool): SdkMcpToolDefinition<any> {
  const shape = (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
  return {
    name: t.name,
    description: t.description,
    inputSchema: shape,
    async handler(args: unknown) {
      try {
        const out = await t.handler(args);
        return { content: [{ type: 'text', text: out }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  };
}

// 프로필별 인-프로세스 MCP 서버 생성. 서버명은 반드시 'workplace'
// (도구 네임스페이스 mcp__workplace__* → allowlist·stripMcpPrefix 와 매치).
export function buildInProcessWorkplaceMcpServer(i: {
  client: WorkplaceApiClient;
  onBehalfOfId: number;
  profile: McpProfile;
  threadBinding?: { channelId: number; parentMessageId: number };
  delegationContext?: { actorId: number; channelId: number; parentMessageId?: number };
}): McpSdkServerConfigWithInstance {
  const tools = buildTools(i.client, i.onBehalfOfId, i.profile, i.threadBinding, i.delegationContext);
  return createSdkMcpServer({ name: 'workplace', tools: tools.map(adaptMcpTool) });
}
