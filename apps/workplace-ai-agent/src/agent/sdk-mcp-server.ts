// 인-프로세스 Workplace MCP 서버(#462 슬라이스 3·4) — CLI 가 stdio child 로 띄우던
// workplace-mcp-server.ts 를 대체한다. buildTools()(단일 진실원천)의 McpTool[] 을
// SDK SdkMcpToolDefinition[] 로 얇게 어댑트해 createSdkMcpServer 로 인-프로세스 등록한다.
// 컨텍스트(onBehalfOf/threadBinding/delegationContext)·호스트 브리지·도구 로깅은 인자로 직접 받는다.
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools, type HostBridge, type McpProfile, type McpTool } from '../mcp/tools.js';

// #462 슬라이스4: 도구 호출 라이브 발행 한 줄. (이전 tool-use-log.ts 에서 이동 — 어댑터가 emit 하는 곳.)
// CLI 의 stdio stream-json 이 못 주던 라이브 tool_use_start 와, 서브에이전트 nested 호출(#449 collapse)을
// 인-프로세스 어댑터 한 곳에서 포착한다.
export interface ToolUseLine {
  seq: number; // 호출마다 부여하는 단조 증가 번호(start/result 매칭용)
  event: 'tool_use_start' | 'tool_result';
  toolName: string;
  args?: Record<string, unknown>; // start 에만
  isError?: boolean; // result 에만
  result?: string; // result 에만(원본 문자열)
}

// 어댑터에 주입하는 도구-로깅 컨텍스트. onTool 과 공유 seq 카운터(서버 인스턴스 스코프).
interface AdaptCtx {
  onTool?: (line: ToolUseLine) => void;
  nextSeq: () => number;
}

// 단일 McpTool → SDK SdkMcpToolDefinition 어댑터.
// - inputSchema: ZodObject → raw shape(.shape). 모든 도구가 z.object(...) 이므로 안전.
// - handler: string 반환 → {content:[{type:'text',text}]}, throw → {isError:true,...}.
// - ctx 있으면 호출 직전/직후 onTool 로 라이브 발행(같은 seq 로 start/result 매칭).
// 반환 제네릭은 SdkMcpToolDefinition<any> — <z.ZodRawShape> 로 좁히면 InferShape 가 never 추론.
// (의도적 any: SDK 타입의 한계로 정확한 shape 제네릭을 줄 수 없음 → 룰 단건 비활성)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adaptMcpTool(t: McpTool, ctx?: AdaptCtx): SdkMcpToolDefinition<any> {
  const shape = (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
  return {
    name: t.name,
    description: t.description,
    inputSchema: shape,
    async handler(args: unknown) {
      const seq = ctx ? ctx.nextSeq() : 0;
      if (ctx?.onTool) {
        ctx.onTool({ seq, event: 'tool_use_start', toolName: t.name, args: args as Record<string, unknown> });
      }
      try {
        const out = await t.handler(args);
        if (ctx?.onTool) ctx.onTool({ seq, event: 'tool_result', toolName: t.name, isError: false, result: out });
        return { content: [{ type: 'text', text: out }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (ctx?.onTool) ctx.onTool({ seq, event: 'tool_result', toolName: t.name, isError: true, result: msg });
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
  // #462 슬라이스4: 호스트 브리지(propose/submit/unassign 콜백)·도구 로깅 콜백.
  hostBridge?: HostBridge;
  onTool?: (line: ToolUseLine) => void;
}): McpSdkServerConfigWithInstance {
  const tools = buildTools(i.client, i.onBehalfOfId, i.profile, i.threadBinding, i.delegationContext, i.hostBridge);
  // 라우터·서브에이전트 호출이 같은 인스턴스를 공유하므로 seq 카운터 1개로 전체 순서 보존.
  let seq = 0;
  const ctx: AdaptCtx = { onTool: i.onTool, nextSeq: () => (seq += 1) };
  return createSdkMcpServer({ name: 'workplace', tools: tools.map((t) => adaptMcpTool(t, ctx)) });
}
