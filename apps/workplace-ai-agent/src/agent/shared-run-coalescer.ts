// WP-1979: 대화(키)별 실행을 파드 사이에서 하나만 돌리는 합치기 — 잠금은 api 의 DB 임대가 들고, 이 모듈은 흐름만 맡는다.
//
// 흐름: acquire → ACQUIRED 면 실행 → release 가 밀린 이벤트(가장 최근 것)를 주면 그것으로 다시 실행 → 없으면 끝.
// QUEUED(서버가 대기열에 적재)·DUPLICATE(이미 처리 중인 메시지)는 실행하지 않는다.
// acquire 가 실패하면(api 가 구버전이라 404 등) 같은 이벤트를 메모리 합치기(fallback)에 맡겨 답이 끊기지 않게 한다.
// 토큰은 이 모듈이 acquire 전에 만들어 보낸다 — 서버가 ACQUIRED 를 커밋했는데 응답만 잃었어도(타임아웃·연결 끊김·502)
// fallback 실행이 끝난 뒤 그 토큰으로 반납해 대화가 임대 만료(약 16분)까지 묶이지 않게 한다.
import { randomUUID } from 'node:crypto';
import { trackInflight } from '../graceful-shutdown.js';
import { DEFAULT_MAX_RUN_MS, runWithLimit, type RunCoalescer } from './run-coalescer.js';

/** 임대 저장소 — 이벤트로 대화 키를 정하고 api 임대를 부른다. */
export interface RunLeaseStore<E> {
  /** token 은 호출부가 만든 소유 토큰 — 서버가 받아 쓰고 돌려준다(구버전 api 는 무시하고 자기 토큰을 돌려준다). */
  acquire(event: E, leaseMs: number, token: string): Promise<{ status: 'ACQUIRED'; token: string } | { status: 'QUEUED' | 'DUPLICATE' }>;
  /** 임대를 돌려주고, 기다리던 이벤트가 있으면 돌려준다(서버가 임대를 이어서 갱신해 둔다). */
  release(event: E, token: string, leaseMs: number): Promise<E | null>;
}

/**
 * 실행 상한 뒤 여유 — 상한 시각에 runWithLimit 가 기다림을 멈추고 release 하기 전에 임대가 먼저 만료돼 다른 파드가 끼는 일을 막는다.
 * 주의: runWithLimit 는 기다림만 멈출 뿐 멈춘 실행 자체를 끝내지 못한다. 그래서 상한을 넘긴 실행이 계속 돌면 그 뒤의 release·밀린 재실행과
 * 겹칠 수 있다(예전 메모리 합치기와 같은 한계).
 */
const LEASE_MARGIN_MS = 60_000;

/**
 * 파드 사이 공유 임대로 대화별 실행을 하나만 돌리는 합치기를 만든다. store 는 이벤트별 임대 저장소, fallback 은 임대를 못 쓸 때의
 * 메모리 합치기, run 은 실제 실행, onError 는 실행 실패 로그다. submit 은 항상 promise 를 돌려주며 첫 실행 오류로 거부한다(WP-1828).
 */
