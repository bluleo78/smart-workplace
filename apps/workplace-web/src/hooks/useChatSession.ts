import { useCallback, useRef, useState } from 'react';

import { homeApi } from '@/api/home';
import { useDeleteSession, useHomeCompose } from '@/hooks/queries/useHomeQueries';
import { handleApiError } from '@/lib/api-error';
import type { ChatTurn } from '@/types/home';

/**
 * 챗 전용 세션 상태 코디네이터 — sessionId / 대화 transcript 를 한 곳에서 전이.
 * (구 홈 세션 훅에서 캔버스 결합을 떼어낸 챗-only 버전. 캔버스/위젯 의존 없음.)
 * AppLayout 레벨에서 1회 생성해 컨텍스트로 공유 — side/fullscreen 패널이 같은 세션을 본다.
 */
export function useChatSession() {
  const compose = useHomeCompose();
  const del = useDeleteSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  // '새 대화' 전이 신호(nonce) — newSession() 호출마다 증가. 패널 로컬 입력(미전송 초안)을
  // effect 로 비우기 위한 트리거. 신선한(아직 compose 안 한) 세션에서 sessionId/turns 는
  // 이미 빈 값이라 prop 변화가 패널에 보이지 않으므로, 명시적 카운터로 전이를 전달한다(#204).
  const [newSessionNonce, setNewSessionNonce] = useState(0);
  // 작업 세대 카운터 — 사용자 전이(compose/새세션/복원)마다 증가. 비동기 결과는
  // 자신이 캡처한 세대가 여전히 최신일 때만 반영(in-flight compose 와 세션 전환의 레이스로
  // stale 응답이 복원/리셋 상태를 덮어쓰는 것 방지).
  const opSeq = useRef(0);

  // 챗 명령 → compose. 성공 시 sessionId 추적 + assistant 턴 추가(캔버스 재구성 없음).
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
          },
        },
      );
    },
    [compose, sessionId],
  );

  // 새 세션 — 로컬 리셋만(POST 안 함; 첫 compose 가 서버에서 세션 생성). in-flight 작업 무효화.
  const newSession = useCallback(() => {
    opSeq.current++;
    // in-flight compose 의 mutation 상태(isPending) 초기화 — 누수된 pending 이 새 세션
    // 입력을 잠그는 것 방지(#196). 응답 데이터는 submitQuery 의 opSeq 가드가 폐기한다.
    compose.reset();
    setSessionId(null);
    setTurns([]);
    // '새 대화'는 깨끗한 빈 입력으로 시작해야 하므로 패널 로컬 입력 초기화 신호 발행(#204).
    // restoreSession(세션 선택)/submit 에서는 발행하지 않아 세션별 초안 보존(by-design)을 깨지 않는다.
    setNewSessionNonce((n) => n + 1);
  }, [compose]);

  // 복원 — 메시지 fetch → transcript 재현(AI 재호출 없음, 위젯 fold 없음).
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
        const restored: ChatTurn[] = data.map((m) => ({
          role: m.role === 'ASSISTANT' ? 'assistant' : 'user',
          content: m.content,
        }));
        setSessionId(id);
        setTurns(restored);
      } catch (err) {
        handleApiError(err, '세션을 불러오지 못했어요');
      }
    },
    [compose],
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
    sessionId,
    turns,
    newSessionNonce,
    pending: compose.isPending,
    submitQuery,
    newSession,
    restoreSession,
    deleteSession,
  };
}
