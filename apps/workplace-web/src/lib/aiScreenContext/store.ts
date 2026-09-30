// 화면 컨텍스트 store(WP-54) — React 밖 순수 TS 라 vitest(node)로 검증한다.
// - 등록자(토큰)별 컨텍스트를 삽입 순서 Map 으로 보관하고, 가장 최근 등록자의 값을 현재 컨텍스트로 쓴다.
//   → 화면 전환 시 이전 화면의 뒤늦은 cleanup 은 자기 항목만 지우므로 새 화면 컨텍스트가 유지되고,
//     한 화면에 등록자가 둘(목록 + 열린 패널)이어도 패널이 닫히면 목록 컨텍스트로 자연 복귀한다.
// - JSON 직렬화 비교로 현재 값이 실제로 바뀐 경우에만 구독자에게 알린다(렌더 루프 방지).
import type { AiScreenContext } from '@/types/aiScreenContext';

export interface ScreenContextStore {
  set(token: symbol, ctx: AiScreenContext | null): void;
  release(token: symbol): void;
  get(): AiScreenContext | null;
  subscribe(fn: () => void): () => void;
}

export function createScreenContextStore(): ScreenContextStore {
  const entries = new Map<symbol, AiScreenContext>();
  let current: AiScreenContext | null = null;
  let currentKey: string | null = null;
  const listeners = new Set<() => void>();

  // 가장 최근 등록 항목을 현재 값으로 재계산 — 내용이 같으면 참조·알림 유지.
  const recompute = () => {
    const last = [...entries.values()].pop() ?? null;
    const key = last ? JSON.stringify(last) : null;
    if (key === currentKey) return;
    current = last;
    currentKey = key;
    listeners.forEach((fn) => fn());
  };

  return {
    set(token, ctx) {
      if (!ctx) {
        entries.delete(token);
      } else {
        const prev = entries.get(token);
        // 같은 토큰의 동일 내용 재등록은 순서를 바꾸지 않는다(다른 등록자보다 앞질러 가지 않게).
        if (prev && JSON.stringify(prev) === JSON.stringify(ctx)) return;
        entries.delete(token); // 새 값은 "가장 최근" 으로 이동
        entries.set(token, ctx);
      }
      recompute();
    },
    release(token) {
      if (entries.delete(token)) recompute();
    },
    get: () => current,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
