// WP-1407: 반복 회차 실행 기록 — 러너 이벤트 스트림에서 모델 호출·도구 호출·마지막 단계를 모아, 실행이 끝날 때(성공·실패 모두) 로그 한 줄과
// 실패 글 요약 한 줄로 남긴다. 시간 상한에 걸린 회차가 어디서 시간을 썼는지(모델 응답 대기인지, 어떤 도구인지) 알기 위해서다.
// 순수 모듈(시계는 호출자가 넘긴다). 도구 이름과 숫자·시각만 받는다 — 도구 인자·결과, 모델 텍스트는 저장하지 않는다(로그 비밀값 보호).
import { stripMcpPrefix } from '@smart-workplace/mcp-tools-shared';
import type { RunnerEvent } from './runner-events.js';

/** 실행의 마지막 단계 — 모델 응답을 기다리는 중 / 도구 실행 중 / 최종 답변을 쓰는 중. */
export type TraceStep = 'model_wait' | 'tool' | 'final_answer';

/** 어느 시점의 실행 기록 요약 — 로그 필드와 실패 글 요약 줄이 이 값을 쓴다. */
export interface TraceSnapshot {
  /** 시작부터 지금까지 걸린 시간(ms). */
  elapsedMs: number;
  /** 시작부터 모델이 낸 첫 조각(텍스트·도구 호출·모델 단계)까지(ms). 아직 없으면 null. */
  firstResponseMs: number | null;
  /** 끝난 모델 호출 수. */
  modelCalls: number;
  /** 모델 호출마다 걸린 시간(ms) — opencode 는 메시지 생성~그 단계 첫 도구 시작(없으면 완료), Claude 는 이벤트 경계(직전 도구 끝~메시지 도착)로 계산. 도구 실행 시간은 들지 않는다. */
  modelCallMs: number[];
  /** 모델 호출마다의 토큰(모르면 null). */
  modelCallTokens: { in: number | null; out: number | null }[];
  tokensIn: number;
  tokensOut: number;
  /** 도구 호출 수(서브에이전트 포함). */
  toolCalls: number;
  /** 도구 이름(접두 뗀 것)별 호출 수. */
  tools: Record<string, number>;
  lastStep: TraceStep;
  /** 마지막 단계가 도구면 그 도구 이름. */
  lastTool?: string;
  /** 마지막 단계에 들어선 뒤 지난 시간(ms). */
  lastStepSinceMs: number;
}

/**
 * 회차 실행 기록기. start → on(이벤트마다) → snapshot 순으로 쓴다. 단계 전이:
 * 시작 직후 model_wait → tool_use 면 tool(도구 이름) → 진행 중 도구가 모두 끝나면(tool_done) model_wait →
 * 도구가 돌지 않을 때 텍스트가 오면 final_answer. model_step 은 호출 수·걸린 시간·토큰만 더하고 단계는 바꾸지 않는다.
 */
export class RunTraceRecorder {
  private startedAt = 0;
  private firstResponseAt: number | null = null;
  // Claude 의 model_step 은 시각이 없어 직전 경계(시작·도구 끝·이전 모델 단계)부터 지금까지를 그 호출 시간으로 본다.
  private boundary = 0;
  private readonly modelCallMs: number[] = [];
  private readonly modelCallTokens: { in: number | null; out: number | null }[] = [];
  private toolCalls = 0;
  // 삽입 순서를 지켜 같은 수일 때 먼저 부른 도구가 앞에 온다.
  private readonly tools = new Map<string, number>();
  private runningTools = 0;
  private step: TraceStep = 'model_wait';
  private lastTool: string | undefined;
  private stepSince = 0;

  /** 실행 시작(러너 호출 직전). */
  start(now: number): void {
    this.startedAt = now;
    this.boundary = now;
    this.stepSince = now;
    this.step = 'model_wait';
  }

