// WP-989: 반복 개인 작업의 회차 실행 — issue.recurring_run 이벤트를 받아 반복에 등록된 비서(actingAgentId)의 LLM 자격으로,
// 도구는 API 가 정한 신원(ownerUserId — 개인 비서면 주인 대행, 그 밖의 AI 는 자기 자신, WP-1314) 권한으로 실행을 돌리고(WP-1311 부터 쓰기도
// 확인 카드 없이 바로 한다), 최종 답변을 API 내부 보고(POST /internal/issue-recurrence/{issueId}/runs)로 돌려준다. 결과 글은 API 가
// 그 AI 이름으로 이슈 챗에 남긴다. 실패도 사유와 함께 보고해야 API 가 연속 실패를 세고 작업 상태를 되돌린다.
// WP-1312: 회차가 남긴 질문에 반복을 저장한 사람이 답하면 API 가 같은 이벤트를 followUp(질문·답)과 함께 보낸다 — 이 함수가 그대로 같은 신원·권한·프로필로
// 돌리고 지시문만 이어 처리용(buildRecurringRunMessage 가 고른다)이다. 보고는 이벤트의 runId(이어 처리 id)로 같은 경로에 보낸다.
// WP-1313: 「지금 실행」(테스트 실행, issue.recurring_test_run)과 그 질문의 이어 처리도 이 함수가 돌린다 — recurring-test 프로필로 되돌릴 수
// 없는 쓰기를 멈추고(도구 래퍼가 호스트 브리지로 멈춘 쓰기를 알린다), 하나라도 멈췄으면 결과를 질문으로 보고하면서 멈춘 쓰기 목록을 함께 보낸다. 이어
// 처리는 답을 받은 테스트 질문이 멈춘 쓰기(followUp.permittedActions)만 실행을 허락받는다.
import axios from 'axios';
import { RECURRING_QUESTION_MARKER, RECURRING_RUN_SYSTEM_PROMPT } from './system-prompt.js';
import { hasDecisionSection } from './decision-section.js';
import { buildRecurringRunMessage, TEST_GATED_LABELS } from './user-message.js';
import { defaultSleep } from './sleep.js';
import { withSharedMemory } from './shared-memory-block.js';
import { fetchAgentInstructions, withAgentInstructions } from './agent-instructions.js';
import { runnerFor, type ProviderCredential } from './agent-runner.js';
import { DEFAULT_MODEL } from './model-defaults.js';
import { finalText, resultOk } from './runner-events.js';
import type { IssueRecurringRunPayload } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { HostBridge } from '../mcp/tools.js';

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

// WP-1313: 멈춘 쓰기 보고 상한 — API 도 상한(20개)으로 자르지만 전송량을 묶는다.
const PAUSED_ACTIONS_MAX = 20;

/** 테스트 실행이 멈춘 되돌릴 수 없는 쓰기 하나 — 도구 래퍼가 기록한 도구 이름·인자. */
export interface PausedAction {
  tool: string;
  args?: Record<string, unknown>;
}

