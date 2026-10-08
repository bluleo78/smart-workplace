// 메인 AI 채팅 한도 도달 마무리 — 턴/시간 한도에 걸려 라우터가 답을 내지 못했을 때, 그때까지 조회한
// 도구 결과만 근거로 도구 없는 단발 호출을 한 번 더 해 답을 만든다. "오류로 중단됨"으로 작업 결과를 통째로
// 버리던 문제를 막기 위함이다.
import { log } from '../logger.js';
import type { AgentRunner, ProviderCredential } from './agent-runner.js';
import { finalText, finalUsage, resultOk, type RunnerUsage } from './runner-events.js';
import type { RunnerLimitKind } from './runner-limit.js';
import type { ToolUseLine } from './sdk-mcp-server.js';

/** 도구 결과 1건당 최대 글자 수 — 큰 목록 조회 결과가 마무리 프롬프트를 독점하지 않게 자른다. */
const PER_RESULT_MAX_CHARS = 4_000;
/** 마무리 프롬프트에 싣는 도구 결과 총량 상한 — 넘치면 앞(오래된) 결과부터 버린다. */
const TOTAL_RESULTS_MAX_CHARS = 40_000;
/** 마무리 호출 시간 한도 상한 — 실제 값은 호출자가 남은 요청 예산(api 쪽 HTTP 300s) 안으로 줄여 넘긴다. */
export const FINALIZE_TIMEOUT_MS = 45_000;
/** 마무리 호출 중 진행 버블 라벨 — 최대 45s 동안 화면이 멈춰 보이지 않게(EXTRACTION_WAIT_LABEL 과 같은 방식). */
export const FINALIZE_PROGRESS_LABEL = '확인한 내용으로 정리 중';

const FINALIZE_SYSTEM_PROMPT = `당신은 사내 업무 비서입니다. 앞선 처리 과정이 처리 한도에 도달해 더 이상 도구를 쓸 수 없습니다.
아래 "지금까지 조회한 결과"만 근거로 사용자의 현재 요청에 한국어로 답하세요.
- 결과에 없는 내용은 지어내지 마세요.
- 확인하지 못한 부분이 있으면 답 끝에 한 줄로 짧게 밝히세요(예: "일부는 확인하지 못했어요. 범위를 좁혀 다시 물어봐 주세요.").
- 내부 도구 이름이나 처리 한도 같은 시스템 사정은 언급하지 마세요.`;

/** 도구 결과 누적기 — onTool 의 tool_result 를 크기 상한 안에서 모은다(서브에이전트 도구 호출도 같은 MCP 서버라 포함). */
export class ToolResultCollector {
  private readonly items: string[] = [];
  private total = 0;

  /** onTool 라인을 받아 결과(tool_result)만 적재한다. 오류 결과는 근거가 아니므로 건너뛴다. */
  add(line: ToolUseLine): void {
    if (line.event !== 'tool_result' || line.isError || !line.result) return;
    const body =
      line.result.length > PER_RESULT_MAX_CHARS ? `${line.result.slice(0, PER_RESULT_MAX_CHARS)}…(생략)` : line.result;
    const item = `### ${line.toolName}\n${body}`;
    this.items.push(item);
    this.total += item.length;
    // 총량 초과 시 오래된 것부터 버린다 — 최근 조회가 답에 더 가깝다.
    while (this.total > TOTAL_RESULTS_MAX_CHARS && this.items.length > 1) {
      this.total -= this.items.shift()!.length;
    }
  }

  /** 프롬프트 블록. 결과가 없으면 "없음"을 명시해 모델이 지어내지 않게 한다. */
  toBlock(): string {
    return this.items.length > 0 ? this.items.join('\n\n') : '(조회된 결과 없음)';
  }
}

/** 마무리 user 메시지 — 원래 요청(이전 대화·화면 맥락 포함)과 조회 결과를 함께 싣는다. */
export function buildFinalizeUserMessage(originalUserMessage: string, results: ToolResultCollector): string {
  return `${originalUserMessage}\n\n## 지금까지 조회한 결과\n${results.toBlock()}`;
}

export interface FinalizeInput {
  runner: AgentRunner;
  credential: ProviderCredential;
  model: string;
  agentId: number;
  userId: number;
  requestId?: string;
  kind: RunnerLimitKind;
  originalUserMessage: string;
  results: ToolResultCollector;
  /** 시스템 프롬프트 뒤에 붙일 날짜 지시문(상대 날짜 해석을 본 실행과 맞춘다). */
  dateDirective: string;
  /** 마무리 호출 시간 한도(ms) — 남은 요청 예산으로 줄인 값. */
  timeoutMs: number;
}

/** 마무리 결과 — 답 텍스트와 이 호출의 토큰 사용량(비용 가시화에 합산). 실패 시 text 는 빈 문자열. */
export interface FinalizeResult {
  text: string;
  usage: RunnerUsage | null;
}

/**
 * 도구 없는 단발 호출로 마무리 답을 만든다. 실패하거나 빈 답이면 text 가 빈 문자열 — 호출자가 기존 처리(오류)로 되돌린다.
 */
export async function finalizeAfterLimit(i: FinalizeInput): Promise<FinalizeResult> {
  const startedAt = Date.now();
  try {
    const events = await i.runner.collect({
      userMessage: buildFinalizeUserMessage(i.originalUserMessage, i.results),
      systemPrompt: FINALIZE_SYSTEM_PROMPT + i.dateDirective,
      model: i.model,
      maxTurns: 1,
      credential: i.credential,
      agentId: i.agentId,
      userId: i.userId,
      timeoutMs: i.timeoutMs,
      logTag: `ai-chat-finalize:${i.agentId}`,
      requestId: i.requestId,
      allowSubagents: false,
      allowFileRead: false,
      // mcp 미지정 — 도구 없이 답만 쓰게 한다.
    });
    // 실패 result 의 부분 텍스트는 답으로 쓰지 않는다(공용 헬퍼 — 최종 텍스트 정의를 한 곳에 둔다).
    const text = resultOk(events) ? finalText(events) : '';
    log.info('ai-chat', 'finalize_done', {
      requestId: i.requestId,
      kind: i.kind,
      durationMs: Date.now() - startedAt,
      answerLen: text.length,
    });
    return { text, usage: finalUsage(events) };
  } catch (e) {
    log.warn('ai-chat', 'finalize_fail', {
      requestId: i.requestId,
      kind: i.kind,
      durationMs: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    });
    return { text: '', usage: null };
  }
}
