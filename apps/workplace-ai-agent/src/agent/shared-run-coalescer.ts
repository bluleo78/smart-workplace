// WP-1979: 대화(키)별 실행을 파드 사이에서 하나만 돌리는 합치기 — 잠금은 api 의 DB 임대가 들고, 이 모듈은 흐름만 맡는다.
//
// 같은 파드 안에서는 대화 키를 쥔 동안 온 이벤트를 키별 대기 칸(최신 하나)에 두었다가 쥔 처리가 끝나면 이어 받는다.
// 흐름: acquire → ACQUIRED 면 실행 → release 가 밀린 이벤트(가장 최근 것)를 주면 그것으로 다시 실행 → 없으면 끝.
// QUEUED(서버가 대기열에 적재)·DUPLICATE(이미 처리 중인 메시지)는 실행하지 않는다.
// acquire 가 실패하면(api 가 구버전이라 404 등) 같은 이벤트를 메모리 합치기(fallback)에 맡겨 답이 끊기지 않게 한다.
// 토큰은 이 모듈이 acquire 전에 만들어 보낸다 — 서버가 ACQUIRED 를 커밋했는데 응답만 잃었어도(타임아웃·연결 끊김·502)
// fallback 실행이 끝난 뒤 그 토큰으로 반납해 대화가 임대 만료(약 16분)까지 묶이지 않게 한다.
// 이 파드가 임대를 쥐고 도는 동안(소유 루프) 온 같은 대화 이벤트는 대기 칸에 두지 않고 바로 서버에 acquire 해 서버 대기에 올린다
// (WP-1979 리뷰 후속) — 대기 칸에만 두면 다른 파드가 먼저 서버 대기에 올린 더 옛 이벤트가 release 로 넘어와 돈 뒤 대기 칸의
// 더 새 이벤트가 또 돌아 같은 대화에 두 번 답한다. 서버 대기는 최신 하나만 남기므로 둘 중 새 것만 돈다.
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
 * 키의 대기 칸에서 꺼낼 처리 하나.
 * - fresh: acquire 부터 한다.
 * - owned: 이미 넘겨받은 임대(token)로 바로 소유 루프를 돈다.
 * - recover: acquire 가 실패한 이벤트 — processOne 과 같은 규칙으로 fallback 으로 답한 뒤 그 토큰으로 반납한다(mayRelease 면).
 *   서버가 ACQUIRED 를 커밋하고 응답만 잃었으면 다시 acquire 해도 DUPLICATE 라 답이 사라지기 때문이다(WP-1979 리뷰 후속 반려).
 */
type HeldItem<E> =
  | { kind: 'fresh'; event: E }
  | { kind: 'owned'; event: E; token: string }
  | { kind: 'recover'; event: E; token: string; mayRelease: boolean };

