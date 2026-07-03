// Claude Agent SDK 러너 — AgentRunner 계약을 기존 sdk-runner.ts(runSdkStream/runSdkCollect) 로 구현한다.
// 내부 SDKMessage(JSON 라인)는 mapSdkMessage(Task 4)로 provider-neutral RunnerEvent 로 변환해 흘린다.
import type { AgentDefinition, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner, ProviderCredential, RunnerInput, RunnerStreamHandle } from './agent-runner.js';
import type { SdkRunInput } from './sdk-runner.js';
import { runSdkCollect, runSdkStream } from './sdk-runner.js';
import { buildInProcessWorkplaceMcpServer } from './sdk-mcp-server.js';
import { loadSubagents, toAgentDefinitions } from './subagent-loader.js';
import { mapSdkMessage, type RunnerEvent } from './runner-events.js';

// credential 이 anthropic 이 아니면 이 러너를 쓸 수 없음(팩토리가 보장하지만 방어적으로 재확인).
function requireAnthropicToken(credential: ProviderCredential): string {
  if (credential.provider !== 'anthropic') {
    throw new Error('ClaudeSdkRunner 는 anthropic credential 만 지원합니다');
  }
  return credential.token;
}

// RunnerInput → SdkRunInput. mcp/서브에이전트는 지정된 경우에만 러너 내부에서 구성한다
// (기존 buildInProcessWorkplaceMcpServer/loadSubagents+toAgentDefinitions 재사용 — 로직 중복 없음).
function toSdkRunInput(i: RunnerInput): SdkRunInput {
  let mcpServers: Record<string, McpServerConfig> | undefined;
  if (i.mcp) {
    const workplace = buildInProcessWorkplaceMcpServer({
      client: i.mcp.client,
      onBehalfOfId: i.mcp.onBehalfOfId,
      profile: i.mcp.profile,
      threadBinding: i.mcp.threadBinding,
      delegationContext: i.mcp.delegationContext,
      hostBridge: i.mcp.hostBridge,
      onTool: i.mcp.onTool,
    });
    mcpServers = { workplace };
  }

  let agents: Record<string, AgentDefinition> | undefined;
  if (i.allowSubagents) {
    agents = toAgentDefinitions(loadSubagents());
  }

  return {
    userMessage: i.userMessage,
    systemPrompt: i.systemPrompt,
    model: i.model,
    maxTurns: i.maxTurns,
    token: requireAnthropicToken(i.credential),
    agentId: i.agentId,
    userId: i.userId,
    timeoutMs: i.timeoutMs,
    logTag: i.logTag,
    requestId: i.requestId,
    includePartialMessages: i.includePartialMessages,
    allowFileRead: i.allowFileRead,
    allowSubagents: i.allowSubagents,
    cwd: i.cwd,
    mcpServers,
    agents,
  };
}

export class ClaudeSdkRunner implements AgentRunner {
  // 스트리밍: 기존 runSdkStream 의 onLine(문자열) 을 JSON.parse → mapSdkMessage 로 변환해 onEvent 에 흘린다.
  stream(i: RunnerInput, onEvent: (e: RunnerEvent) => void): RunnerStreamHandle {
    const handle = runSdkStream(toSdkRunInput(i), (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // 비JSON 라인 무시(기존 파서들과 동일 관용)
      }
      for (const ev of mapSdkMessage(parsed)) onEvent(ev);
    });
    return { done: handle.done, kill: handle.kill };
  }

  // collect: runSdkCollect 가 모은 문자열 라인을 전부 mapSdkMessage 로 변환해 RunnerEvent[] 로 반환.
  async collect(i: RunnerInput): Promise<RunnerEvent[]> {
    const lines = await runSdkCollect(toSdkRunInput(i));
    const events: RunnerEvent[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      events.push(...mapSdkMessage(parsed));
    }
    return events;
  }
}
