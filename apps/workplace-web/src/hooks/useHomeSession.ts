import { useCallback, useEffect, useState } from 'react';

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

  // 마운트 시 기본 구성 1회 로드(AI 미호출, 7c 동작 유지).
  useEffect(() => {
    loadDefault(defaultSpecs);
  }, [loadDefault, defaultSpecs]);

  // 챗 명령 → compose. 성공 시 sessionId 추적 + assistant 턴 + 캔버스 재구성.
  const submitQuery = useCallback(
    (query: string) => {
      setTurns((t) => [...t, { role: 'user', content: query }]);
      compose.mutate(
        { sessionId, query },
        {
          onSuccess: (res) => {
            setSessionId(res.sessionId);
            setTurns((t) => [...t, { role: 'assistant', content: res.message }]);
            apply(res.widgets);
          },
        },
      );
    },
    [compose, sessionId, apply],
  );

  // 새 세션 — 로컬 리셋만(POST 안 함; 첫 compose 가 서버에서 세션 생성).
  const newSession = useCallback(() => {
    setSessionId(null);
    setTurns([]);
    loadDefault(defaultSpecs);
  }, [loadDefault, defaultSpecs]);

  // 복원 — 메시지 fetch → transcript 재현 + 위젯 배치 fold(AI 재호출 없음).
  const restoreSession = useCallback(
    async (id: string) => {
      try {
        const { data } = await homeApi.sessionMessages(id);
        const { turns: restored, widgetBatches } = parseRestoredSession(data);
        setSessionId(id);
        setTurns(restored);
        restore(defaultSpecs, widgetBatches);
      } catch (err) {
        handleApiError(err, '세션을 불러오지 못했어요');
      }
    },
    [restore, defaultSpecs],
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
