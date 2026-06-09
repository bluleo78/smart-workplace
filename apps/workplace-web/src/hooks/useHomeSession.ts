import { useCallback, useEffect, useRef, useState } from 'react';

import { homeApi } from '@/api/home';
import { useDeleteSession, useHomeCompose } from '@/hooks/queries/useHomeQueries';
import { useCanvasState } from '@/hooks/useCanvasState';
import { handleApiError } from '@/lib/api-error';
import { parseRestoredSession } from '@/lib/home-restore';
import type { ChatTurn, WidgetSpec } from '@/types/home';

/**
 * 홈 세션 상태 코디네이터 — sessionId / 대화 transcript / 캔버스를 한 곳에서 전이.
 * defaultSpecs 는 안정 참조(모듈 const)여야 한다(마운트 effect/콜백 deps 안정).
 */
export function useHomeSession(defaultSpecs: WidgetSpec[]) {
  const canvas = useCanvasState();
  const { loadDefault, apply, restore } = canvas;
  const compose = useHomeCompose();
  const del = useDeleteSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  // 작업 세대 카운터 — 사용자 전이(compose/새세션/복원)마다 증가. 비동기 결과는
  // 자신이 캡처한 세대가 여전히 최신일 때만 반영(in-flight compose 와 세션 전환의 레이스로
  // stale 응답이 복원/리셋 상태를 덮어쓰는 것 방지).
  const opSeq = useRef(0);

  // 마운트 시 기본 구성 1회 로드(AI 미호출, 7c 동작 유지).
  useEffect(() => {
    loadDefault(defaultSpecs);
  }, [loadDefault, defaultSpecs]);

  // 챗 명령 → compose. 성공 시 sessionId 추적 + assistant 턴 + 캔버스 재구성.
  const submitQuery = useCallback(
    (query: string) => {
      const gen = ++opSeq.current;
      setTurns((t) => [...t, { role: 'user', content: query }]);
      compose.mutate(
        { sessionId, query },
        {
          onSuccess: (res) => {
            // 응답 도착 사이에 새세션/복원이 일어났으면 이 compose 결과는 폐기.
            if (opSeq.current !== gen) return;
            setSessionId(res.sessionId);
            setTurns((t) => [...t, { role: 'assistant', content: res.message }]);
            apply(res.widgets);
          },
        },
      );
    },
    [compose, sessionId, apply],
  );

  // 새 세션 — 로컬 리셋만(POST 안 함; 첫 compose 가 서버에서 세션 생성). in-flight 작업 무효화.
  const newSession = useCallback(() => {
    opSeq.current++;
    // in-flight compose 의 mutation 상태(isPending) 초기화 — 누수된 pending 이 새 세션
    // 입력을 잠그는 것 방지(#196). 응답 데이터는 submitQuery 의 opSeq 가드가 폐기한다.
    compose.reset();
    setSessionId(null);
    setTurns([]);
    loadDefault(defaultSpecs);
  }, [loadDefault, defaultSpecs, compose]);

  // 복원 — 메시지 fetch → transcript 재현 + 위젯 배치 fold(AI 재호출 없음).
  const restoreSession = useCallback(
    async (id: string) => {
      const gen = ++opSeq.current;
      // 전환 직전 in-flight compose pending 초기화 — 복원된 세션에 '구성 중…'이
      // 잘못 붙거나 입력이 잠기는 것 방지(#196).
      compose.reset();
      try {
        const { data } = await homeApi.sessionMessages(id);
        // fetch 중 더 최신 전이가 있었으면 폐기.
        if (opSeq.current !== gen) return;
        const { turns: restored, widgetBatches } = parseRestoredSession(data);
        setSessionId(id);
        setTurns(restored);
        restore(defaultSpecs, widgetBatches);
      } catch (err) {
        handleApiError(err, '세션을 불러오지 못했어요');
      }
    },
    [restore, defaultSpecs, compose],
  );

  // 삭제 — 활성 세션이면 새 세션으로 리셋.
  const deleteSession = useCallback(
    (id: string) => {
      del.mutate(id, {
        onSuccess: () => {
          if (id === sessionId) newSession();
        },
      });
    },
    [del, sessionId, newSession],
  );

  return {
    pages: canvas.pages,
    activeIndex: canvas.activeIndex,
    setActive: canvas.setActive,
    sessionId,
    turns,
    pending: compose.isPending,
    submitQuery,
    newSession,
    restoreSession,
    deleteSession,
  };
}
