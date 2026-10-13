// 빈 AI 대화 추천 훅(WP-139) — 저장된 AI 결과(없으면 고정 문구)를 즉시 돌려주고, 필요할 때만(오늘 것이 없고 그날 실패하지 않음) 300ms 뒤
// 추천을 요청해 한 번 교체한다. 포인터·포커스가 목록에 있으면 교체를 미룬다(settleStarterView). 패널이 열려 빈 새 대화가 보일 때만 부른다
// — AIChatPanel 은 패널이 열린 동안만 마운트되므로 visible 이 곧 그 조건이다.
import { useQueryClient } from '@tanstack/react-query';
import { type FocusEvent, useEffect, useRef, useState } from 'react';

import { fetchStarterSuggestions } from '@/api/aiSuggestions';
import { aiPreferenceKeys } from '@/hooks/queries/useAiPreferences';
import { useAuth } from '@/hooks/useAuth';
import { starterStore } from '@/lib/ai/starterStorage';
import { fixedStarters, settleStarterView, starterContextKey, starterHeading, type StarterView } from '@/lib/ai/starterSuggestions';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type { AiPreferences } from '@/types/aiSuggestions';

/** 화면 이동·칩 전환이 이어질 때 마지막 대상만 부른다. */
const DEBOUNCE_MS = 300;

export interface StarterSuggestions {
  heading: string;
  items: string[];
  /** 목록 컨테이너에 펼치는 교체 보류 이벤트. */
  holdProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: (e: FocusEvent<HTMLElement>) => void;
  };
}

/**
 * @param ctx 화면 참고 칩이 켜져 있을 때의 컨텍스트(아니면 null) — 전송 규칙과 같다
 * @param visible 목록이 보이는가 — 추천 켜짐(설정 응답 true) && 빈 새 대화(세션 없음·턴 없음). 거짓이면 생성 요청을 하지 않는다
 */
export function useStarterSuggestions({
  ctx,
  visible,
}: {
  ctx: AiScreenContext | null;
  visible: boolean;
}): StarterSuggestions {
  const qc = useQueryClient();
  const { user, activeTenant } = useAuth();
  // 저장 소유자 — 사용자·워크스페이스별로 나눠 다른 계정·테넌트의 추천이 섞이지 않게 한다(starterStorage 키 규칙).
  const owner = user ? `${user.id}:${activeTenant?.tenantId ?? 0}` : null;
  const key = starterContextKey(ctx);
  const viewKey = `${owner ?? '-'}|${key}`;

  const initial = (): StarterView => ({
    key: viewKey,
    shown: (owner ? starterStore.peek(owner, key)?.items : undefined) ?? fixedStarters(ctx),
    incoming: null,
  });
  const [view, setView] = useState<StarterView>(initial);
  const [pointerIn, setPointerIn] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  // 요청 본문용 최신 컨텍스트 — 효과는 키(화면 정체성)에만 의존한다. ctx 객체는 렌더마다 새로 만들어질 수 있어(건수·facts 변화,
  // 이 훅의 hover 상태 변경으로 인한 재렌더) 의존성에 넣으면 300ms 타이머가 계속 다시 걸린다.
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  if (view.key !== viewKey) {
    // 대상이 바뀌면 렌더 중 조정 — 그 대상의 저장 결과 또는 고정 문구를 한 프레임도 늦지 않게 보인다(AIChatPanel 의 prevIdentity 패턴).
    setView(initial());
  } else {
    // 도착한 AI 결과 반영 — 보류 중이 아니면 한 번 교체(수렴: 같은 참조면 setState 하지 않는다). 키 전환 렌더에서는 하지 않는다
    // (옛 view 로 계산한 값이 방금 만든 initial() 을 덮지 않게).
    const settled = settleStarterView(view, pointerIn || focusIn);
    if (settled !== view) setView(settled);
  }

  useEffect(() => {
    if (!visible || !owner) return;
    // 오늘 받은 결과가 있거나 오늘 이미 실패했으면 부르지 않는다 — 타이머 안에서 다시 본다(그 300ms 사이 다른 마운트의 요청이 끝났을 수 있다).
    const settledToday = () => !!starterStore.peek(owner, key)?.fresh || starterStore.failedToday(owner, key);
    if (settledToday()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (settledToday()) return;
      const ctxNow = ctxRef.current;
      void starterStore
        .run(owner, key, async () => {
          const r = await fetchStarterSuggestions(ctxNow ? { screenContext: ctxNow } : {});
          // 서버가 꺼짐을 알려 주면(다른 기기에서 끔) 설정 캐시를 바꿔 목록을 숨기고 이후 호출하지 않는다(설정 화면에서 켜면 다시 받는다).
          if (!r.enabled) qc.setQueryData<AiPreferences>(aiPreferenceKeys.me, { suggestionsEnabled: false });
          return r.enabled ? r.items : [];
        })
        .then((items) => {
          // 컴포넌트가 사라져도 결과는 run 이 이미 저장했다 — 화면 반영만 건너뛴다.
          if (!cancelled && items.length) setView((v) => ({ ...v, incoming: { key: `${owner}|${key}`, items } }));
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, owner, key, qc]);

  return {
    heading: starterHeading(ctx),
    items: view.shown,
    holdProps: {
      onPointerEnter: () => setPointerIn(true),
      onPointerLeave: () => setPointerIn(false),
      onFocus: () => setFocusIn(true),
      // 목록 안의 다른 행으로 옮기는 포커스는 보류를 유지한다.
      onBlur: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
      },
    },
  };
}
