// Workplace MCP server — Claude CLI 가 stdio child 로 띄우는 entry point.
// #34: INTERNAL_SERVICE_TOKEN + ACTING_AGENT_ID env 로부터 agentId 를 받아 closure 바인딩.
// #376: ACTING_USER_ID 가 설정된 경우(홈 compose 흐름) 해당 userId 를 X-On-Behalf-Of 로 우선 사용.
//       이슈 채팅 이벤트 흐름은 ACTING_USER_ID 없이 ACTING_AGENT_ID 만 설정 — 기존 동작 유지.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { createWorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools } from './tools.js';
import { appendToolUse } from '../agent/tool-use-log.js';

async function main(): Promise<void> {
  const baseURL = process.env.WORKPLACE_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const actingAgentIdRaw = process.env.ACTING_AGENT_ID;
  const actingAgentId = Number(actingAgentIdRaw);

  if (!baseURL || !internalToken || !Number.isFinite(actingAgentId)) {
    console.error('[workplace-mcp] 환경변수 누락 또는 ACTING_AGENT_ID 형식 오류', {
      hasBaseURL: !!baseURL,
      hasInternalToken: !!internalToken,
      actingAgentIdRaw,
    });
    process.exit(1);
  }

  // #376: ACTING_USER_ID 가 있으면(홈 compose 요청) 해당 userId 를 X-On-Behalf-Of 기준으로 사용.
  // 이슈 채팅 이벤트 흐름은 ACTING_USER_ID 를 설정하지 않으므로 ACTING_AGENT_ID 로 폴백 — 기존 동작 유지.
  const actingUserIdRaw = process.env.ACTING_USER_ID;
  const actingUserId = actingUserIdRaw !== undefined ? Number(actingUserIdRaw) : NaN;
  const onBehalfOfId = Number.isFinite(actingUserId) ? actingUserId : actingAgentId;

  const client = createWorkplaceApiClient({ baseURL, internalToken });
  // 6c/7b/7(messaging): WORKPLACE_MCP_PROFILE 로 도구셋 결정.
  const raw = process.env.WORKPLACE_MCP_PROFILE;
  const profile = raw === 'chat' || raw === 'home' || raw === 'messaging' || raw === 'assistant' ? raw : 'issue';
  // onBehalfOfId: 도구 호출 시 X-On-Behalf-Of 에 사용할 ID.
  //   홈 compose → ACTING_USER_ID(요청자) 우선, 미설정(이슈 채팅) → ACTING_AGENT_ID 폴백.
  // 스레드 mirror: 트리거가 스레드 안이면 백엔드가 두 env 를 주입 — add_channel_message 의 parent 바인딩.
  const triggerChannelId = Number(process.env.WORKPLACE_TRIGGER_CHANNEL_ID);
  const triggerThreadParentId = Number(process.env.WORKPLACE_TRIGGER_THREAD_PARENT_ID);
  const threadBinding =
    Number.isFinite(triggerChannelId) && Number.isFinite(triggerThreadParentId)
      ? { channelId: triggerChannelId, parentMessageId: triggerThreadParentId }
      : undefined;
  // 위임(L3): 트리거 actor(위임자)+channelId 가 유효하면 propose_create_issue 가 쓸 컨텍스트 구성.
  const triggerActorId = Number(process.env.WORKPLACE_TRIGGER_ACTOR_ID);
  const delegationContext =
    Number.isFinite(triggerActorId) && Number.isFinite(triggerChannelId)
      ? {
          actorId: triggerActorId,
          channelId: triggerChannelId,
          parentMessageId: Number.isFinite(triggerThreadParentId) ? triggerThreadParentId : undefined,
        }
      : undefined;
  const tools = buildTools(client, onBehalfOfId, profile, threadBinding, delegationContext);

  const server = new Server(
    { name: 'workplace', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const out = {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: z.toJSONSchema(t.inputSchema) as never,
      })),
    };
    console.error(
      '[workplace-mcp] listTools →',
      JSON.stringify(out.tools.map((t) => ({ name: t.name, schema: t.inputSchema }))),
    );
    return out;
  });

  let toolSeq = 0; // 도구 호출 순번(start/result 매칭) — 단일 프로세스라 동기 증가 안전
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const seq = ++toolSeq;
    const toolName = req.params.name;
    console.error('[workplace-mcp] callTool:', toolName);
    // 도구 시작 기록 — 사이드카 활성 시에만(헬퍼가 no-op 가드)
    appendToolUse({ seq, event: 'tool_use_start', toolName, args: req.params.arguments ?? {} });
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      appendToolUse({ seq, event: 'tool_result', toolName, isError: true, result: 'unknown tool' });
      return { isError: true, content: [{ type: 'text', text: `unknown tool: ${toolName}` }] };
    }
    try {
      const out = await tool.handler(req.params.arguments ?? {});
      appendToolUse({ seq, event: 'tool_result', toolName, isError: false, result: out });
      return { content: [{ type: 'text', text: out }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendToolUse({ seq, event: 'tool_result', toolName, isError: true, result: msg });
      return { isError: true, content: [{ type: 'text', text: msg }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    '[workplace-mcp] connected via stdio (agentId:', actingAgentId,
    ', onBehalfOfId:', onBehalfOfId, ')',
  );
}

main().catch((e) => {
  console.error('[workplace-mcp] fatal:', e);
  process.exit(1);
});
