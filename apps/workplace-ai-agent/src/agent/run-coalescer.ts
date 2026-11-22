// WP-1490: 대화(키)마다 실행을 하나만 돌리고, 실행 중에 온 이벤트는 끝난 뒤 가장 최근 것으로 한 번만 다시 실행한다.
//
// 잠금은 이 프로세스의 메모리 Map 이다 — Pod 마다 Map 이 따로라 Pod 를 늘리면 같은 대화가 동시에 돌 수 있다.
// 메시징은 shared-run-coalescer 가 API·DB 공유 임대로 파드 사이에서 하나만 돌리고(WP-1979), 이 메모리 합치기는 그 임대를 못 쓸 때의 대체로 남는다.
import { trackInflight } from '../graceful-shutdown.js';

/** 한 실행을 기다리는 기본 상한 — 대화형 실행 상한(기본 5분, WORKPLACE_AI_TIMEOUT_MS)보다 넉넉히 둔다. */
export const DEFAULT_MAX_RUN_MS = 15 * 60 * 1000;

/** 실행 하나를 상한 시간 안에서 기다린다 — 넘으면 오류로 끝난 것으로 본다(멈춘 실행 자체는 끊지 못한다). */
export async function runWithLimit<E>(run: (event: E) => Promise<unknown>, event: E, maxRunMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`실행이 ${maxRunMs}ms 안에 끝나지 않음`)), maxRunMs);
  });
  try {
    await Promise.race([run(event), limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** 키 하나의 상태 — 실행 중에 온 가장 최근 이벤트(없으면 null). */
interface Slot<E> {
  pending: E | null;
}

export interface RunCoalescer<E> {
  /**
   * 이벤트를 넣는다. 같은 키가 실행 중이면 새로 띄우지 않고 가장 최근 이벤트만 기억한다.
   * WP-1828: 새 실행을 시작했으면 합쳐진 재실행까지 끝난 뒤 정해지는 promise(실패면 첫 오류로 reject)를, 합쳐졌으면 undefined 를 돌려준다.
   * 돌려주는 promise 는 미리 거부 처리가 붙어 있어 호출부가 무시해도 unhandled rejection 이 되지 않는다.
   */
  submit(event: E): Promise<void> | undefined;
  /** 실행 중인 키 수(테스트·진단용). */
  activeKeys(): number;
}

/**
 * 키별 실행 합치기를 만든다.
 * - 키에 실행이 없으면 바로 실행한다.
 * - 실행 중에 같은 키로 오면 「밀린 이벤트」를 가장 최근 것으로 덮어쓴다(몇 개가 쌓여도 다시 실행은 한 번).
 * - 실행이 끝나면(성공·오류 모두) 밀린 이벤트가 있으면 그것으로 다시 실행하고, 없으면 키를 비운다.
 * - 다시 실행까지 포함한 전체를 trackInflight 로 등록해, 서버 종료가 밀린 실행까지 기다리게 한다(WP-167).
 */
export function createRunCoalescer<E>(
  keyOf: (event: E) => string,
  run: (event: E) => Promise<unknown>,
  onError: (event: E, error: unknown) => void,
  // 한 실행을 기다리는 상한 — 실행이 끝나지 않으면(바깥 호출이 멈춤 등) 키가 영영 잡혀 그 대화의 답이 끊기므로,
  // 이 시간이 지나면 오류로 보고 다음(밀린 실행·키 정리)으로 넘어간다. 멈춘 실행 자체는 끊지 못하고 뒤에서 마저 돈다.
  maxRunMs: number = DEFAULT_MAX_RUN_MS,
): RunCoalescer<E> {
  const slots = new Map<string, Slot<E>>();

  /**
   * 키의 실행을 밀린 이벤트가 없을 때까지 차례로 돌린다.
   * WP-1828: 첫 실패를 기억해 키를 비운 뒤 다시 던진다 — 그래야 첫 이벤트의 promise 가 합쳐진 재실행까지 끝난 뒤 정해져
   * 재실행 동안 첫 이벤트의 기록 범위가 열려 있다.
   */
  async function drain(key: string, slot: Slot<E>, first: E): Promise<void> {
    let current: E | null = first;
    let failed = false;
    let firstErr: unknown;
    while (current) {
      try {
        await runWithLimit(run, current, maxRunMs);
      } catch (e) {
        // 오류로 끝나도 밀린 이벤트는 돌리고 키는 정리해야 하므로 여기서 삼킨다.
        onError(current, e);
        if (!failed) {
          failed = true;
          firstErr = e;
        }
      }
      current = slot.pending;
      slot.pending = null;
    }
    // pending 확인과 삭제 사이에 await 가 없어, 그 틈에 submit 이 끼어 이벤트를 잃는 일은 없다(단일 스레드).
    slots.delete(key);
    if (failed) throw firstErr;
  }

  return {
    submit(event) {
      const key = keyOf(event);
      const busy = slots.get(key);
      if (busy) {
        busy.pending = event;
        return undefined;
      }
      const slot: Slot<E> = { pending: null };
      slots.set(key, slot);
      const p = drain(key, slot, event);
      void trackInflight(p);
      p.catch(() => undefined); // 호출부가 안 봐도 unhandled rejection 이 되지 않게
      return p;
    },
    activeKeys: () => slots.size,
  };
}