/** 키를 쥔 동안의 대기 칸 — 차례대로 할 처리(owned·recover)와 가장 최근 이벤트(acquire 부터 할 것). */
interface HeldSlot<E> {
  latest: E | null;
  queue: HeldItem<E>[];
  /** 이 파드가 지금 이 키의 임대를 쥐고 소유 루프를 도는가 — 그동안 온 같은 키 이벤트는 대기 칸 대신 서버 acquire 로 보낸다. */
  owning: boolean;
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
  /**
   * 이벤트의 대화 키 — 이 파드가 같은 키를 쥔 동안 온 새 이벤트는 따로 돌지 않는다(같은 파드 겹침 방지, WP-1979 반려 1).
   * 임대를 쥔 소유 루프 중이면 서버 acquire 로 보내 서버 대기에 올리고, 그 밖(acquire 진행·fallback·release 대기)이면 키별 대기 칸에
   * 가장 최근 것만 남겼다가 — 소유 루프의 반납 직전에 서버 대기로 보내거나 쥔 처리가 끝난 뒤 — 이어 받는다(리뷰 후속). 없으면 이벤트마다 따로 처리한다.
   */
  key?: (event: E) => string;
  /** acquire 실패가 서버 커밋 뒤 응답 유실일 수 있는가 — 아니면(확실한 HTTP 거절) 반납을 건너뛴다. 기본은 항상 true. */
  mayHaveCommitted?: (error: unknown) => boolean;
  /**
   * 이벤트 순번(메시지 id — 클수록 새 것, 서버 acquire 의 DUPLICATE 판정과 같은 기준). 있으면 소유 중 온 이벤트의 acquire 가 실패했을 때,
   * 이 파드가 그 뒤 release 로 같거나 더 새 이벤트를 이미 넘겨받아 돌았으면 fallback 을 건너뛴다 — 서버가 실은 QUEUED 를 커밋하고 응답만
   * 잃었으면 그 이벤트(또는 그것을 덮은 더 새 것)는 release 로 이미 답했기 때문이다. 없으면 늘 fallback 으로 답한다.
   */
  order?: (event: E) => number;
}): { submit(event: E): Promise<void> | undefined } {
  const maxRunMs = opts.maxRunMs ?? DEFAULT_MAX_RUN_MS;
  const leaseMs = maxRunMs + LEASE_MARGIN_MS;
  /**
   * 이 파드가 쥐고 있는 대화 키 → 그 키의 대기 칸(HeldSlot — 넘겨받은 임대와 가장 최근 이벤트). 키를 쥔 처리가 끝나면 대기 칸을 꺼내 이어 처리한다.
   * 왜: acquire 응답을 기다리는 동안·폴백 뒤 release 가 넘긴 밀린 이벤트를 도는 동안에도 같은 키 새 이벤트가 따로 돌면
   * 한 파드 안에서 같은 대화의 답이 겹친다(공유 임대는 파드 사이만 막는다).
   */
  const heldKeys = new Map<string, HeldSlot<E>>();
  /** 대화 키 → 이 파드의 소유 루프가 release 로 넘겨받은 이벤트 중 가장 큰 순번(order 가 있을 때만) — recover 가 이미 답한 이벤트를 거른다. */
  const handedMax = new Map<string, number>();
  /** 대화 키 → 진행 중인 forward 수 — 키를 놓아도 진행 중인 forward 가 있으면 handedMax 를 남겨 둔다(그 forward 의 recover 가 쓴다). */
  const forwarding = new Map<string, number>();

  /**
   * 임대를 얻은 뒤의 실행 루프 — 실행 → (대기 칸을 서버 대기로) → release → 넘겨받은 밀린 이벤트로 다시 실행.
   * 오류가 나도 release·밀린 실행을 하고 첫 오류로 거부한다(WP-1828). 도는 동안 키의 대기 칸에 owning 을 켜 둔다 — 그동안 온 같은 키
   * 이벤트는 서버 acquire 로 간다(handle). 같은 키의 소유 루프는 drain 이 키를 쥐어 한 번에 하나만 돈다.
   */
  async function runOwned(first: E, token: string): Promise<void> {
    const k = opts.key?.(first);
    const slot = k === undefined ? undefined : heldKeys.get(k);
    if (slot) slot.owning = true;
    try {
      await ownedLoop(first, token, k);
    } finally {
      if (slot) slot.owning = false;
    }
  }

  async function ownedLoop(first: E, token: string, k: string | undefined): Promise<void> {
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
      // 반납 전에 대기 칸의 이벤트를 서버 대기로 보낸다 — 임대를 얻기 전(acquire 응답 대기)에 와 대기 칸에 남은 이벤트가 다른 파드의
      // 더 옛 서버 대기와 따로 돌면 같은 대화에 두 번 답한다. 서버 대기에 올리면 둘 중 새 것만 release 가 넘긴다.
      if (k !== undefined) await flushLatest(k);
      let next: E | null = null;
      try {
        next = await opts.store(current).release(current, token, leaseMs);
      } catch (e) {
        // 반납 실패는 임대 만료가 정리해 주므로 경고만 하고 끝낸다.
        console.warn('[shared-run-coalescer] release 실패', e instanceof Error ? e.message : String(e));
      }
      if (next && k !== undefined && opts.order) handedMax.set(k, Math.max(handedMax.get(k) ?? -Infinity, opts.order(next)));
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
    // mayRelease 가 false 면 반납을 건너뛴다(서버에 아무것도 없다). 같은 키 겹침은 handle 의 키 쥐기가 막는다.
    let firstErr: { e: unknown } | undefined;
    try {
      await opts.fallback.submit(event);
    } catch (e) {
      firstErr = { e };
    }
    const next = mayRelease ? await releaseAfterFailedAcquire(event, token) : null;
    if (next) {
      try {
        await runOwned(next, token);
      } catch (e) {
        firstErr ??= { e };
      }
    }
    if (firstErr) throw firstErr.e;
  }

  /**
   * 이벤트를 받는다. 키가 없으면 따로 처리한다. 이 파드가 그 키를 쥐고 있으면 — 임대를 쥔 소유 루프 중이면 서버 acquire 로 보내고(forward),
   * 그 밖(acquire 응답 대기·fallback·release 대기)이면 대기 칸에 가장 최근 것만 남겨 쥔 처리가 끝난 뒤 이어 받는다. 쥐고 있지 않으면 키를 쥐고 처리한다.
   */
  async function handle(event: E): Promise<void> {
    const k = opts.key?.(event);
    if (k === undefined) return processOne(event);
    const slot = heldKeys.get(k);
    if (slot) {
      if (slot.owning) return forward(k, event);
      // 쥔 처리가 끝나면 이어 받는다 — 그 사이 여러 개가 오면 가장 최근 것만 남긴다(답은 최신 맥락으로 한 번).
      slot.latest = event;
      return;
    }
    return drain(k, { kind: 'fresh', event }, []);
  }

  /**
   * 키를 쥐고 첫 처리와, 쥔 동안 대기 칸에 쌓인 것을 차례로 처리한다 — 넘겨받은 임대(owned)가 먼저, 그다음 가장 최근 이벤트(latest).
   * 임대를 쥔 처리를 먼저 해야 그 임대가 만료까지 묶이지 않는다. rest 는 처음부터 대기 칸에 넣어 둘 것이다(enqueue).
   * 오류는 처리마다 기록하고 끝까지 돈 뒤 첫 오류로 거부한다(WP-1828 — runOwned 와 같은 규칙).
   */
  async function drain(k: string, first: HeldItem<E>, rest: HeldItem<E>[]): Promise<void> {
    const slot: HeldSlot<E> = { latest: null, queue: [], owning: false };
    heldKeys.set(k, slot);
    putInSlot(slot, rest);
    let firstErr: { e: unknown } | undefined;
    let item: HeldItem<E> | null = first;
    // processOne·runOwned 오류는 잡아 두므로 루프를 빠져나가는 예외가 없다 — 키는 루프 뒤에 비운다.
    while (item) {
      try {
        if (item.kind === 'owned') await runOwned(item.event, item.token);
        else if (item.kind === 'recover') await recover(k, item.event, item.token, item.mayRelease);
        else await processOne(item.event);
      } catch (e) {
        firstErr ??= { e };
      }
      item = takeNext(slot);
    }
    // 대기 칸 확인과 삭제 사이에 await 가 없어 그 틈에 온 이벤트를 잃지 않는다(단일 스레드).
    heldKeys.delete(k);
    forgetHanded(k);
    if (firstErr) throw firstErr.e;
  }

  /**
   * acquire 가 실패한 소유 중 이벤트를 처리한다 — 이 파드가 그 뒤 release 로 같거나 더 새 이벤트를 넘겨받아 돌았으면(서버가 QUEUED 를 커밋하고
   * 응답만 잃은 경우) fallback 없이 그 토큰으로 반납만 하고(소유자가 아니면 서버는 아무것도 바꾸지 않는다), 아니면 processOne 처럼 fallback 뒤 반납한다.
   */
  async function recover(k: string, event: E, token: string, mayRelease: boolean): Promise<void> {
    const handed = handedMax.get(k);
    if (opts.order && handed !== undefined && handed >= opts.order(event)) {
      const next = mayRelease ? await releaseAfterFailedAcquire(event, token) : null;
      if (next) await runOwned(next, token);
      return;
    }
    await fallbackThenRelease(event, token, mayRelease);
  }

  /** 키를 쥔 처리도 진행 중인 forward 도 없으면 넘겨받은 순번 기록을 지운다(대화마다 쌓이지 않게). */
  function forgetHanded(k: string): void {
    if (!heldKeys.has(k) && !forwarding.get(k)) handedMax.delete(k);
  }

  /** 대기 칸에서 다음 처리를 꺼낸다 — 차례대로 할 처리 먼저, 없으면 가장 최근 이벤트. 비었으면 null. */
  function takeNext(slot: HeldSlot<E>): HeldItem<E> | null {
    const queued = slot.queue.shift();
    if (queued) return queued;
    if (slot.latest === null) return null;
    const event = slot.latest;
    slot.latest = null;
    return { kind: 'fresh', event };
  }

  /**
   * 소유 루프 중에 온 같은 키 이벤트를 서버 acquire 로 보낸다. QUEUED·DUPLICATE 면 서버 대기가 맡으니 끝이다(release 가 최신 하나를 넘긴다).
   * ACQUIRED 면 — acquire 가 소유 루프의 마지막 release 뒤에 닿아 임대가 비어 있었다 — 그 토큰으로 이 파드가 돌아야 한다: 아직 키를 쥐고 있으면
   * 대기 칸(owned)에 두고, 이미 놓았으면 새로 쥐고 돈다(같은 파드 겹침 없음). acquire 가 실패하면 processOne 과 같은 규칙 — fallback 으로 답한 뒤
   * 그 토큰으로 반납(서버가 커밋했을 수 있을 때) — 을 키의 차례(recover)로 미뤄 한다. 다시 acquire 하면 서버가 ACQUIRED 를 커밋하고 응답만 잃었을 때
   * DUPLICATE 로 답이 사라진다.
   */
  async function forward(k: string, event: E): Promise<void> {
    forwarding.set(k, (forwarding.get(k) ?? 0) + 1);
    try {
      await forwardOnce(k, event);
    } finally {
      const left = (forwarding.get(k) ?? 1) - 1;
      if (left > 0) forwarding.set(k, left);
      else forwarding.delete(k);
      forgetHanded(k);
    }
  }

  async function forwardOnce(k: string, event: E): Promise<void> {
    const token = randomUUID();
    let res: Awaited<ReturnType<RunLeaseStore<E>['acquire']>>;
    try {
      res = await opts.store(event).acquire(event, leaseMs, token);
    } catch (e) {
      console.warn('[shared-run-coalescer] 소유 중 온 이벤트 acquire 실패 — 대기 칸으로', e instanceof Error ? e.message : String(e));
      // 지금 소유 루프와 겹치지 않게 키의 차례로 미뤄 fallback·반납한다(다시 acquire 하지 않는다 — 커밋됐으면 DUPLICATE 로 사라진다).
      return enqueue(k, [{ kind: 'recover', event, token, mayRelease: mayHaveCommitted(e) }]);
    }
    if (res.status !== 'ACQUIRED') return;
    return enqueue(k, [{ kind: 'owned', event, token: res.token }]);
  }

  /** 키의 대기 칸에 가장 최근 이벤트가 있으면 꺼내 서버 acquire 로 보낸다(forward — 실패하면 키의 차례로 fallback·반납). */
  async function flushLatest(k: string): Promise<void> {
    const slot = heldKeys.get(k);
    if (!slot || slot.latest === null) return;
    const event = slot.latest;
    slot.latest = null;
    await forward(k, event);
  }

  /** 처리할 것을 키의 대기 칸에 넣는다 — 키를 쥔 처리가 없으면 첫 것으로 새로 쥐고 나머지는 그 대기 칸에 넣는다. */
  async function enqueue(k: string, items: [HeldItem<E>, ...HeldItem<E>[]]): Promise<void> {
    const slot = heldKeys.get(k);
    if (!slot) return drain(k, items[0], items.slice(1));
    putInSlot(slot, items);
  }

  /** 대기 칸에 넣는다 — owned·recover 는 차례대로, fresh 는 가장 최근 것만. */
  function putInSlot(slot: HeldSlot<E>, items: HeldItem<E>[]): void {
    for (const it of items) {
      if (it.kind === 'fresh') slot.latest = it.event;
      else slot.queue.push(it);
    }
  }

  /** acquire 실패가 서버 커밋 뒤 응답 유실일 수 있는가 — 아니면(확실한 HTTP 거절) 서버에 아무것도 없어 반납하지 않는다. */
  function mayHaveCommitted(e: unknown): boolean {
    return opts.mayHaveCommitted ? opts.mayHaveCommitted(e) : true;
  }

  /**
   * 응답을 잃었을 수 있는 acquire 뒤, 그때 보낸 토큰으로 한 번 반납한다 — 서버가 실은 ACQUIRED 를 커밋했다면 임대를 풀거나 밀린 이벤트를
   * 넘겨받고(같은 토큰으로 돌 것), 소유자가 아니면 서버는 아무것도 바꾸지 않는다. 반납 실패(구버전 api 의 404 등)는 경고 한 줄로 끝낸다.
   */
  async function releaseAfterFailedAcquire(event: E, token: string): Promise<E | null> {
    try {
      return await opts.store(event).release(event, token, leaseMs);
    } catch (e) {
      console.warn('[shared-run-coalescer] acquire 실패 뒤 release 도 실패', e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** 이벤트 하나 — acquire 해 소유 루프를 돌거나, acquire 가 실패하면 fallback 뒤 반납한다. QUEUED·DUPLICATE 는 실행하지 않는다. */
  async function processOne(event: E): Promise<void> {
    // 토큰을 먼저 만들어 보낸다 — acquire 응답을 잃어도 이 토큰으로 반납할 수 있게.
    const token = randomUUID();
    let res: Awaited<ReturnType<RunLeaseStore<E>['acquire']>>;
    try {
      res = await opts.store(event).acquire(event, leaseMs, token);
    } catch (e) {
      console.warn('[shared-run-coalescer] acquire 실패 — 메모리 합치기로 대체', e instanceof Error ? e.message : String(e));
      // 확실한 HTTP 거절이면 서버에 아무것도 커밋되지 않았으니 반납하지 않는다.
      await fallbackThenRelease(event, token, mayHaveCommitted(e));
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
