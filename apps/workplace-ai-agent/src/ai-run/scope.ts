import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { failureReasonOf, type AiRunFailureReason } from './failure-reason.js';
import type { RunnerUsage } from '../agent/runner-events.js';
import type { AiRunContext, AiRunRecord, AiRunSink } from './types.js';

const REASON_MAX = 200;
const DETAIL_MAX = 2000;

/** 아무것도 하지 않는 sink (기록 비활성·테스트 기본값). */
export const noopAiRunSink: AiRunSink = { enqueue: () => undefined };

/**
 * 러너 오류의 분류 사유가 o.reason 보다 앞서는가 — 라우트 자체의 요청 오류(http_4xx)와 클라이언트 취소(client_closed)일 때만 지고,
 * 그 밖의 일반 표지(없음·http_5xx·runner_error·handler_error·stream_error·failed 등)에는 이긴다.
 * 왜: 이벤트 처리(POST /events)는 러너 한도 오류가 핸들러 실패로 전달돼 handler_error 로 닫히는데, 그때도 사용 한도 초과가
 * provider_limit 로 남아야 실패율에서 빠진다(WP-2106).
 */
function classifiedWins(reason: string | undefined): boolean {
  return reason === undefined || !(reason === 'client_closed' || /^http_4\d\d$/.test(reason));
}

