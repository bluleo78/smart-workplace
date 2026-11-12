// 화면이 「AI 가 열어 줄 수 있는 대화상자」를 등록하는 등록부(WP-1511).
// 화면(대화상자를 가진 컴포넌트)이 useAiDialogTarget 으로 id·열기 함수·기준 단추를 등록하면,
// (1) AI 화면 참고 help.dialogs 에 id·라벨이 실려 AI 가 이 화면에서 열 수 있는 창만 알고,
// (2) AI 답의 「창 열기」 단추가 useAiDialogTargetLookup 으로 열기 함수를 찾아 사용자가 누를 때만 연다.
// 등록은 허용 목록(AI_DIALOG_TARGETS)의 id 만 받는다. 화면이 사라지면(언마운트·null 등록) 등록도 사라진다.
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useRegisterAiHelpContext } from '@/components/ai/screen-context/useAiScreenContext';
import { AI_DIALOG_TARGETS, type AiDialogTargetId } from '@/lib/aiDialogTargets';
import { LIMITS } from '@/lib/aiScreenContext/common';

/** 화면이 등록하는 값 — open 은 창을 여는 함수, anchor 는 그 창을 여는 화면 쪽 단추(없으면 null), isOpen 은 창이 이미 열려 있는지(모르면 생략 — 늘 닫힌 것으로 본다). */
export type AiDialogTarget = { open: () => void; anchor: RefObject<HTMLElement | null>; isOpen?: () => boolean };
/** 찾아 준 값 — anchor 는 찾는 순간의 요소, isOpen 은 누르는 순간의 열림 여부. */
export type AiDialogTargetHandle = { open: () => void; anchor: HTMLElement | null; isOpen: () => boolean };

/** 등록부 — id → 등록 목록(삽입 순서). 같은 id 를 여럿이 등록하면 마지막 것이 이긴다. 누를 때 읽으므로 구독은 두지 않는다. */
type Registry = {
  register(id: AiDialogTargetId, token: symbol, entry: () => AiDialogTargetHandle): void;
  release(id: AiDialogTargetId, token: symbol): void;
  lookup(id: AiDialogTargetId): AiDialogTargetHandle | null;
};

function createRegistry(): Registry {
  const map = new Map<AiDialogTargetId, Map<symbol, () => AiDialogTargetHandle>>();
  return {
    register(id, token, entry) {
      let list = map.get(id);
      if (!list) map.set(id, (list = new Map()));
      // 다시 등록하면 맨 뒤로 — 삽입 순서가 곧 「마지막이 이긴다」 순서다.
      list.delete(token);
      list.set(token, entry);
    },
    release(id, token) {
      const list = map.get(id);
      if (!list) return;
      list.delete(token);
      if (list.size === 0) map.delete(id);
    },
    lookup(id) {
      const list = map.get(id);
      if (!list || list.size === 0) return null;
      const last = [...list.values()].at(-1);
      return last ? last() : null;
    },
  };
}

const RegistryContext = createContext<Registry | null>(null);

/** 앱 셸에 등록부를 1개 둔다 — AiScreenContextProvider 안쪽(도움말 층 등록이 그 store 를 쓴다). */
export function AiDialogTargetsProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createRegistry);
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

/**
 * 화면이 열 수 있는 창을 등록한다. target 이 null 이면 등록하지 않는다(열 수 없는 상태 — 읽기 전용 등).
 * 등록하면 화면 참고 help.dialogs 에도 id·라벨(상한 안)을 싣는다. Provider 밖이면 등록부는 no-op 이다.
 * 최신 target 은 ref 로 읽어 매 렌더 재등록하지 않는다.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAiDialogTarget(id: AiDialogTargetId, target: AiDialogTarget | null): void {
  const registry = useContext(RegistryContext);
  const [token] = useState(() => Symbol('ai-dialog-target'));
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });
  const active = target !== null;

  useEffect(() => {
    if (!registry || !active) return;
    registry.register(id, token, () => {
      const t = targetRef.current;
      return { open: () => targetRef.current?.open(), anchor: t?.anchor.current ?? null, isOpen: () => targetRef.current?.isOpen?.() ?? false };
    });
    return () => registry.release(id, token);
  }, [registry, id, token, active]);

  // 라벨은 화면 참고 상한(LIMITS.helpDialogLabel)까지만 싣는다. 개수 상한은 store 의 병합이 지킨다(LIMITS.helpDialogs).
  const help = useMemo(
    () => (active ? { dialogs: [{ id, label: AI_DIALOG_TARGETS[id].label.slice(0, LIMITS.helpDialogLabel) }] } : null),
    [active, id],
  );
  useRegisterAiHelpContext(help);
}

/** 단추가 열 창을 찾는 함수 — 누를 때 부른다. 지금 화면에 등록된 창이 아니면 null(단추를 그리지 않거나 비활성). */
// eslint-disable-next-line react-refresh/only-export-components
export function useAiDialogTargetLookup(): (id: AiDialogTargetId) => AiDialogTargetHandle | null {
  const registry = useContext(RegistryContext);
  return useCallback((id) => registry?.lookup(id) ?? null, [registry]);
}
