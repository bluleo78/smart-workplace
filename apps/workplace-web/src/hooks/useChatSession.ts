import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { homeApi } from '@/api/home';
import { chatStream, homeKeys, useDeleteSession } from '@/hooks/queries/useHomeQueries';
import { isVisibleStep, widgetTypeFromToolName } from '@/lib/aiToolLabels';
import { extractApiError, handleApiError } from '@/lib/api-error';
import { pushTextBlock, pushToolsBlock, pushWidgetBlock, reconcileBlocks } from '@/lib/chatBlocks';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type {
  ActionOutcome,
  ChatTurn,
  HomeMessage,
  PendingAction,
  ProposalCard,
  ToolEventDto,
  ToolStep,
  WidgetSpec,
  WidgetType,
} from '@/types/home';

/** 생성 중 요청된 대화 전환(WP-191) — 확인창이 결정할 때까지 보류된다. */
export type SessionSwitch = { kind: 'new' } | { kind: 'select'; id: string };

/** #843: 서버 제안 → 화면 카드(대기 상태). */
const toCards = (actions: PendingAction[]): ProposalCard[] =>
  actions.map((a) => ({ ...a, phase: 'pending' as const }));

/** #843: ACTION_* 역할 → 결과 종류. */
const OUTCOME_BY_ROLE: Partial<Record<HomeMessage['role'], ActionOutcome>> = {
  ACTION_DONE: 'done',
  ACTION_FAILED: 'failed',
  ACTION_REJECTED: 'rejected',
};

/**
 * 영속 메시지 → 화면 턴. 스트리밍 결과·세션 복원이 같은 규칙을 쓴다.
 * #843: ACTION_* 는 사용자 말풍선이 아니라 확인카드 처리 결과 줄(role='action')로 복원한다.
 * WP-158: 서버가 영속한 블록 순서가 있으면 라이브 done 과 같이 위젯 목록으로 재조정해 도착순 렌더를 재현한다.
 */
function messageToTurn(m: HomeMessage): ChatTurn {
  const outcome = OUTCOME_BY_ROLE[m.role];
  if (outcome) return { role: 'action', outcome, content: m.content };
  return {
    role: m.role === 'ASSISTANT' ? 'assistant' : 'user',
    content: m.content,
    widgets: m.widgets ?? undefined,
    steps: m.toolCalls ?? undefined,
    contentBlocks: m.contentBlocks ? reconcileBlocks(m.contentBlocks, m.widgets ?? []) : undefined,
  };
}

