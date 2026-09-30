// 화면 컨텍스트 훅(WP-54). 등록 측(페이지)은 store 참조만 구독하므로 컨텍스트 값 변경으로 리렌더되지 않고,
// 읽기 측(AI 패널)만 useSyncExternalStore 로 값을 구독한다.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { ScreenContextStore } from '@/lib/aiScreenContext/store';
import type { AiScreenContext } from '@/types/aiScreenContext';

export const AiScreenContextStoreContext = createContext<ScreenContextStore | null>(null);

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;

/** 페이지가 현재 화면 컨텍스트를 등록한다. 언마운트 시 자동 해제. Provider 밖이면 no-op. */
export function useRegisterAiScreenContext(ctx: AiScreenContext | null): void {
  const store = useContext(AiScreenContextStoreContext);
  // 등록자 토큰 — 마운트 동안 고정(지연 초기화라 렌더마다 Symbol 을 새로 만들지 않는다).
  const [token] = useState(() => Symbol('ai-screen-context'));
  // 직렬화 키를 의존성으로 — 페이지가 매 렌더 새 객체를 만들어도 내용이 같으면 effect 가 돌지 않는다.
  const key = ctx ? JSON.stringify(ctx) : null;
  // 최신 ctx 객체 — 키가 바뀐 커밋에서 그 객체를 그대로 넘긴다(JSON.parse 왕복 불필요).
  // 아래 등록 effect 보다 먼저 선언되어 같은 커밋에서 먼저 갱신된다.
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  useEffect(() => {
    if (!store) return;
    store.set(token, ctxRef.current);
  }, [store, token, key]);

  useEffect(() => {
    if (!store) return;
    return () => store.release(token);
  }, [store, token]);
}

/** AI 패널이 현재 화면 컨텍스트를 읽는다(없으면 null). */
export function useAiScreenContext(): AiScreenContext | null {
  const store = useContext(AiScreenContextStoreContext);
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.get ?? nullSnapshot);
}