export function createSharedRunCoalescer<E>(opts: {
  store: (event: E) => RunLeaseStore<E>;
  fallback: RunCoalescer<E>;
  run: (event: E) => Promise<unknown>;
  onError: (event: E, error: unknown) => void;
  maxRunMs?: number;
  /** 이벤트의 대화 키 — 같은 키의 fallback 실행이 도는 동안엔 새 이벤트를 임대 없이 fallback 으로 보낸다(같은 파드 겹침 방지). */
  key?: (event: E) => string;
  /** acquire 실패가 서버 커밋 뒤 응답 유실일 수 있는가 — 아니면(확실한 HTTP 거절) 반납을 건너뛴다. 기본은 항상 true. */
  mayHaveCommitted?: (error: unknown) => boolean;
}): { submit(event: E): Promise<void> | undefined } {
  const maxRunMs = opts.maxRunMs ?? DEFAULT_MAX_RUN_MS;
  const leaseMs = maxRunMs + LEASE_MARGIN_MS;
  /** fallback 실행(과 뒤따르는 반납)이 진행 중인 대화 키 — 이 동안 같은 키는 임대를 얻지 않는다. */
  const fallbackKeys = new Set<string>();

  /** 임대를 얻은 뒤의 실행 루프 — 오류가 나도 release·밀린 실행을 하고 첫 오류로 거부한다(WP-1828). */
  async function runOwned(first: E, token: string): Promise<void> {
    let current: E | null = first;
    // 첫 오류만 기억하고 끝까지 돈다 — 마지막에 그 오류로 거부한다.
    let firstErr: { e: unknown } | undefined;
    while (current) {
      try {
        await runWithLimit(opts.run, current, maxRunMs);
      } catch (e) {
        opts.onError(current, e);
        firstErr ??= { e };
      }
      let next: E | null = null;
      try {
        next = await opts.store(current).release(current, token, leaseMs);
      } catch (e) {
        // 반납 실패는 임대 만료가 정리해 주므로 경고만 하고 끝낸다.
        console.warn('[shared-run-coalescer] release 실패', e instanceof Error ? e.message : String(e));
      }
      current = next;
    }
    if (firstErr) throw firstErr.e;
  }

  /**
   * acquire 실패 뒤 처리 — fallback 으로 답한 다음, acquire 때 보낸 토큰으로 반납을 한 번 시도한다. 서버가 실은 ACQUIRED 를
   * 커밋했다면 이 반납이 임대를 풀거나 밀린 이벤트를 넘겨주고(그러면 같은 토큰으로 소유 루프를 돈다), 소유자가 아니면 아무것도
   * 바꾸지 않는다. 반납 실패(구버전 api 의 404 등)는 경고 한 줄로 끝낸다. 오류는 fallback·소유 루프 중 먼저 난 것으로 거부한다.
   */
  async function fallbackThenRelease(event: E, token: string, mayRelease: boolean): Promise<void> {
    // 같은 키의 fallback 실행(과 뒤따르는 반납)이 도는 동안 키를 잡아 둔다. mayRelease 가 false 면 반납을 건너뛴다(서버에 아무것도 없다).
    const k = opts.key?.(event);
    if (k !== undefined) fallbackKeys.add(k);
    try {
      let firstErr: { e: unknown } | undefined;
      try {
        await opts.fallback.submit(event);
      } catch (e) {
        firstErr = { e };
      }
      let next: E | null = null;
      try {
        if (mayRelease) next = await opts.store(event).release(event, token, leaseMs);
      } catch (e) {
        console.warn('[shared-run-coalescer] acquire 실패 뒤 release 도 실패', e instanceof Error ? e.message : String(e));
      }
      if (next) {
        try {
          await runOwned(next, token);
        } catch (e) {
          firstErr ??= { e };
        }
      }
      if (firstErr) throw firstErr.e;
    } finally {
      if (k !== undefined) fallbackKeys.delete(k);
    }
  }

  async function handle(event: E): Promise<void> {
    // 같은 키의 fallback 실행이 도는 중이면 임대를 얻지 않고 메모리 합치기에 합친다 — 얻으면 같은 파드에서 두 답이 겹친다.
    const k = opts.key?.(event);
    if (k !== undefined && fallbackKeys.has(k)) {
      await opts.fallback.submit(event);
      return;
    }
    // 토큰을 먼저 만들어 보낸다 — acquire 응답을 잃어도 이 토큰으로 반납할 수 있게.
    const token = randomUUID();
    let res: Awaited<ReturnType<RunLeaseStore<E>['acquire']>>;
    try {
      res = await opts.store(event).acquire(event, leaseMs, token);
    } catch (e) {
      console.warn('[shared-run-coalescer] acquire 실패 — 메모리 합치기로 대체', e instanceof Error ? e.message : String(e));
      // 확실한 HTTP 거절이면 서버에 아무것도 커밋되지 않았으니 반납하지 않는다.
      await fallbackThenRelease(event, token, opts.mayHaveCommitted ? opts.mayHaveCommitted(e) : true);
      return;
    }
    if (res.status !== 'ACQUIRED') return;
    // 서버가 돌려준 토큰을 쓴다 — 새 api 는 보낸 토큰 그대로, 구버전 api 는 자기가 만든 토큰을 돌려준다.
    await runOwned(event, res.token);
  }

  return {
    // acquire 결과를 기다려야 알 수 있으므로 항상 promise 를 돌려준다 — 합쳐졌으면 바로 이행한다.
    submit(event) {
      const p = handle(event);
      void trackInflight(p);
      p.catch(() => undefined); // 호출부가 안 봐도 unhandled rejection 이 되지 않게
      return p;
    },
  };
}