/** 카드 자체가 무효(이미 처리됨 409 · 없음 404)인지 — 다시 눌러도 소용없으므로 실패로 확정한다. */
const isStaleProposal = (e: unknown) =>
  isAxiosError(e) && (e.response?.status === 409 || e.response?.status === 404);

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
  // #843: 카드마다 진행 상태(pending/submitting/failed)를 함께 들고 있어, 실패해도 제자리에서 사유를 보여준다.
  const [pendingActions, setPendingActions] = useState<ProposalCard[]>([]);
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
  // WP-191: 생성 중 요청된 전환 — 화면(확인창) 표시용 state + 비동기 완료 경로에서 읽는 ref 미러.
  const [heldSwitch, setHeldSwitchRaw] = useState<SessionSwitch | null>(null);
  // [기다리기]를 눌러 확인창만 닫은 상태 — 패널이 언마운트(시트 닫힘·모드 전환)돼도 잃지 않도록 보류와 함께 여기서 든다.
  const [heldDismissed, setHeldDismissed] = useState(false);
  // 보류를 바꿀 때마다 닫힘 표시를 되돌린다 — 새 요청은 확인창을 다시 열고, 해제되면 표시도 사라진다.
  const setHeldSwitch = useCallback((s: SessionSwitch | null) => {
    setHeldSwitchRaw(s);
    setHeldDismissed(false);
  }, []);
  const heldRef = useRef<SessionSwitch | null>(null);
  // 보류 전환 실행기 — newSession/restoreSession 이 아래에서 정의되므로 effect 에서 최신 함수로 채운다.
  const releaseHeldRef = useRef<() => void>(() => {});

  // sessionIdRef 를 sessionId state 와 동기화하는 헬퍼.
  const updateSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  // 챗 명령 → SSE AI chat. 빈 assistant 턴을 먼저 추가하고,
  // delta 마다 마지막 턴의 content 에 누적 → done 에서 sessionId 확정.
  // WP-54: screenContext — 패널 칩이 활성일 때만 넘어오는 현재 화면 컨텍스트(없으면 요청 본문에서 키 생략).
  const submitQuery = useCallback(
    (query: string, screenContext?: AiScreenContext) => {
      const gen = ++opSeq.current;
      // 사용자 턴 + 빈 어시스턴트 턴을 즉시 추가 — 빈 어시스턴트 턴이 있을 때만 3-dot 표시.
      setTurns((t) => [...t, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
      const ac = new AbortController();
      abortRef.current = ac;
      setPending(true);
      setPendingActions([]);      // #351: 새 제출 — 이전 확인 카드 배열 폐기
      chatStream(
        { sessionId: sessionIdRef.current, query, ...(screenContext ? { screenContext } : {}) },
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
            const prev = last.steps ?? [];
            const steps = [...prev, { kind: 'delegation' as const, label }];
            // WP-157: 도착 위치에 도구 그룹 블록을 남겨 텍스트 사이에 순서대로 렌더한다.
            const contentBlocks = pushToolsBlock(last.contentBlocks ?? [], prev.length);
            next[next.length - 1] = { ...last, steps, contentBlocks };
            return next;
          });
        },
        (actions, sid) => {
          // #351: 보류 확인 액션들 수신 — 일괄 카드로 렌더.
          if (opSeq.current !== gen) return;
          // #843: 새 세션이면 sessionId 가 done 에서야 오는데 카드는 그보다 먼저 온다 — 여기서 세션을 확정해
          // done 전에 승인해도 결과가 올바른 세션에 기록·복원되게 한다.
          if (sid && !sessionIdRef.current) updateSessionId(sid);
          setPendingActions(toCards(actions));
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
              const step: ToolStep = { kind: 'tool', seq: evt.seq, toolName: evt.toolName, args: evt.args, status: 'running' };
              // WP-157: 표시되는 단계만 그룹 블록을 연다 — 숨김 도구(show_* 등)가 빈 풍선을 만들거나 텍스트를 끊지 않게.
              if (isVisibleStep(step)) contentBlocks = pushToolsBlock(contentBlocks, steps.length);
              steps.push(step);
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
          // #463 I1: done.widgets(서버 #404 필터 후)가 있을 때만 authoritative 로 widgets 갱신 +
          //   contentBlocks 의 widget 블록 재조정(필터된 위젯 제거). done.widgets 가 비어 있으면
          //   라이브 tool 이벤트로 누적된 위젯을 보존한다(#461 점진 렌더 — done 이 위젯을 늦게/안 줘도 표시).
          //   프로덕션에선 라이브 위젯이 항상 done.widgets 에 포함되므로(compose-parser 수집),
          //   빈 done.widgets 는 '전부 필터' edge 뿐 — 그 경우만 라이브 잔존(reload 시 자가복구).
          if (r.widgets && r.widgets.length > 0) {
            const authoritative = r.widgets;
            setTurns((t) => {
              const next = [...t];
              const last = next[next.length - 1];
              if (last?.role !== 'assistant') return t; // 방어 — turns 리셋된 경우 skip.
              const contentBlocks = last.contentBlocks
                ? reconcileBlocks(last.contentBlocks, authoritative)
                : last.contentBlocks;
              next[next.length - 1] = { ...last, widgets: authoritative, contentBlocks };
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
            // WP-191: 생성이 끝나면 보류해 둔 전환을 실행한다(확인창에서 [기다리기]를 고른 경우 포함).
            releaseHeldRef.current();
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
    if (!abortRef.current) {
      // 진행 중 스트림이 없어도 보류 전환은 실행한다(WP-191).
      releaseHeldRef.current();
      return;
    }
    opSeq.current++;
    abortRef.current.abort();
    abortRef.current = null;
    setPending(false);
    releaseHeldRef.current(); // WP-191: [중단하고 이동] — 중단 직후 보류 전환 실행
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
  // opts.keepDraft: 보류됐던 '새 대화'를 나중에 실행하는 경로 전용 — 기다리는 동안 사용자가 입력한
  // 다음 질문(초안)을 지우지 않도록 초안 초기화 신호(nonce)를 발행하지 않는다.
  // 직접/즉시 새 대화는 옵션 없이 호출돼 종전대로 초안을 비운다(#204).
  const newSession = useCallback((opts?: { keepDraft?: boolean }) => {
    // WP-191: 어떤 실제 전환이든 보류를 취소한다(삭제 등으로 직접 호출돼도 옛 보류가 나중에 튀어나오지 않게).
    // releaseHeld 는 호출 전에 이미 비우므로 1회 실행 보장은 유지된다.
    heldRef.current = null;
    setHeldSwitch(null);
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
    if (!opts?.keepDraft) setNewSessionNonce((n) => n + 1);
  }, [updateSessionId, setHeldSwitch]);

  // 복원 — 메시지 fetch → transcript 재현(AI 재호출 없음, 위젯 fold 없음).
  const restoreSession = useCallback(
    async (id: string) => {
      heldRef.current = null; // WP-191: 실제 전환은 보류를 취소한다(newSession 과 동일)
      setHeldSwitch(null);
      const gen = ++opSeq.current;
      // in-flight SSE 스트림 취소 — 복원된 세션에 구 스트림 델타가 섞이는 것 방지.
      abortRef.current?.abort();
      abortRef.current = null;
      setPending(false);
      setPendingActions([]); // #351: 세션 복원 시 확인 카드 배열 초기화
      try {
        // #843: 미처리 확인카드도 서버에 영속되므로 메시지와 함께 복원한다. 카드 조회가 실패해도 대화 이력 복원은
        // 막지 않는다(카드는 부가 정보 — 없으면 카드 없이 보여주는 편이 세션을 못 여는 것보다 낫다).
        const [{ data }, proposals] = await Promise.all([
          homeApi.sessionMessages(id),
          homeApi
            .sessionProposals(id)
            .then((r) => r.data)
            .catch(() => [] as PendingAction[]),
        ]);
        // fetch 중 더 최신 전이가 있었으면 폐기.
        if (opSeq.current !== gen) return;
        // #431: 복원 시에도 ASSISTANT 위젯을 함께 재현(서버가 widgets 영속) — 빈 버블 방지.
        // toolCalls → steps 매핑: 서버가 영속한 도구 호출 단계를 인라인 표시로 복원.
        updateSessionId(id);
        setTurns(data.map(messageToTurn));
        setPendingActions(toCards(proposals));
      } catch (err) {
        handleApiError(err, '세션을 불러오지 못했습니다');
      }
    },
    [updateSessionId],
  );

  // #843: 카드 상태 갱신 헬퍼 — 카드는 제자리에 머물고 phase/error 만 바뀐다(예전의 제거→끝에 재삽입 제거).
  const patchCard = useCallback((id: number, patch: Partial<ProposalCard>) => {
    setPendingActions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);
  const removeCard = useCallback((id: number) => {
    setPendingActions((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /**
   * #843: 단일 카드 승인. 서버가 성공·실패를 모두 대화 이력에 기록하고 그 메시지를 돌려주므로, 결과 줄을 transcript 에
   * 붙인다(다음 턴 AI 도 같은 기록을 본다). 성공이면 카드 제거, 실패면 카드에 사유 표시.
   * 네트워크 오류처럼 서버가 판정하지 못한 경우만 대기 상태로 되돌려 다시 누를 수 있게 한다.
   *
   * @returns 결과 종류 — "모두 승인" 집계용. 세대가 바뀌어 반영하지 않았으면 null.
   */
  const confirmActionItem = useCallback(
    async (card: ProposalCard): Promise<ActionOutcome | null> => {
      if (card.phase !== 'pending') return null; // 중복 클릭 방지 — submitting·failed 카드는 무시.
      const gen = opSeq.current;
      patchCard(card.id, { phase: 'submitting', error: undefined });
      try {
        const { data } = await homeApi.confirmProposal(card.id);
        // 새 질문·세션 전환이 끼어들었으면 transcript 가 바뀌었으므로 반영하지 않는다(서버엔 이미 기록됨).
        if (opSeq.current !== gen) return null;
        setTurns((t) => [...t, messageToTurn(data.message)]);
        if (data.proposal.status === 'DONE') {
          removeCard(card.id);
          return 'done';
        }
        patchCard(card.id, {
          phase: 'failed',
          error: data.proposal.errorMessage ?? '처리하지 못했습니다',
        });
        return 'failed';
      } catch (e) {
        if (opSeq.current !== gen) return null;
        if (isStaleProposal(e)) {
          patchCard(card.id, { phase: 'failed', error: extractApiError(e, '이미 처리된 확인 카드입니다') });
        } else {
          patchCard(card.id, { phase: 'pending' });
          handleApiError(e, '승인 요청을 보내지 못했습니다');
        }
        return 'failed';
      }
    },
    [patchCard, removeCard],
  );

  /**
   * #843: "모두 승인" — 대기 카드를 카드 순서대로 하나씩 승인하고(결과 줄 순서 = 카드 순서, 앞 작업에 의존하는 제안의 경합 방지),
   * 실패가 섞였으면 토스트 1건으로 집계한다(예전엔 병렬 호출로 토스트가 건마다 쌓였다).
   */
  const confirmAllActionItems = useCallback(async () => {
    const targets = pendingActions.filter((c) => c.phase === 'pending');
    let failed = 0;
    for (const card of targets) {
      const outcome = await confirmActionItem(card);
      if (outcome === null) return; // 세대 전이 — 나머지도 반영 불가
      if (outcome === 'failed') failed++;
    }
    // 개수만 알린다 — 사유는 카드 인라인·결과 줄에 이미 있다(중복 표시 금지).
    if (failed > 0) toast.error(`${targets.length}건 중 ${failed}건을 처리하지 못했어요`);
    else toast.success(`${targets.length}건을 모두 처리했어요`);
  }, [pendingActions, confirmActionItem]);

  /**
   * #843: 거부 — 대기 카드는 서버에 REJECTED 로 기록(AI 가 같은 제안을 반복하지 않도록)하고 결과 줄을 붙인다.
   * 실패(failed) 카드는 이미 종결 상태라 서버 호출 없이 닫기만 한다.
   */
  const dismissActionItem = useCallback(
    async (card: ProposalCard) => {
      if (card.phase === 'failed') {
        removeCard(card.id);
        return;
      }
      if (card.phase !== 'pending') return;
      const gen = opSeq.current;
      patchCard(card.id, { phase: 'submitting' });
      try {
        const { data } = await homeApi.rejectProposal(card.id);
        if (opSeq.current !== gen) return;
        setTurns((t) => [...t, messageToTurn(data.message)]);
        removeCard(card.id);
      } catch (e) {
        if (opSeq.current !== gen) return;
        if (isStaleProposal(e)) {
          removeCard(card.id);
        } else {
          patchCard(card.id, { phase: 'pending' });
        }
        handleApiError(e, '거부 요청을 보내지 못했습니다');
      }
    },
    [patchCard, removeCard],
  );

  /**
   * #843: 실패 카드 → "AI에게 수정 요청". 같은 파라미터 재시도는 반드시 다시 실패하므로 재시도 버튼 대신 AI 에게 고쳐 달라고 한다.
   * 실패 사유는 이미 대화 이력([승인 결과])에 있어 AI 가 그대로 참고한다.
   */
  const requestProposalFix = useCallback(
    (card: ProposalCard) => {
      // WP-54: 실패 카드 재제안은 화면과 무관 — 화면 컨텍스트 없이 보낸다.
      submitQuery(`「${card.summary}」 승인이 실패했어요. 실패 사유를 반영해서 다시 제안해 줘.`);
    },
    [submitQuery],
  );

  // 삭제 — 활성 세션이면 새 세션으로 리셋.
  const deleteSession = useCallback(
    (id: string) => {
      del.mutate(id, {
        onSuccess: () => {
          // 보류된 전환의 대상이 방금 삭제됐다면 실행할 수 없으니 보류를 버린다(나중에 없는 대화를 복원하려 하지 않게).
          const h = heldRef.current;
          if (h?.kind === 'select' && h.id === id) {
            heldRef.current = null;
            setHeldSwitch(null);
          }
          if (id === sessionId) newSession();
        },
      });
    },
    [del, sessionId, newSession, setHeldSwitch],
  );

  // WP-191: 보류 전환 실행기 — 실행 직전 비워 중복 실행을 막는다(완료·중단이 겹쳐도 1회).
  useEffect(() => {
    releaseHeldRef.current = () => {
      const s = heldRef.current;
      if (!s) return;
      heldRef.current = null;
      setHeldSwitch(null);
      if (s.kind === 'new') newSession({ keepDraft: true }); // 보류 해제: 그 사이 입력한 초안 보존
      else void restoreSession(s.id);
    };
  }, [newSession, restoreSession, setHeldSwitch]);

  // 생성 중이면 보류(확인창), 아니면 즉시 전환.
  const requestSwitch = useCallback(
    (s: SessionSwitch) => {
      if (!pending) {
        if (s.kind === 'new') newSession();
        else void restoreSession(s.id);
        return;
      }
      heldRef.current = s;
      setHeldSwitch(s);
    },
    [pending, newSession, restoreSession, setHeldSwitch],
  );
  const requestNewSession = useCallback(() => requestSwitch({ kind: 'new' }), [requestSwitch]);
  const requestSelectSession = useCallback((id: string) => requestSwitch({ kind: 'select', id }), [requestSwitch]);
  // [중단하고 이동] — 중단하면 stopStreaming 이 보류 전환을 실행한다.
  const confirmSwitch = stopStreaming;
  // [기다리기] — 확인창만 닫고 보류는 유지(생성이 끝나면 실행). 닫힘 표시는 여기서 들어 재오픈해도 다시 뜨지 않는다.
  const dismissHeldSwitch = useCallback(() => setHeldDismissed(true), []);

  return {
    heldSwitch,
    heldDismissed,
    dismissHeldSwitch,
    requestNewSession,
    requestSelectSession,
    confirmSwitch,
    sessionId,
    turns,
    newSessionNonce,
    pending,
    pendingActions,
    confirmActionItem,
    confirmAllActionItems,
    dismissActionItem,
    requestProposalFix,
    submitQuery,
    stopStreaming,
    newSession,
    restoreSession,
    deleteSession,
  };
}