/** 문자열을 상한 길이로 자른다. */
function cut(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** 오류 값에서 사람이 읽을 메시지를 뽑는다(WP-1828: 기록 쪽 모든 파일이 이 한 곳을 쓴다). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/**
 * AI 처리 한 건(요청·이벤트 하나)의 범위 (WP-1828).
 * 러너 호출을 모아 토큰 합·모델·실패 여부를 쌓고, 첫 러너 시작 때 RUNNING,
 * close 때 최종 상태를 sink 로 넘긴다. 러너를 한 번도 부르지 않았으면 아무것도 넣지 않는다.
 * sink 오류는 처리 결과에 영향이 없도록 삼킨다.
 */
export class AiRunScope {
  readonly runId: string;
  private readonly startedAt: Date;
  private readonly tenantId: number | null;
  private started = false;
  private _closed = false;
  private model: string | null = null;
  private credentialLabel: string | null = null;
  /**
   * 러너 실패 목록(시도 순) — 항목마다 상세 메시지(없으면 null)와 원인 코드(분류 불가면 null, WP-2106).
   * 용서는 마지막 하나만 지운다(WP-1828).
   */
  private readonly runnerFailures: Array<{ message: string | null; reason: AiRunFailureReason | null }> = [];
  /** 라우트가 직접 지정한 실패 사유(markFailed) — 러너는 성공했어도 처리가 실패한 경우. */
  private forcedFailure: { reason: string; detail: string | null } | null = null;
  private readonly usages: RunnerUsage[] = [];

  constructor(
    private readonly ctx: AiRunContext & { kind: string },
    private readonly sink: AiRunSink,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.runId = ctx.runId ?? randomUUID();
    this.tenantId = ctx.tenantId ?? null;
    this.startedAt = now();
  }

  get closed(): boolean {
    return this._closed;
  }

  /** 러너 시작. 첫 호출에서만 RUNNING 기록을 넣는다. 모델은 마지막 값을 쓴다. */
  runnerStarted(model: string, credentialLabel: string): void {
    if (this._closed) return;
    this.model = model;
    this.credentialLabel = credentialLabel;
    if (this.started) return;
    this.started = true;
    this.emit(this.build('RUNNING', null, null, null));
  }

  /** 러너 종료. usage 는 쌓고, 실패면 사유를 기억한다. */
  runnerFinished(r: { ok: boolean; usage: RunnerUsage | null; error?: unknown }): void {
    if (this._closed) return;
    if (r.usage) this.usages.push(r.usage);
    if (!r.ok) {
      // 원인 코드는 오류 객체에서만 알 수 있어 닫을 때가 아니라 기록할 때 분류해 둔다.
      this.runnerFailures.push(
        r.error !== undefined
          ? { message: errorMessage(r.error), reason: failureReasonOf(r.error) }
          : { message: null, reason: null },
      );
    }
  }

  /**
   * 러너 실패를 용서한다 — effort 거부 뒤 effort 없이 재시도하는 경로가 호출한다(WP-1828).
   * 재시도가 성공하면 그 직전 시도의 실패만 지운다(가장 최근 하나) — 앞선 다른 실패는 남아 처리가 FAILED 로 끝난다.
   * 토큰 합은 그대로 둔다(첫 시도 소비도 실제 사용).
   */
  forgiveRunnerFailure(): void {
    if (this._closed) return;
    this.runnerFailures.pop();
  }

  /** 러너는 성공했어도 처리가 실패했음을 알린다(예: SSE 전송 중 오류). close 결과가 FAILED·이 사유가 된다. */
  markFailed(reason: string, detail?: string): void {
    if (this._closed) return;
    this.forcedFailure = { reason, detail: detail ?? null };
  }

  /** 범위를 닫는다. 한 번만 동작하며, 러너가 시작된 적이 없으면 기록을 넣지 않는다. */
  close(o: { ok: boolean; reason?: string; detail?: string }): void {
    if (this._closed) return;
    this._closed = true;
    if (!this.started) return;
    const forced = this.forcedFailure;
    const runnerFailed = this.runnerFailures.length > 0;
    // 남은 실패 중 가장 최근 항목의 사유를 쓴다.
    const lastFailure = runnerFailed ? this.runnerFailures[this.runnerFailures.length - 1] : null;
    const runnerErrorDetail = lastFailure?.message ?? null;
    const ok = o.ok && !runnerFailed && !forced;
    // 사유 우선순위(WP-2106): client_closed > 러너 오류의 분류 사유(한도·인증 등; o.reason 이 http_4xx 가 아닐 때) > o.reason > runner_error > markFailed 사유 > 'failed'.
    // 분류 불가 러너 오류는 종전 순서를 둔다 — 러너가 실패했으면 SSE 라우트의 stream_error 가 그 사유를 덮지 않는다(WP-1828).
    const classified = classifiedWins(o.reason) ? (lastFailure?.reason ?? null) : null;
    const raw =
      o.reason === 'client_closed'
        ? o.reason
        : (classified ?? o.reason ?? (runnerFailed ? 'runner_error' : (forced?.reason ?? 'failed')));
    const reason = ok ? null : cut(raw, REASON_MAX);
    // 상세도 같은 순서: o.detail > 마지막 러너 오류(runnerFailed 일 때만 값이 있다) > markFailed 상세.
    const detailSrc = ok ? null : (o.detail ?? runnerErrorDetail ?? forced?.detail ?? null);
    const detail = detailSrc === null ? null : cut(detailSrc, DETAIL_MAX);
    this.emit(this.build(ok ? 'SUCCEEDED' : 'FAILED', this.now().toISOString(), reason, detail));
  }

  /** 범위 안 모든 usage 에서 한 필드를 합친다. 없는 값은 건너뛰고 모두 없으면 null. */
  private sum(field: keyof RunnerUsage): number | null {
    let total: number | null = null;
    for (const u of this.usages) {
      const v = u[field];
      if (typeof v === 'number' && Number.isFinite(v)) total = (total ?? 0) + v;
    }
    return total;
  }

  private build(
    status: AiRunRecord['status'],
    endedAt: string | null,
    errorReason: string | null,
    errorDetail: string | null,
  ): AiRunRecord {
    const final = status !== 'RUNNING';
    return {
      runId: this.runId,
      tenantId: this.tenantId,
      kind: this.ctx.kind,
      targetType: this.ctx.targetType ?? null,
      targetId: this.ctx.targetId ?? null,
      targetLabel: this.ctx.targetLabel ?? null,
      actorType: this.ctx.actorType ?? null,
      actorId: this.ctx.actorId ?? null,
      sourceAt: this.ctx.sourceAt ?? null,
      startedAt: this.startedAt.toISOString(),
      endedAt,
      inputTokens: final ? this.sum('inputTokens') : null,
      outputTokens: final ? this.sum('outputTokens') : null,
      cacheReadTokens: final ? this.sum('cacheReadTokens') : null,
      cacheWriteTokens: final ? this.sum('cacheWriteTokens') : null,
      model: this.model,
      credentialLabel: this.credentialLabel,
      status,
      errorReason,
      errorDetail,
      attempt: this.ctx.attempt ?? 1,
    };
  }

  /** sink 로 넘기되 오류는 삼킨다 — 기록이 처리 결과를 바꾸면 안 된다. */
  private emit(record: AiRunRecord): void {
    try {
      this.sink.enqueue(record);
    } catch (e) {
      console.warn('[ai-run] 기록 전달 실패(무시):', errorMessage(e));
    }
  }
}

const storage = new AsyncLocalStorage<AiRunScope>();

/** fn 을 범위 안에서 실행한다 (async 경계 너머까지 유지). */
export function withAiRunScope<T>(scope: AiRunScope, fn: () => T): T {
  return storage.run(scope, fn);
}

/** 현재 범위. 없거나 이미 닫혔으면 undefined. */
export function currentAiRunScope(): AiRunScope | undefined {
  const s = storage.getStore();
  return s && !s.closed ? s : undefined;
}

/** 기록 호출의 오류를 삼킨다 — 기록이 처리 결과를 바꾸면 안 된다. label 은 경고에 붙는 작업 이름(WP-1828). */
export function swallowRecording(label: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.warn(`[ai-run] ${label} 실패(무시):`, errorMessage(e));
  }
}

/** 현재 범위의 마지막 러너 실패를 용서한다 — 재시도 회복 경로용(WP-1828). */
export function forgiveScopeRunnerFailure(): void {
  swallowRecording('러너 실패 용서', () => currentAiRunScope()?.forgiveRunnerFailure());
}

/** 현재 범위에 처리 실패를 알린다(러너는 성공했어도 후속 처리가 실패한 경우)(WP-1828). */
export function markScopeFailed(reason: string, detail?: string): void {
  swallowRecording('처리 실패 표시', () => currentAiRunScope()?.markFailed(reason, detail));
}
