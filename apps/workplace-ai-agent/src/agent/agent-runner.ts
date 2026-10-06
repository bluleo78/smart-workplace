// 러너 추상화 — Claude Agent SDK / opencode 양쪽을 같은 계약(AgentRunner)으로 감싼다.
// 소비처(run-*.ts)는 provider 별 SDK 를 직접 알 필요 없이 credential 로 runnerFor() 를 통해
// 러너를 얻고 stream/collect 로 RunnerEvent[] 를 받는다(Task 4 의 provider-neutral 이벤트 유니온).
import type { RunnerEvent } from './runner-events.js';
import type { HostBridge, McpProfile } from '../mcp/tools.js';
import type { ToolUseLine } from './sdk-mcp-server.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { OpencodeVision } from './opencode-vision.js';
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
  // WP-241: 이미지 입력 지원 수동 설정 — boolean=전 모델 공통, 객체=모델 id 별. provider `/models` 메타데이터보다 우선.
  vision?: boolean | Record<string, boolean>;
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
  // WP-244: chat 프로필 실행이 답하는 이슈 챗 스레드 — chat 도구가 다른 threadId 를 거부하게 묶는다.
  chatThreadId?: number;
  // WP-234: 메인 AI 채팅 실행의 세션(home_session.id) — assistant 의 read_chat_attachment 가 이 세션 첨부만 읽게 묶는다.
  homeSessionId?: string;
  // WP-259: 요청자의 active-tenant. Claude 경로는 client 가 이미 테넌트 스코프(withOnBehalfOfTenant)라 쓰지 않고,
  // 별도 프로세스인 opencode stdio MCP 가 env 로 받아 자기 클라이언트에 X-On-Behalf-Of-Tenant 를 싣는 데 쓴다.
  onBehalfOfTenantId?: number;
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
  // 첨부 Read 허용. opencode 러너는 cwd(없으면 에이전트 첨부 루트) 안만 읽게 하므로 cwd 는 createAttachmentWorkDir 로 만든다.
  allowFileRead?: boolean;
  allowSubagents?: boolean;
  cwd?: string;
  mcp?: RunnerMcpConfig;
  // opencode 전용: 호출자가 이미 판단한 비전 지원 여부 — 있으면 러너가 다시 판단하지 않고 그대로 써서
  // 프롬프트(첨부 표현)와 config(modalities)가 같은 값을 보게 한다. 없으면 러너가 판단. value undefined = 알 수 없음.
  opencodeVision?: { value: OpencodeVision };
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
