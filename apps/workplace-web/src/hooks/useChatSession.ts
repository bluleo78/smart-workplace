import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { homeApi } from '@/api/home';
import { chatStream, homeKeys, useDeleteSession } from '@/hooks/queries/useHomeQueries';
import { widgetTypeFromToolName } from '@/lib/aiToolLabels';
import { handleApiError } from '@/lib/api-error';
import { pushTextBlock, pushWidgetBlock, reconcileBlocks } from '@/lib/chatBlocks';
import type { ChatTurn, PendingAction, ToolEventDto, WidgetSpec, WidgetType } from '@/types/home';

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
  // 스트리밍 pending 상태 — 구 AI chat isPending 대체.
  const [pending, setPending] = useState(false);
  // #351: 보류 확인 액션 배열 — 일괄 카드 렌더. 단건도 길이1 배열로 관리.
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const clearPendingActions = useCallback(() => setPendingActions([]), []);
  // '새 대화' 전이 신호(nonce) — newSession() 호출마다 증가. 패널 로컬 입력(미전송 초안)을
  // effect 로 비우기 위한 트리거. 신선한(아직 chat 안 한) 세션에서 sessionId/turns 는
  // 이미 빈 값이라 prop 변화가 패널에 보이지 않으므로, 명시적 카운터로 전이를 전달한다(#204).
  const [newSessionNonce, setNewSessionNonce] = useState(0);
  // 작업 세대 카운터 — 사용자 전이(chat/새세션/복원)마다 증가. 비동기 결과는
  // 자신이 캡처한 세대가 여전히 최신일 때만 반영(in-flight AI chat 과 세션 전환의 레이스로
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

  // 챗 명령 → SSE AI chat. 빈 assistant 턴을 먼저 추가하고,
  // delta 마다 마지막 턴의 content 에 누적 → done 에서 sessionId 확정.
  const submitQuery = useCallback(
    (query: string) => {
      const gen = ++opSeq.current;
      // 사용자 턴 + 빈 어시스턴트 턴을 즉시 추가 — 빈 어시스턴트 턴이 있을 때만 3-dot 표시.
      setTurns((t) => [...t, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
      const ac = new AbortController();
      abortRef.current = ac;
      setPending(true);
      setPendingActions([]);      // #351: 새 제출 — 이전 확인 카드 배열 폐기
      chatStream(
        { sessionId: sessionIdRef.current, query },
        (delta) => {
          // stale 세대(newSession/restore 가 끼어든 경우)면 델타를 버린다.
          if (opSeq.current !== gen) return;
          setTurns((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (!last || last.role !== 'assistant') return t; // 방어 — turns 가 리셋된 경우 skip.
            // ...last 로 steps/widgets 등 기존 필드 보존 — delta 가 turn 을 통째 교체하면
            // 도구 호출 단계(steps)가 최종 응답 도착 순간 사라진다(#449).
            // #463: 텍스트 블록 누적 — 직전 블록이 text 가 아닐 때만 새 블록 추가(현재 content 길이=슬라이스 오프셋).
            const contentBlocks = pushTextBlock(last.contentBlocks ?? [], last.content.length);
            next[next.length - 1] = { ...last, content: last.content + delta, contentBlocks };
            return next;
          });
        },
        ac.signal,
        (label) => {
          // #333 M2: stale 세대면 무시(델타와 동일 가드). 위임 진행 라벨을 마지막 어시스턴트 턴의
          // steps 에 delegation 단계로 추가 — ToolStepList 가 버블 안에 중첩 렌더.
          if (opSeq.current !== gen) return;
          setTurns((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (last?.role !== 'assistant') return t;
            const steps = [...(last.steps ?? []), { kind: 'delegation' as const, label }];
            next[next.length - 1] = { ...last, steps };
            return next;
          });
        },
        (actions) => {
          // #351: 보류 확인 액션들 수신 — 일괄 카드로 렌더.
          if (opSeq.current !== gen) return;
          setPendingActions(actions);
        },
        (evt: ToolEventDto) => {
          // tool SSE 이벤트 — start: running step 추가, result: 상태 갱신(done/error).
          if (opSeq.current !== gen) return;
          setTurns((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (last?.role !== 'assistant') return t;
            const steps = [...(last.steps ?? [])];
            // #461: 점진 렌더 — show_* 도구는 done 을 기다리지 않고 도착 즉시 위젯을 누적해
            // 인라인 렌더한다(체감 지연 단축). done 이벤트가 최종 위젯 목록으로 덮어쓰므로
            // (authoritative) 여기 누적은 조기 표시용이며 같은 순서·내용이라 깜빡임이 없다.
            let widgets = last.widgets;
            // #463: contentBlocks — 위젯 도착 시 pushWidgetBlock 으로 도착순 인터리브 유지.
            let contentBlocks = last.contentBlocks ?? [];
            if (evt.phase === 'start') {
              steps.push({ kind: 'tool', seq: evt.seq, toolName: evt.toolName, args: evt.args, status: 'running' });
              const wtype = evt.toolName ? widgetTypeFromToolName(evt.toolName) : null;
              if (wtype) {
                const w: WidgetSpec = {
                  type: wtype as WidgetType,
                  params: (evt.args?.params as Record<string, unknown>) ?? {},
                };
                const layout = evt.args?.layout as WidgetSpec['layout'] | undefined;
                if (layout) w.layout = layout;
                widgets = [...(last.widgets ?? []), w];
                // #463: 위젯 블록을 도착순으로 누적(텍스트 사이에 위젯이 오는 인터리브 지원).
                contentBlocks = pushWidgetBlock(contentBlocks, w);
              }
            } else {
              const idx = steps.findIndex((s) => s.kind === 'tool' && s.seq === evt.seq && s.status === 'running');
              if (idx !== -1) steps[idx] = { ...steps[idx], status: evt.isError ? 'error' : 'done' };
            }
            next[next.length - 1] = { ...last, steps, widgets, contentBlocks };
            return next;
          });
        },
      )
        .then((r) => {
          if (opSeq.current !== gen) return; // stale 세대 폐기
          // #431: done 이벤트의 위젯을 마지막 어시스턴트 턴에 부착 — 챗 도크가 인라인 렌더.
          // show_* 단독 응답은 content 가 빈 문자열이므로, 위젯이 있으면 빈 버블 대신 위젯이 보인다.
          // #463 I1: done 시 authoritative widgets(서버 #404 필터 후)로 contentBlocks 의 widget 블록 재조정.
          //   r.widgets 가 비어도(undefined/[]) 재조정 — 전부 필터된 경우 widget 블록 전부 제거.
          {
            const authoritative = r.widgets ?? [];
            setTurns((t) => {
              const next = [...t];
              const last = next[next.length - 1];
              if (last?.role !== 'assistant') return t; // 방어 — turns 리셋된 경우 skip.
              const contentBlocks = last.contentBlocks
                ? reconcileBlocks(last.contentBlocks, authoritative)
                : last.contentBlocks;
              next[next.length - 1] = { ...last, widgets: r.widgets, contentBlocks };
              return next;
            });
          }
          if (r.sessionId) {
            updateSessionId(r.sessionId);
            // 새 세션 생성 / 마지막 메시지 시각 갱신을 세션 스위처 목록에 반영.
            void qc.invalidateQueries({ queryKey: homeKeys.sessions() });
          }
        })
        .catch((e: unknown) => {
          // AbortError 는 의도적 취소이므로 무시, 그 외는 토스트 + 에러 버블 표시.
          if ((e as Error).name !== 'AbortError') {
            handleApiError(e, 'AI 구성에 실패했습니다');
            // 빈 어시스턴트 턴(로딩 중)을 에러 안내 텍스트로 교체 — 사용자가 상황 파악·재시도 가능.
            setTurns((t) => {
              const next = [...t];
              const last = next[next.length - 1];
              if (last?.role === 'assistant' && last.content === '') {
                next[next.length - 1] = {
                  role: 'assistant',
                  content: '응답 생성에 실패했습니다. 다시 시도해 주세요.',
                };
              }
              return next;
            });
          }
        })
        .finally(() => {
          if (opSeq.current === gen) {
            setPending(false);
          }
        });
    },
    [qc, updateSessionId],
  );

  // #335: 스트리밍 중단 — 사용자가 진행 중인 AI 응답을 멈춘다.
  // abort() 가 SSE fetch 를 끊으면 ai-agent 가 연결 종료를 감지해 Claude CLI 자식을 SIGTERM 한다.
  // opSeq 를 증가시켜 늦게 도착하는 델타/진행/액션을 stale 로 차단하고(부분 응답 오염 방지),
  // 누적된 부분 응답은 turns 에 그대로 남겨 '커밋'한다(새로고침 전까지 화면 보존).
  const stopStreaming = useCallback(() => {
    if (!abortRef.current) return; // 진행 중 스트림이 없으면 무시
    opSeq.current++;
    abortRef.current.abort();
    abortRef.current = null;
    setPending(false);
    setPendingActions([]); // #351: 중단 시 확인 카드 배열 폐기
    // 첫 토큰 전 중단이면 빈 어시스턴트 말풍선만 남으므로 중단 안내 문구로 대체한다.
    setTurns((t) => {
      const next = [...t];
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && last.content === '') {
        next[next.length - 1] = { role: 'assistant', content: '응답을 중단했어요.' };
      }
      return next;
    });
  }, []);

  // 새 세션 — 로컬 리셋만(POST 안 함; 첫 chat 이 서버에서 세션 생성). in-flight 작업 무효화.
  const newSession = useCallback(() => {
    opSeq.current++;
    // in-flight SSE 스트림 취소 — 취소 후 stale 델타가 빈 turns 배열에 접근하는 것 방지.
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setPendingActions([]); // #351: 새 세션 시 확인 카드 배열 초기화
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
      setPendingActions([]); // #351: 세션 복원 시 확인 카드 배열 초기화
      try {
        const { data } = await homeApi.sessionMessages(id);
        // fetch 중 더 최신 전이가 있었으면 폐기.
        if (opSeq.current !== gen) return;
        // #431: 복원 시에도 ASSISTANT 위젯을 함께 재현(서버가 widgets 영속) — 빈 버블 방지.
        // toolCalls → steps 매핑: 서버가 영속한 도구 호출 단계를 인라인 표시로 복원.
        const restored: ChatTurn[] = data.map((m) => ({
          role: m.role === 'ASSISTANT' ? 'assistant' : 'user',
          content: m.content,
          widgets: m.widgets ?? undefined,
          steps: m.toolCalls ?? undefined,
        }));
        updateSessionId(id);
        setTurns(restored);
      } catch (err) {
        handleApiError(err, '세션을 불러오지 못했습니다');
      }
    },
    [updateSessionId],
  );

  // #351: 단일 항목 승인 — 기존 엔드포인트 1건 POST. 성공 시 카드에서 제거, 실패 시 유지.
  const confirmActionItem = useCallback((action: PendingAction) => {
    const gen = opSeq.current;
    setPendingActions((prev) => prev.filter((a) => a !== action)); // 낙관적 제거(중복 승인 방지)
    homeApi
      .confirmAction(action)
      .then(() => {
        if (opSeq.current !== gen) return;
        setTurns((t) => [...t, { role: 'assistant', content: '요청을 처리했어요.' }]);
      })
      .catch((e) => {
        if (opSeq.current !== gen) return;
        setPendingActions((prev) => [...prev, action]); // 실패 항목 복원
        handleApiError(e, '확인 작업에 실패했습니다');
      });
  }, []);

  // #351: 단일 항목 거부 — 서버 호출 없이 카드에서 제거.
  const dismissActionItem = useCallback((action: PendingAction) => {
    setPendingActions((prev) => prev.filter((a) => a !== action));
  }, []);

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
    pendingActions,
    clearPendingActions,
    confirmActionItem,
    dismissActionItem,
    submitQuery,
    stopStreaming,
    newSession,
    restoreSession,
    deleteSession,
  };
}
