// WP-989: 반복 개인 작업의 회차 실행 — issue.recurring_run 이벤트를 받아 반복에 등록된 비서(actingAgentId)의 LLM 자격으로,
// 도구는 등록한 사람(ownerUserId, 홈 AI 채팅과 같은 대행) 권한의 읽기 전용으로 실행을 돌리고,
// 최종 답변을 API 내부 보고(POST /internal/issue-recurrence/{issueId}/runs)로 돌려준다. 회차 실행은 쓰기 도구가 없어(이슈 챗에
// 직접 글을 쓸 수 없다) 결과 글은 API 가 그 AI 이름으로 대신 남긴다. 실패도 사유와 함께 보고해야 API 가 연속 실패를 세고 작업 상태를 되돌린다.
import axios from 'axios';
import { RECURRING_RUN_SYSTEM_PROMPT } from './system-prompt.js';
import { buildRecurringRunMessage } from './user-message.js';
import { defaultSleep } from './sleep.js';
import { withSharedMemory } from './shared-memory-block.js';
import { runnerFor, type ProviderCredential } from './agent-runner.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import { finalText, resultOk } from './runner-events.js';
import type { IssueRecurringRunPayload } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;

// 보고 글 길이 상한 — API 가 챗 글 한도(4000자)로 다시 자르므로 여기서는 전송량만 묶는다.
const REPORT_MAX_CHARS = 8000;

// 결과 보고를 다시 보내기 전 기다림(WP-1118) — 처음 보낸 뒤 실패하면 이 간격으로 다시 보낸다(합 약 4분, 최대 7번). API 재시작·롤링
// 배포(수십 초)를 넘기고, 결과 대기 시간 초과(30분)보다는 훨씬 짧다. 같은 runId 를 다시 보내도 API 가 한 번만 반영한다(멱등).
export const REPORT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000];
// 간격마다 더하는 흔들림 비율 — 같은 장애에 실패한 여러 회차가 같은 순간 몰려 다시 보내지 않게 한다.
const RETRY_JITTER = 0.2;

export interface RunRecurringDeps {
  client: WorkplaceApiClient;
  /** 결과 보고 재시도 대기 — 테스트가 실제로 기다리지 않게 바꾼다(run-ai-chat 의 deps.sleep 과 같은 방식). */
  sleep?: (ms: number) => Promise<void>;
  /** 흔들림에 쓸 난수(0 이상 1 미만) — 테스트가 고정한다. */
  random?: () => number;
}

// 다시 보내면 나을 수 있는 실패인가 — 응답 없이 끝난 요청(연결 끊김·거절·시간 초과)이거나 5xx·408·429. 그 밖의 4xx(권한·잘못된
// 요청)와 axios 가 아닌 오류(코드 결함)는 다시 보내도 같다.
function isTransient(e: unknown): boolean {
  if (!axios.isAxiosError(e)) return false;
  const status = e.response?.status;
  return status == null || status >= 500 || status === 408 || status === 429;
}

// 사유 문구를 한 줄·짧게 — 이슈 챗에 「이번 회차를 실행하지 못했습니다: <사유>」로 그대로 보인다.
function reason(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const line = msg.split('\n')[0]?.trim() ?? '';
  return line ? line.slice(0, 300) : fallback;
}

export async function runRecurring(p: IssueRecurringRunPayload, deps: RunRecurringDeps): Promise<void> {
  const agentId = p.actingAgentId;
  const ownerId = p.ownerUserId;
  const logTag = `agent:issue.recurring_run:${p.issueKey}:${agentId}`;
  // 테넌트가 오면 X-On-Behalf-Of-Tenant 를 싣는 스코프 클라이언트로 — 소유자 대행 도구 호출과 결과 보고가 이 테넌트로만 간다(run-ai-chat 과 같은 규칙).
  // LLM 자격 조회는 비서 전역 계정이라 스코프 없이(run-ai-chat 과 같다).
  const scoped = p.tenantId != null ? deps.client.withOnBehalfOfTenant(p.tenantId) : deps.client;

  // 결과 보고 — 일시 오류면 짧게 쉬며 다시 보낸다(WP-1118). 한 번만 보내면 API 재시작·네트워크 끊김에 결과가 사라져, 성공한 회차가 30분 뒤
  // 「결과를 받지 못했습니다」 실패로 세졌다. 끝내 실패해도 던지지 않는다 — 그때는 API 의 결과 대기 시간 초과가 실패로 센다.
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const report = async (ok: boolean, message: string) => {
    const body = { runId: p.runId, ok, message: message.slice(0, REPORT_MAX_CHARS) };
    for (let attempt = 0; ; attempt++) {
      try {
        // 결과 보고는 AI(agentId) 대행 — API 가 그 AI 이름으로 이슈 챗에 글을 남긴다.
        await scoped.reportRecurringRun(agentId, p.issueId, body);
        return;
      } catch (e) {
        const transient = isTransient(e);
        const retry = transient && attempt < REPORT_RETRY_DELAYS_MS.length;
        // 다시 보내지 않는 거절(권한·잘못된 요청·코드 결함)은 설정·결함이라 일시 오류와 구분해 남긴다.
        console.error(transient ? '[run-recurring] 결과 보고 실패' : '[run-recurring] 결과 보고 거절 — 다시 보내지 않음', {
          issueKey: p.issueKey,
          runId: p.runId,
          attempt: attempt + 1,
          status: axios.isAxiosError(e) ? e.response?.status : undefined,
          willRetry: retry,
          error: reason(e, ''),
        });
        if (!retry) return;
        const base = REPORT_RETRY_DELAYS_MS[attempt];
        await sleep(Math.round(base * (1 + RETRY_JITTER * (2 * random() - 1))));
      }
    }
  };

  let credential: ProviderCredential;
  try {
    credential = await deps.client.getProviderCredential(agentId);
  } catch (e) {
    console.error('[run-recurring] provider credential fetch 실패', { issueKey: p.issueKey, agentId, error: reason(e, '') });
    await report(false, 'AI 비서의 연결 정보를 가져오지 못했습니다');
    return;
  }

  const model = credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  // 이슈 이벤트와 같이 공용 메모리(조직 + 그 프로젝트) 블록을 맨 앞에 — 개인 프로젝트라 API 는 조직 몫만 싣는다.
  const userMessage = withSharedMemory(p, buildRecurringRunMessage(p));

  let text: string;
  try {
    const events = await runnerFor(credential).collect({
      userMessage,
      systemPrompt: RECURRING_RUN_SYSTEM_PROMPT,
      model,
      maxTurns,
      credential,
      agentId,
      userId: ownerId,
      timeoutMs,
      logTag,
      // 도구는 소유자(ownerId) 대행 — 홈 AI 채팅처럼 그 사람의 메일·일정·노트 등을 읽는다. 읽기 전용 프로필이라 쓰기 도구는 없다.
      mcp: {
        client: scoped,
        onBehalfOfId: ownerId,
        profile: 'recurring',
        onBehalfOfTenantId: p.tenantId ?? undefined, // opencode stdio MCP 도 같은 테넌트로 호출
      },
    });
    if (!resultOk(events)) {
      await report(false, 'AI 실행이 정상적으로 끝나지 않았습니다');
      return;
    }
    text = finalText(events);
  } catch (e) {
    console.error('[run-recurring] 실행 실패', { issueKey: p.issueKey, runId: p.runId, error: reason(e, '') });
    await report(false, reason(e, 'AI 실행 중 오류가 났습니다'));
    return;
  }

  if (!text) {
    await report(false, 'AI 가 결과를 만들지 못했습니다');
    return;
  }
  await report(true, text);
}
