import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { homeApi } from '@/api/home';
import { composeStream, homeKeys, useDeleteSession } from '@/hooks/queries/useHomeQueries';
import { handleApiError } from '@/lib/api-error';
import type { ChatTurn } from '@/types/home';

/**
 * 챗 전용 세션 상태 코디네이터 — sessionId / 대화 transcript 를 한 곳에서 전이.
 * (구 홈 세션 훅에서 캔버스 결합을 떼어낸 챗-only 버전. 캔버스/위젯 의존 없음.)
 * AppLayout 레벨에서 1회 생성해 컨텍스트로 공유 — side/fullscreen 패널이 같은 세션을 본다.
 */
export function useChatSession() {
  const del = useDeleteSession();
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  // 스트리밍 pending 상태 — 구 compose.isPending 대체.
  const [pending, setPending] = useState(false);
  // '새 대화' 전이 신호(nonce) — newSession() 호출마다 증가. 패널 로컬 입력(미전송 초안)을
  // effect 로 비우기 위한 트리거. 신선한(아직 compose 안 한) 세션에서 sessionId/turns 는
  // 이미 빈 값이라 prop 변화가 패널에 보이지 않으므로, 명시적 카운터로 전이를 전달한다(#204).
  const [newSessionNonce, setNewSessionNonce] = useState(0);
  // 작업 세대 카운터 — 사용자 전이(compose/새세션/복원)마다 증가. 비동기 결과는
  // 자신이 캡처한 세대가 여전히 최신일 때만 반영(in-flight compose 와 세션 전환의 레이스로
  // stale 응답이 복원/리셋 상태를 덮어쓰는 것 방지).
  const opSeq = useRef(0);
  // sessionId ref — submitQuery 의 클로저에서 최신 sessionId 를 읽기 위한 미러.
  // setSessionId(state) 는 비동기이므로 클로저 캡처 시 stale 값을 참조할 수 있다.
  const sessionIdRef = useRef<string | null>(null);
  // 진행 중인 SSE 스트림의 AbortController — newSession/restoreSession 시 취소.
  const abortRef = useRef<AbortController | null>(null);

  // sessionIdRef 를 sessionId state 와 동기화하는 헬퍼.
  const updateSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  // 챗 명령 → SSE compose. 빈 assistant 턴을 먼저 추가하고,
  // delta 마다 마지막 턴의 content 에 누적 → done 에서 sessionId 확정.
  const submitQuery = useCallback(
    (query: string) => {
      const gen = ++opSeq.current;
      // 사용자 턴 + 빈 어시스턴트 턴을 즉시 추가 — 빈 어시스턴트 턴이 있을 때만 3-dot 표시.
      setTurns((t) => [...t, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
      const ac = new AbortController();
      abortRef.current = ac;
      setPending(true);
      composeStream(
        { sessionId: sessionIdRef.current, query },
        (delta) => {
          // stale 세대(newSession/restore 가 끼어든 경우)면 델타를 버린다.
          if (opSeq.current !== gen) return;
          setTurns((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (!last || last.role !== 'assistant') return t; // 방어 — turns 가 리셋된 경우 skip.
            next[next.length - 1] = { role: 'assistant', content: last.content + delta };
            return next;
          });
        },
        ac.signal,
      )
        .then((r) => {
          if (opSeq.current !== gen) return; // stale 세대 폐기
          if (r.sessionId) {
            updateSessionId(r.sessionId);
            // 새 세션 생성 / 마지막 메시지 시각 갱신을 세션 스위처 목록에 반영.
            void qc.invalidateQueries({ queryKey: homeKeys.sessions() });
          }
        })
        .catch((e: unknown) => {
          // AbortError 는 의도적 취소이므로 무시, 그 외는 토스트.
          if ((e as Error).name !== 'AbortError') {
            handleApiError(e, 'AI 구성에 실패했습니다');
          }
        })
        .finally(() => {
          if (opSeq.current === gen) setPending(false);
        });
    },
    [qc, updateSessionId],
  );

  // 새 세션 — 로컬 리셋만(POST 안 함; 첫 compose 가 서버에서 세션 생성). in-flight 작업 무효화.
  const newSession = useCallback(() => {
    opSeq.current++;
    // in-flight SSE 스트림 취소 — 취소 후 stale 델타가 빈 turns 배열에 접근하는 것 방지.
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    updateSessionId(null);
    setTurns([]);
    // '새 대화'는 깨끗한 빈 입력으로 시작해야 하므로 패널 로컬 입력 초기화 신호 발행(#204).
    // restoreSession(세션 선택)/submit 에서는 발행하지 않아 세션별 초안 보존(by-design)을 깨지 않는다.
    setNewSessionNonce((n) => n + 1);
  }, [updateSessionId]);

  // 복원 — 메시지 fetch → transcript 재현(AI 재호출 없음, 위젯 fold 없음).
  const restoreSession = useCallback(
    async (id: string) => {
      const gen = ++opSeq.current;
      // in-flight SSE 스트림 취소 — 복원된 세션에 구 스트림 델타가 섞이는 것 방지.
      abortRef.current?.abort();
      abortRef.current = null;
      setPending(false);
      try {
        const { data } = await homeApi.sessionMessages(id);
        // fetch 중 더 최신 전이가 있었으면 폐기.
        if (opSeq.current !== gen) return;
        const restored: ChatTurn[] = data.map((m) => ({
          role: m.role === 'ASSISTANT' ? 'assistant' : 'user',
          content: m.content,
        }));
        updateSessionId(id);
        setTurns(restored);
      } catch (err) {
        handleApiError(err, '세션을 불러오지 못했습니다');
      }
    },
    [updateSessionId],
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
    pending,
    submitQuery,
    newSession,
    restoreSession,
    deleteSession,
  };
}
