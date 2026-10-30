// envelope → AGENT id 결정 → token fetch → 인-프로세스 SDK 실행(#462 슬라이스5).
// 이 앱의 마지막 CLI 의존 기능 경로를 sdk-runner + 인-프로세스 MCP 로 전환. 모든 호출에 agentId 명시.
import { SYSTEM_PROMPT } from './system-prompt.js';
import { buildUserMessage } from './user-message.js';
import { withSharedMemory } from './shared-memory-block.js';
import { runnerFor } from './agent-runner.js';
import { pickActingAgentId } from './agent-resolver.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import { resultOk } from './runner-events.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { ProviderCredential } from './agent-runner.js';

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;

// WP-1219: 작업 기록(agent_work)을 남기는 이벤트 — 맡은 일을 하거나(담당 지정·생성) 사람 말에 답하는(코멘트) 실행이다.
// 상태 변경 알림은 대개 「단순 알림이면 무시」로 끝나 기록을 바꾸지 않는다(검토 대기를 작업 중으로 흔들지 않게).
const TRACKED_TYPES: ReadonlySet<IssueEventEnvelope['type']> = new Set([
  'issue.created',
  'issue.assigned',
  'issue.commented',
]);

// 실행이 오류로 끝났을 때·연결 정보를 못 가져왔을 때 사람에게 보이는 사유(작업 기록 note).
const RUN_ERROR_NOTE = 'AI 실행 중 오류가 났습니다';
const CREDENTIAL_ERROR_NOTE = 'AI 의 연결 정보를 가져오지 못했습니다';

type RunReport = Parameters<WorkplaceApiClient['reportAgentRun']>[2];

function reason(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export interface RunAgentDeps {
  client: WorkplaceApiClient;
}

export async function runAgent(
  envelope: IssueEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  const agentId = pickActingAgentId(envelope);
  const { issueId, issueKey } = envelope.payload;

  // WP-1219: 실행의 시작·끝을 API 에 알려 작업 기록을 남긴다 — 서버 AI 는 report_agent_work 를 싣지 않아 이것이 없으면 AI 위임 작업에서 빠진다.
  // 보고 실패는 실행을 막지 않는다(로그만). 끝 보고는 실패 경로(연결 정보·실행 오류·비정상 결과)에서도 꼭 보내 「작업 중」에 남지 않게 한다.
  const tracked = TRACKED_TYPES.has(envelope.type);
  const report = async (body: RunReport) => {
    if (!tracked) return;
    try {
      await deps.client.reportAgentRun(agentId, issueId, body);
    } catch (e) {
      console.error('[run-agent] 실행 보고 실패', {
        issueKey,
        agentId,
        phase: body.phase,
        error: reason(e, String(e)),
      });
    }
  };

  let credential: ProviderCredential;
  try {
    credential = await deps.client.getProviderCredential(agentId);
  } catch (e) {
    console.error('[run-agent] provider credential fetch 실패 — 실행 생략', {
      type: envelope.type,
      issueKey,
      agentId,
      error: reason(e, String(e)),
    });
    await report({ phase: 'FINISHED', ok: false, note: CREDENTIAL_ERROR_NOTE });
    return;
  }

  // 모델 결정 이원화 해소: 이벤트 경로는 요청 body 가 없어 redeem 응답(assistant_config.model)을
  // env/기본값보다 우선한다.
  const model = credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  // WP-386: 공용 메모리(조직 + 그 프로젝트) 블록을 요청문 맨 앞에 — 개인 메모리는 싣지 않는다(WP-381 원칙).
  const userMessage = withSharedMemory(envelope.payload, buildUserMessage(envelope));
  const logTag = `agent:${envelope.type}:${issueKey}:${agentId}`;

  // fire-and-forget — 델타 미소비. collect 가 완료까지 순회하고 timeout/result.is_error 시 throw →
  // 끝 보고(막힘)를 보낸 뒤 다시 던져 event-handler 의 .catch 가 로깅(현행 CLI 와 동일한 실패 처리).
  // 이슈 이벤트는 항상 담당 AGENT 자격으로 실행(#34) — onBehalfOfId = agentId, userId 없음.
  // 'issue' 프로필 도구 14종(읽기 5[get_issue_detail·get_project + 위키 읽기 3] + add_comment/update_comment/
  // create_issue/update_issue(상태 변경 포함)/unassign_self/link_issues/react(코멘트 반응, WP-812)/
  // add_issue_relation/remove_issue_relation(차단 외 관계·외부 링크, WP-887)). hostBridge 미전달 시
  // unassign_self 는 API 직접 호출 후 결과 반환(현행 CLI 동작과 동일). MCP 구성은 러너 내부에서.
  // 시작 보고는 실행과 함께 보낸다(응답을 기다리느라 실행이 늦지 않게). 끝 보고는 finally 한 곳에서 시작 보고 뒤에 보낸다 — 오류로 끝나도
  // 「작업 중」에 남지 않게. 실패 사유는 정해 둔 문구만 싣는다(원시 오류 문구 — 러너 stderr·내부 주소 등 — 는 event-handler 가 로그로 남긴다).
  // 결과가 비정상(ok 아님)이면 사유 없이 보내 API 의 기본 문구(정상적으로 끝나지 않음)를 쓴다.
  const started = report({ phase: 'STARTED', ok: true });
  let finish: RunReport = { phase: 'FINISHED', ok: false, note: RUN_ERROR_NOTE };
  try {
    const events = await runnerFor(credential).collect({
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
    finish = { phase: 'FINISHED', ok: resultOk(events) };
  } finally {
    await started;
    await report(finish);
  }
}
