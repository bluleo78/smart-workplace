// envelope → AGENT id 결정 → token fetch → 인-프로세스 SDK 실행(#462 슬라이스5).
// 이 앱의 마지막 CLI 의존 기능 경로를 sdk-runner + 인-프로세스 MCP 로 전환. 모든 호출에 agentId 명시.
import { SYSTEM_PROMPT } from './system-prompt.js';
import { buildUserMessage } from './user-message.js';
import { runnerFor } from './agent-runner.js';
import { pickActingAgentId } from './agent-resolver.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { ProviderCredential } from './agent-runner.js';

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;

export interface RunAgentDeps {
  client: WorkplaceApiClient;
}

export async function runAgent(
  envelope: IssueEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  const agentId = pickActingAgentId(envelope);
  if (agentId == null) {
    console.warn('[run-agent] assignees 에 AGENT 없음 — 실행 생략', {
      type: envelope.type,
      issueKey: envelope.payload.issueKey,
    });
    return;
  }

  let credential: ProviderCredential;
  try {
    credential = await deps.client.getProviderCredential(agentId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[run-agent] provider credential fetch 실패 — 실행 생략', {
      type: envelope.type,
      issueKey: envelope.payload.issueKey,
      agentId,
      error: msg,
    });
    return;
  }

  // 모델 결정 이원화 해소: 이벤트 경로는 요청 body 가 없어 redeem 응답(assistant_config.model)을
  // env/기본값보다 우선한다.
  const model = credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  const userMessage = buildUserMessage(envelope);
  const logTag = `agent:${envelope.type}:${envelope.payload.issueKey}:${agentId}`;

  // fire-and-forget — 델타 미소비. collect 가 완료까지 순회하고 timeout/result.is_error 시 throw →
  // event-handler 의 .catch 가 로깅(현행 CLI 와 동일한 실패 처리).
  // 이슈 이벤트는 항상 담당 AGENT 자격으로 실행(#34) — onBehalfOfId = agentId, userId 없음.
  // 'issue' 프로필 도구 6종(읽기 3 + add_comment/update_status/unassign_self). hostBridge 미전달 시
  // unassign_self 는 API 직접 호출 후 결과 반환(현행 CLI 동작과 동일). MCP 구성은 러너 내부에서.
  await runnerFor(credential).collect({
    userMessage,
    systemPrompt: SYSTEM_PROMPT,
    model,
    maxTurns,
    credential,
    agentId,
    timeoutMs,
    logTag,
    mcp: { client: deps.client, onBehalfOfId: agentId, profile: 'issue' },
  });
}
