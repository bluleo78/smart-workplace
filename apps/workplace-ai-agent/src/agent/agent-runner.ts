// 러너 추상화 — Claude Agent SDK / opencode 양쪽을 같은 계약(AgentRunner)으로 감싼다.
// 소비처(run-*.ts)는 provider 별 SDK 를 직접 알 필요 없이 credential 로 runnerFor() 를 통해
// 러너를 얻고 stream/collect 로 RunnerEvent[] 를 받는다(Task 4 의 provider-neutral 이벤트 유니온).
import type { RunnerEvent } from './runner-events.js';
import type { HostBridge, McpProfile } from '../mcp/tools.js';
import type { ToolUseLine } from './sdk-mcp-server.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { ClaudeSdkRunner } from './claude-sdk-runner.js';
import { OpencodeRunner } from './opencode-runner.js';

// LLM 공급자 자격증명. anthropic=구독 OAuth 토큰, opencode=공급자별 설정 블록(Task 9).
export type ProviderCredential =
  | { provider: 'anthropic'; token: string; model: string | null }
  | { provider: 'opencode'; payload: OpencodeProviderConfig; model: string | null };

export interface OpencodeProviderConfig {
  providerId: string;
  npm?: string;
  options: Record<string, unknown>;
}

// 러너가 자기 방식(인-프로세스/stdio)으로 MCP 도구를 구성하는 데 필요한 입력.
// client 는 buildInProcessWorkplaceMcpServer 가 요구하는 workplace-api 호출 클라이언트.
export interface RunnerMcpConfig {
  client: WorkplaceApiClient;
  profile: McpProfile;
  onBehalfOfId: number;
  threadBinding?: { channelId: number; parentMessageId: number };
  delegationContext?: { actorId: number; channelId: number; parentMessageId?: number };
  hostBridge?: HostBridge;
  onTool?: (line: ToolUseLine) => void;
}

export interface RunnerInput {
  userMessage: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  credential: ProviderCredential;
  agentId: number;
  userId?: number;
  timeoutMs: number;
  logTag: string;
  requestId?: string;
  includePartialMessages?: boolean;
  allowFileRead?: boolean;
  allowSubagents?: boolean;
  cwd?: string;
  mcp?: RunnerMcpConfig;
}

export interface RunnerStreamHandle {
  done: Promise<void>;
  kill: () => void;
}

export interface AgentRunner {
  stream(i: RunnerInput, onEvent: (e: RunnerEvent) => void): RunnerStreamHandle;
  collect(i: RunnerInput): Promise<RunnerEvent[]>;
}

// credential.provider 로 러너 구현체 분기. 두 러너 모두 상태 없는 얇은 어댑터라 매 호출 새
// 인스턴스라도 무해하나, 재사용을 위해 캐시.
let claudeRunner: AgentRunner | undefined;
let opencodeRunner: AgentRunner | undefined;
export function runnerFor(credential: ProviderCredential): AgentRunner {
  if (credential.provider === 'anthropic') {
    if (!claudeRunner) claudeRunner = new ClaudeSdkRunner();
    return claudeRunner;
  }
  if (!opencodeRunner) opencodeRunner = new OpencodeRunner();
  return opencodeRunner;
}