  /** 러너 이벤트 하나를 반영한다. */
  on(ev: RunnerEvent, now: number): void {
    switch (ev.type) {
      case 'model_step': {
        const ms =
          ev.startedAt != null && ev.endedAt != null ? Math.max(0, ev.endedAt - ev.startedAt) : Math.max(0, now - this.boundary);
        this.modelCallMs.push(ms);
        this.modelCallTokens.push({ in: ev.inputTokens, out: ev.outputTokens });
        this.markFirstResponse(now);
        this.boundary = now;
        return;
      }
      case 'tool_use': {
        this.markFirstResponse(now);
        const name = stripMcpPrefix(ev.name);
        this.toolCalls += 1;
        this.tools.set(name, (this.tools.get(name) ?? 0) + 1);
        this.runningTools += 1;
        this.enter('tool', now, name);
        return;
      }
      case 'tool_done': {
        this.runningTools = Math.max(0, this.runningTools - 1);
        this.boundary = now;
        if (this.runningTools === 0) this.enter('model_wait', now);
        return;
      }
      case 'text_delta':
      case 'assistant_text': {
        this.markFirstResponse(now);
        if (this.runningTools === 0 && this.step !== 'final_answer') this.enter('final_answer', now);
        return;
      }
      default:
        return;
    }
  }

  /** 지금까지의 기록 요약. */
  snapshot(now: number): TraceSnapshot {
    const sum = (k: 'in' | 'out') => this.modelCallTokens.reduce((a, t) => a + (t[k] ?? 0), 0);
    return {
      elapsedMs: Math.max(0, now - this.startedAt),
      firstResponseMs: this.firstResponseAt == null ? null : Math.max(0, this.firstResponseAt - this.startedAt),
      modelCalls: this.modelCallMs.length,
      modelCallMs: [...this.modelCallMs],
      modelCallTokens: this.modelCallTokens.map((t) => ({ ...t })),
      tokensIn: sum('in'),
      tokensOut: sum('out'),
      toolCalls: this.toolCalls,
      tools: Object.fromEntries(this.tools),
      lastStep: this.step,
      ...(this.step === 'tool' && this.lastTool ? { lastTool: this.lastTool } : {}),
      lastStepSinceMs: Math.max(0, now - this.stepSince),
    };
  }

  // 첫 응답 — 모델이 낸 첫 조각(스트리밍 텍스트·도구 호출·모델 단계 중 먼저 온 것)의 시각. opencode 는 단계가 끝나야 model_step 이 오므로
  // 그보다 먼저 흘러오는 조각으로 잰다.
  private markFirstResponse(now: number): void {
    if (this.firstResponseAt == null) this.firstResponseAt = now;
  }

  // 단계 전이 — 도구 단계는 도구가 바뀔 때마다 그 도구로 다시 시작한다.
  private enter(step: TraceStep, now: number, tool?: string): void {
    if (this.step === step && step !== 'tool') return;
    this.step = step;
    this.stepSince = now;
    this.lastTool = tool;
  }
}

// 요약 줄에 보일 도구 종류 수 상한 — 나머지는 「외 N」(N = 나머지 종류 수).
const SUMMARY_TOP_TOOLS = 5;

/** 마지막 단계를 사람 말로. */
function stepLabel(s: TraceSnapshot): string {
  if (s.lastStep === 'tool') return `도구 실행 중(${s.lastTool ?? '알 수 없음'})`;
  if (s.lastStep === 'final_answer') return '최종 답변 작성';
  return '모델 응답 대기';
}

/**
 * 실패 글 둘째 줄 — 「모델 호출 12회 · 도구 호출 9회(update_issue 6, list_issues 3) · 마지막 단계: 모델 응답 대기 2분 10초」.
 * 도구는 많이 부른 순(같으면 먼저 부른 순) 상위 5종, 나머지는 「외 N」.
 */
export function summaryLine(s: TraceSnapshot): string {
  const entries = Object.entries(s.tools).sort((a, b) => b[1] - a[1]);
  const shown = entries.slice(0, SUMMARY_TOP_TOOLS).map(([n, c]) => `${n} ${c}`);
  const rest = entries.length - SUMMARY_TOP_TOOLS;
  const toolPart = shown.length ? `(${shown.join(', ')}${rest > 0 ? `, 외 ${rest}` : ''})` : '';
  return (
    `모델 호출 ${s.modelCalls}회 · 도구 호출 ${s.toolCalls}회${toolPart} · ` +
    `마지막 단계: ${stepLabel(s)} ${formatDuration(s.lastStepSinceMs)}`
  );
}

/** 걸린 시간을 사람 말로 — 「12초」, 「2분 10초」, 「1시간 3분 5초」. 음수는 0. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}시간 ${m}분 ${sec}초`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
}

/** 상한을 사람 말로 — 분 단위로 나누어떨어지면 「30분」, 아니면 {@link formatDuration}. */
export function formatLimit(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const min = ms / 60_000;
    return min >= 60 && min % 60 === 0 ? `${min / 60}시간` : `${min}분`;
  }
  return formatDuration(ms);
}
