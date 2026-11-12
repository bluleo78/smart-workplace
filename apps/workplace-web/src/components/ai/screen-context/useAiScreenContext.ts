// 화면 컨텍스트 훅(WP-54). 등록 측(페이지)은 store 참조만 구독하므로 컨텍스트 값 변경으로 리렌더되지 않고,
// 읽기 측(AI 패널)만 useSyncExternalStore 로 값을 구독한다.
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';

import type { ScreenContextLayer, ScreenContextStore } from '@/lib/aiScreenContext/store';
import type { AiHelpContext, AiScreenContext } from '@/types/aiScreenContext';

export const AiScreenContextStoreContext = createContext<ScreenContextStore | null>(null);

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;

/**
 * 스토어 등록 공통 훅(비공개) — 토큰을 마운트 동안 고정하고, 값이 바뀔 때마다 apply 로 등록하고 언마운트 때 release 로 해제한다.
 * 같은 내용의 재등록은 스토어가 JSON 키로 걸러 순서·알림을 바꾸지 않으므로(store.set·setHelp) 여기서는 렌더마다 직렬화하지 않고 값 참조만 의존성으로 둔다.
 * Provider 밖이면 no-op. apply·release 는 모듈 상수 함수라 의존성에 넣지 않는다.
 */
function useStoreRegistration<T>(
  name: string,
  value: T,
  apply: (store: ScreenContextStore, token: symbol, value: T) => void,
  release: (store: ScreenContextStore, token: symbol) => void,
): void {
  const store = useContext(AiScreenContextStoreContext);
  // 등록자 토큰 — 마운트 동안 고정(지연 초기화라 렌더마다 Symbol 을 새로 만들지 않는다).
  const [token] = useState(() => Symbol(name));

  useEffect(() => {
    if (!store) return;
    apply(store, token, value);
  }, [store, token, value, apply]);

  useEffect(() => {
    if (!store) return;
    return () => release(store, token);
  }, [store, token, release]);
}

const releasePage: (store: ScreenContextStore, token: symbol) => void = (store, token) => store.release(token);
const releaseHelp: (store: ScreenContextStore, token: symbol) => void = (store, token) => store.releaseHelp(token);

/**
 * 페이지가 현재 화면 컨텍스트를 등록한다. 언마운트 시 자동 해제. Provider 밖이면 no-op.
 * layer='overlay'(WP-1261 첨부 미리 보기)면 페이지 컨텍스트를 대신하지 않고 그 위에 얹힌다(store 주석).
 */
export function useRegisterAiScreenContext(ctx: AiScreenContext | null, layer: ScreenContextLayer = 'page'): void {
  // 층이 바뀌면 다시 등록해야 하므로 값에 층을 함께 묶는다(layer 가 같고 ctx 참조가 같으면 같은 값).
  const apply = useCallback((store: ScreenContextStore, token: symbol, c: AiScreenContext | null) => store.set(token, c, layer), [layer]);
  useStoreRegistration('ai-screen-context', ctx, apply, releasePage);
}

/**
 * WP-1511: 도움말 패널·창이 도움말 층을 등록한다. 언마운트 시 자동 해제, Provider 밖이면 no-op.
 * null 이면 등록을 거둔다(releaseHelp).
 */
export function useRegisterAiHelpContext(help: AiHelpContext | null): void {
  useStoreRegistration('ai-help-context', help, applyHelp, releaseHelp);
}

/** 도움말 층 등록 — null 이면 거둔다. */
function applyHelp(store: ScreenContextStore, token: symbol, help: AiHelpContext | null): void {
  if (help) store.setHelp(token, help);
  else store.releaseHelp(token);
}

/** AI 패널이 현재 화면 컨텍스트를 읽는다(없으면 null). */
export function useAiScreenContext(): AiScreenContext | null {
  const store = useContext(AiScreenContextStoreContext);
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.get ?? nullSnapshot);
}