export async function runRecurring(
  p: IssueRecurringRunPayload,
  deps: RunRecurringDeps,
  opts: { test?: boolean } = {},
): Promise<void> {
  const test = opts.test === true;
  const agentId = p.actingAgentId;
  const ownerId = p.ownerUserId;
  const logTag = `agent:issue.recurring_${test ? 'test_' : ''}run${p.followUp ? ':follow_up' : ''}:${p.issueKey}:${agentId}`;
  // 테넌트가 오면 X-On-Behalf-Of-Tenant 를 싣는 스코프 클라이언트로 — 소유자 대행 도구 호출과 결과 보고가 이 테넌트로만 간다(run-ai-chat 과 같은 규칙).
  // LLM 자격 조회는 비서 전역 계정이라 스코프 없이(run-ai-chat 과 같다).
  const scoped = p.tenantId != null ? deps.client.withOnBehalfOfTenant(p.tenantId) : deps.client;

  // 결과 보고 — 일시 오류면 짧게 쉬며 다시 보낸다(WP-1118). 한 번만 보내면 API 재시작·네트워크 끊김에 결과가 사라져, 성공한 회차가 30분 뒤
  // 「결과를 받지 못했습니다」 실패로 세졌다. 끝내 실패해도 던지지 않는다 — 그때는 API 의 결과 대기 시간 초과가 실패로 센다.
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const report = async (ok: boolean, message: string, question = false, pausedActions: PausedAction[] = []) => {
    const body = {
      runId: p.runId,
      ok,
      message: message.slice(0, REPORT_MAX_CHARS),
      ...(question ? { question } : {}),
      ...(pausedActions.length ? { pausedActions: pausedActions.slice(0, PAUSED_ACTIONS_MAX) } : {}),
    };
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

  // WP-1368: 이 AI(actingAgentId)의 지시 — 실행마다 한 번 읽어 시스템 프롬프트 맨 뒤에 붙인다. 자격증명 요청과 함께 내보내 실행 시작을 늦추지 않는다.
  // 구성원 조회는 테넌트 범위라 도구 호출·결과 보고와 같은 스코프 클라이언트로 부른다(조회 대상은 늘 실행 AI 자신).
  // 실패해도 reject 하지 않고 null(지시 없이 진행)이라, 자격증명이 실패해 실행을 생략할 때는 기다리지 않고 버려도 된다.
  const instructionsPromise = fetchAgentInstructions(scoped, agentId, logTag);

  let credential: ProviderCredential;
  try {
    credential = await deps.client.getProviderCredential(agentId);
  } catch (e) {
    console.error('[run-recurring] provider credential fetch 실패', { issueKey: p.issueKey, agentId, error: reason(e, '') });
    await report(false, 'AI 비서의 연결 정보를 가져오지 못했습니다');
    return;
  }
  const instructions = await instructionsPromise;

  const model = credential.model ?? process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  // 이슈 이벤트와 같이 공용 메모리(조직 + 그 프로젝트) 블록을 맨 앞에 — 개인 프로젝트라 API 는 조직 몫만 싣는다.
  const userMessage = withSharedMemory(p, buildRecurringRunMessage(p, { test }));

  // WP-1313: 테스트 실행이 멈춘 되돌릴 수 없는 쓰기 — recurring-test 도구 래퍼가 onProposal 로 알린다(opencode 는 HTTP 브리지 경유).
  // 카드·답 제출·담당 해제는 이 실행에 없어 무시한다.
  const paused: PausedAction[] = [];
  const hostBridge: HostBridge | undefined = test
    ? {
        onProposal: (x) => {
          paused.push({ tool: x.actionType, args: x.params });
        },
        onSubmitResponse: () => {},
        onUnassignResult: () => {},
      }
    : undefined;
  // 테스트 질문의 이어 처리면 그 질문이 멈춘 쓰기만 실행을 허락한다(하나당 한 번 — 도구 래퍼가 센다).
  const recurringPermits = test ? (p.followUp?.permittedActions ?? []).map((a) => a.tool) : undefined;

  // 실행이 비정상으로 끝났을 때(최대 턴·시간 초과·오류)의 보고. WP-1313: 테스트 실행이 그 전에 되돌릴 수 없는 쓰기를 멈췄으면 실패가 아니라
  // 질문으로 — 멈춘 쓰기 목록을 함께 보내 누른 사람이 답으로 허락할 수 있게 한다(실패로 보고하면 멈춘 쓰기가 사라져 다시 실행해야 한다).
  const reportFailure = async (why: string) => {
    if (paused.length > 0) await report(true, endedEarlyQuestion(why, paused), true, paused);
    else await report(false, why);
  };

  let text: string;
  try {
    const events = await runnerFor(credential).collect({
      userMessage,
      systemPrompt: withAgentInstructions(RECURRING_RUN_SYSTEM_PROMPT, instructions),
      model,
      maxTurns,
      credential,
      agentId,
      userId: ownerId,
      timeoutMs,
      logTag,
      // 도구는 ownerId 대행 — 개인 비서면 홈 AI 채팅처럼 주인의 메일·일정·노트 등을, 그 밖의 AI 면 자기 권한으로 다루고, 본문이 시킨 쓰기를
      // 확인 카드 없이 한다(WP-1311·WP-1314).
      // WP-1313: 테스트 실행은 recurring-test — 같은 도구에서 되돌릴 수 없는 쓰기만 멈춘다.
      mcp: {
        client: scoped,
        onBehalfOfId: ownerId,
        profile: test ? 'recurring-test' : 'recurring',
        onBehalfOfTenantId: p.tenantId ?? undefined, // opencode stdio MCP 도 같은 테넌트로 호출
        ...(hostBridge ? { hostBridge, recurringPermits } : {}),
      },
    });
    if (!resultOk(events)) {
      await reportFailure('AI 실행이 정상적으로 끝나지 않았습니다');
      return;
    }
    text = finalText(events);
  } catch (e) {
    console.error('[run-recurring] 실행 실패', { issueKey: p.issueKey, runId: p.runId, error: reason(e, '') });
    await reportFailure(reason(e, 'AI 실행 중 오류가 났습니다'));
    return;
  }

  // WP-1313: 테스트 실행이 되돌릴 수 없는 쓰기를 멈췄으면 모델이 표지를 빠뜨렸거나 답을 비워도 질문으로 남긴다 — 멈춘 쓰기를 아무도 확인하지
  // 않은 채 「끝났다」로 보이지 않게. 멈춘 쓰기 목록을 함께 보내 답을 받으면 그 쓰기만 허락한다.
  if (paused.length > 0) {
    const asked = text ? (splitQuestion(text) ?? text) : '';
    await report(true, asked || pausedFallback(paused), true, paused);
    return;
  }
  if (!text) {
    await report(false, 'AI 가 결과를 만들지 못했습니다');
    return;
  }
  // WP-1311: 본문이 확인을 받으라고 해 쓰기를 멈춘 회차 — 표지를 떼고 질문으로 보고해 이슈 챗에 답변 대기 글로 남긴다.
  const question = splitQuestion(text);
  if (question != null) {
    await report(true, question || text, true);
    return;
  }
  // WP-1376: 사용자가 정해야 할 항목을 결과 맨 끝 「정해 주세요」 절에 적은 회차 — 결과 전체를 그대로 질문으로 보고한다(같은 질문 경로로 답을 받아
  // 이어 처리가 답이 고른 항목만 처리한다). 이어 처리 결과도 같은 규칙이라, 다시 물으면 질문으로 다시 남고 절이 없으면 질문이 닫힌 채로 끝난다.
  await report(true, text, hasDecisionSection(text));
}

// 최종 답변 첫 줄이 질문 표지로 시작하면 표지를 뗀 나머지를 돌려준다(아니면 null). 표지 뒤가 비면 빈 문자열 — 호출부가 원문을 쓴다.
// 모델이 표지를 굵게·제목·코드로 감싸도(`**[확인 필요]**`, `# [확인 필요]`) 질문으로 본다 — 놓치면 멈춘 쓰기를 아무도 확인하지 않는다.
export function splitQuestion(text: string): string | null {
  const [first = '', ...rest] = text.trimStart().split('\n');
  const head = first.replace(/^[#>*_`\s]+/, '');
  if (!head.startsWith(RECURRING_QUESTION_MARKER)) return null;
  const tail = head.slice(RECURRING_QUESTION_MARKER.length).replace(/^[*_`\s]+/, '');
  return [tail, ...rest].join('\n').trim();
}

// WP-1313: 멈춘 쓰기는 있는데 모델 답이 비었을 때 대신 남기는 질문 — 무엇을 멈췄는지만 알린다.
function pausedFallback(paused: PausedAction[]): string {
  const names = [...new Set(paused.map((a) => a.tool))].join(', ');
  return `테스트 실행이라 되돌릴 수 없는 쓰기(${names})를 하기 전에 멈췄습니다. 진행해도 될까요?`;
}

// 멈춘 쓰기 인자를 질문 글에 보일 때의 길이 상한 — 무엇을 하려 했는지 알아볼 만큼만.
const PAUSED_ARGS_SHOWN_CHARS = 200;

// WP-1313: 멈춘 쓰기가 있는 테스트 실행이 중간에 끝났을 때 남기는 질문 — 끝난 사유와 멈춘 쓰기(사람 말 이름·도구 이름·인자 요약)를 적고
// 진행해도 될지 묻는다. 답하면 이어 처리가 이 쓰기만 허락받아 실행한다.
export function endedEarlyQuestion(why: string, paused: PausedAction[]): string {
  const lines = paused.slice(0, PAUSED_ACTIONS_MAX).map((a) => {
    const label = TEST_GATED_LABELS[a.tool];
    const args = a.args && Object.keys(a.args).length ? JSON.stringify(a.args) : '';
    const shown = args.length > PAUSED_ARGS_SHOWN_CHARS ? `${args.slice(0, PAUSED_ARGS_SHOWN_CHARS)}…` : args;
    return `- ${label ? `${label} (\`${a.tool}\`)` : `\`${a.tool}\``}${shown ? ` ${shown}` : ''}`;
  });
  return (
    `실행이 중간에 끝났습니다(${why}). 그 전에 테스트 실행이라 아래 되돌릴 수 없는 쓰기는 하지 않고 멈춰 두었습니다.\n` +
    `${lines.join('\n')}\n\n진행해도 될까요? 답하시면 이 쓰기만 이어서 처리합니다.`
  );
}
