#!/usr/bin/env node
// Task8: stdio MCP 엔트리포인트 — opencode 러너(Task9)가 별도 OS 프로세스로 spawn 하는
// `node stdio-entry.js`(또는 tsx). Claude Agent SDK 는 인-프로세스라 sdk-mcp-server.ts 로
// 도구를 등록하지만, opencode 는 별도 프로세스이므로 stdio 로만 도달 가능하다. buildTools()
// (단일 진실원천)를 그대로 재사용하고 @modelcontextprotocol/sdk 의 McpServer/StdioServerTransport
// 로 서빙한다. 서버명은 'workplace' 로 고정 — mcp__workplace__* 네임스페이스 정합(sdk-mcp-server.ts 참고).
//
// 컨텍스트는 env 로 수신한다(ACTING_AGENT_ID/ACTING_USER_ID 와 동일 패턴, sdk-runner.ts 참고).
// hostBridge 가 필요한 프로필(예: messaging L3 위임)은 MCP_BRIDGE_URL/MCP_BRIDGE_RUN_ID 로
// HTTP 콜백 브리지를 구성한다 — POST {MCP_BRIDGE_URL}/{runId} { kind, data }.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createWorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools, type HostBridge, type McpProfile, type McpTool } from './tools.js';

const MCP_PROFILES: readonly McpProfile[] = ['issue', 'chat', 'home', 'messaging', 'assistant'];

export interface StdioEntryConfig {
  baseURL?: string;
  internalToken: string;
  profile: McpProfile;
  onBehalfOfId: number;
  threadBinding?: { channelId: number; parentMessageId: number };
  delegationContext?: { actorId: number; channelId: number; parentMessageId?: number };
  bridgeUrl?: string;
  bridgeRunId?: string;
}

// env → 설정 파싱. 필수 항목 누락/형식 오류 시 throw(호출부에서 stderr 출력 + exit 1 처리).
// process.env 를 직접 참조하지 않고 인자로 받아 테스트 가능하게 한다.
export function parseConfigFromEnv(env: NodeJS.ProcessEnv): StdioEntryConfig {
  const baseURL = env.WORKPLACE_API_BASE_URL;
  if (!baseURL) throw new Error('WORKPLACE_API_BASE_URL 환경변수가 필요합니다.');

  const internalToken = env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) throw new Error('INTERNAL_SERVICE_TOKEN 환경변수가 필요합니다.');

  const profileRaw = env.MCP_PROFILE;
  if (!profileRaw || !MCP_PROFILES.includes(profileRaw as McpProfile)) {
    throw new Error(
      `MCP_PROFILE 환경변수가 올바르지 않습니다(허용값: ${MCP_PROFILES.join(', ')}). 받은 값: ${profileRaw ?? '(없음)'}`,
    );
  }
  const profile = profileRaw as McpProfile;

  const onBehalfOfRaw = env.MCP_ON_BEHALF_OF;
  const onBehalfOfId = Number(onBehalfOfRaw);
  if (!onBehalfOfRaw || !Number.isFinite(onBehalfOfId)) {
    throw new Error(`MCP_ON_BEHALF_OF 환경변수가 필요합니다(숫자). 받은 값: ${onBehalfOfRaw ?? '(없음)'}`);
  }

  let threadBinding: StdioEntryConfig['threadBinding'];
  if (env.MCP_THREAD_BINDING) {
    try {
      threadBinding = JSON.parse(env.MCP_THREAD_BINDING);
    } catch {
      throw new Error('MCP_THREAD_BINDING 이 올바른 JSON 이 아닙니다.');
    }
  }

  let delegationContext: StdioEntryConfig['delegationContext'];
  if (env.MCP_DELEGATION_CONTEXT) {
    try {
      delegationContext = JSON.parse(env.MCP_DELEGATION_CONTEXT);
    } catch {
      throw new Error('MCP_DELEGATION_CONTEXT 이 올바른 JSON 이 아닙니다.');
    }
  }

  return {
    baseURL,
    internalToken,
    profile,
    onBehalfOfId,
    threadBinding,
    delegationContext,
    bridgeUrl: env.MCP_BRIDGE_URL,
    bridgeRunId: env.MCP_BRIDGE_RUN_ID,
  };
}

// HTTP 콜백 브리지 — POST {bridgeUrl}/{runId} { kind, data }. 실패는 stderr 로 로깅하고
// 도구 호출 자체를 막지 않는다(fire-and-forget, 폴백 없음 — Task9 가 콜백 도달을 재시도/타임아웃 처리).
async function postBridge(
  bridgeUrl: string,
  runId: string,
  internalToken: string,
  kind: 'proposal' | 'submit_response' | 'unassign',
  data: unknown,
): Promise<void> {
  try {
    const res = await fetch(`${bridgeUrl}/${runId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Internal ${internalToken}`,
      },
      body: JSON.stringify({ kind, data }),
    });
    if (!res.ok) {
      console.error(`[stdio-entry] bridge 콜백 실패(${kind}): HTTP ${res.status}`);
    }
  } catch (e) {
    console.error(`[stdio-entry] bridge 콜백 실패(${kind}):`, e instanceof Error ? e.message : String(e));
  }
}

export function buildHostBridge(bridgeUrl: string, runId: string, internalToken: string): HostBridge {
  return {
    onProposal(p) {
      void postBridge(bridgeUrl, runId, internalToken, 'proposal', p);
    },
    onSubmitResponse(text) {
      void postBridge(bridgeUrl, runId, internalToken, 'submit_response', text);
    },
    onUnassignResult(r) {
      void postBridge(bridgeUrl, runId, internalToken, 'unassign', r);
    },
  };
}

// 단일 McpTool → McpServer.registerTool 등록. inputSchema 는 항상 z.object(...) 이므로 .shape 사용
// (sdk-mcp-server.ts 의 adaptMcpTool 과 동일 전제).
function registerStdioTool(server: McpServer, t: McpTool): void {
  const shape = (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
  server.registerTool(
    t.name,
    { description: t.description, inputSchema: shape },
    async (args: unknown) => {
      try {
        const out = await t.handler(args);
        return { content: [{ type: 'text' as const, text: out }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: 'text' as const, text: msg }] };
      }
    },
  );
}

async function main(): Promise<void> {
  const config = parseConfigFromEnv(process.env);

  const client = createWorkplaceApiClient({
    baseURL: config.baseURL,
    internalToken: config.internalToken,
  });

  const hostBridge =
    config.bridgeUrl && config.bridgeRunId
      ? buildHostBridge(config.bridgeUrl, config.bridgeRunId, config.internalToken)
      : undefined;

  const tools = buildTools(
    client,
    config.onBehalfOfId,
    config.profile,
    config.threadBinding,
    config.delegationContext,
    hostBridge,
  );

  // 서버명 'workplace' 고정 — mcp__workplace__* 네임스페이스 정합(sdk-mcp-server.ts 참고).
  const server = new McpServer({ name: 'workplace', version: '1.0.0' });
  for (const t of tools) registerStdioTool(server, t);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// 이 파일이 직접 실행될 때만 부트한다(테스트에서 import 시 자동 실행 방지).
// import.meta.url 이 process.argv[1] 과 일치하면 CLI 진입점으로 간주.
const isMain = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((e: unknown) => {
    console.error('[stdio-entry] 부트 실패:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
