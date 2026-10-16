// 챗 세션 어댑터(WP-190) — 대화별 스트림 저장소(chatStreams)의 "현재 대화" 칸을 읽고 쓰며, API 호출(시작·취소·복원·확인카드)을 맡는다.
// AppLayout 레벨에서 1회 생성해 컨텍스트로 공유한다(side/fullscreen/모바일 시트가 같은 상태를 본다). 대화를 옮겨도 진행 중 생성은 끊지 않는다.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { homeApi } from '@/api/home';
import { confirmAllProposalCards, confirmProposalCard, currentTarget, isStaleProposal } from '@/hooks/chatProposals';
import { resyncActiveChats } from '@/hooks/chatStreamsSync';
import { homeKeys, useDeleteSession } from '@/hooks/queries/useHomeQueries';
import { useAuth } from '@/hooks/useAuth';
import { useChatStreamsSnapshot } from '@/hooks/useChatStreams';
import { chatStartRejection } from '@/lib/ai/chatErrors';
import {
  atLimit,
  busyElsewhere,
  chatStreams,
  connectChatEvents,
  currentSessionId,
  DRAFT_PREFIX,
  isGenerating,
  otherActivity,
  sendBlocked,
  sessionStatus,
} from '@/lib/ai/chatStreams';
import { FAILED_EMPTY, messageToTurn } from '@/lib/ai/chatTurns';
import { linkedSessionSummary } from '@/lib/aiChatLink';
import { screenContextPayload } from '@/lib/aiScreenContext/common';
import { handleApiError, isNotFoundError } from '@/lib/api-error';
import type { AiMemoryScope } from '@/types/aiMemory';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type { ChatTurn, HomeSessionSummary, PendingAction, ProposalCard, TurnAttachment } from '@/types/home';
import type { ChatSpace } from '@/types/sharedAiMemory';

const EMPTY_TURNS: ChatTurn[] = [];
/** WP-268: 이력 조회가 이만큼 끝나지 않으면 실패로 보고 전송 잠금을 푼다(응답 없는 요청에 입력이 영영 막히지 않게). */
const HISTORY_LOCK_TIMEOUT_MS = 10_000;
const EMPTY_CARDS: ProposalCard[] = [];

export function useChatSession() {
  const del = useDeleteSession();
  const qc = useQueryClient();
  const { user, activeTenant } = useAuth();
  const snap = useChatStreamsSnapshot();
  // 사용자·워크스페이스가 바뀌면 저장소를 비운다(R15) — 대화는 테넌트별이다.
  const ownerKey = user ? `${user.id}:${activeTenant?.tenantId ?? 0}` : null;

  // 서버 이력으로 칸 채우기 — 복원과 자리표시 종결 재조회가 공용. #843: 카드 조회 실패는 이력 복원을 막지 않는다.
  const reload = useCallback(async (id: string, timeoutMs?: number) => {
    try {
      const [{ data }, proposals] = await Promise.all([
        homeApi.sessionMessages(id, timeoutMs),
        homeApi.sessionProposals(id, timeoutMs).then((r) => r.data).catch(() => [] as PendingAction[]),
      ]);
      chatStreams.load(id, data.map(messageToTurn), proposals);
    } catch (err) {
      handleApiError(err, '세션을 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    chatStreams.setOwner(ownerKey);
    if (ownerKey) void resyncActiveChats();
  }, [ownerKey]);
  useEffect(() => {
    chatStreams.setEffects({
      sessionsChanged: () => void qc.invalidateQueries({ queryKey: homeKeys.sessions() }),
      refetch: (id) => void reload(id),
    });
  }, [qc, reload]);
  // home.chat.* 는 저장소가 한 곳에서 구독한다(요청마다 붙였다 떼지 않음).
  useEffect(() => connectChatEvents(chatStreams), []);

  // WP-384: 링크·딥링크로 연 대화의 목록 항목(id → 항목) — 첫 30개 목록 밖의 오래된 대화도 헤더에 제목이 보이게(useAssistantChat 이 목록에 합친다).
  const [linkedSessions, setLinkedSessions] = useState<Readonly<Record<string, HomeSessionSummary>>>({});

  // WP-379: 마지막 전송의 화면 앱 — 승인 실패 재요청(화면 참고 없이 보내는 내부 전송)도 같은 범위 메모리를 쓰게.
  const lastAppRef = useRef<AiMemoryScope | null>(null);
  const lastSpaceRef = useRef<ChatSpace | null>(null); // WP-386: 실패 카드 재요청도 같은 공간으로

  /**
   * 질문 전송. 낙관적으로 두 턴을 붙이고(correlationId 도 이때 정해 라우팅에 올린다, WP-267) POST 에 실어 보낸다.
   * WP-234: attachments — 이번 메시지 첨부(낙관적 사용자 턴에 미리보기와 함께 붙이고, fileIds 로 POST 본문에 싣는다).
   * WP-379: app — 지금 화면 앱(화면 참고를 뺐어도 보낸다). 없으면 키 생략 → 공통 메모리만.
   * WP-386: space — 지금 화면 공간(화면 참고를 뺐어도 보낸다). 없으면 키 생략.
   * @returns 서버가 요청을 받아들였는지. false(409·429·400·네트워크 오류 등)면 패널이 입력·첨부 초안을 되돌린다(R17·WP-234).
   */
  const submitQuery = useCallback(
    async (
      query: string,
      screenContext?: AiScreenContext,
      attachments?: TurnAttachment[],
      app?: AiMemoryScope | null,
      space?: ChatSpace | null,
    ): Promise<boolean> => {
      lastAppRef.current = app ?? null;
      lastSpaceRef.current = space ?? null;
      const { key, gen, correlationId, userTurn } = chatStreams.startTurn(query, attachments);
      const sessionId = key.startsWith(DRAFT_PREFIX) ? null : key;
      const fileIds = attachments?.map((a) => a.fileId) ?? [];
      try {
        // WP-54: screenContext 는 있을 때만 키를 싣는다(app 은 빼고). WP-234: fileIds 도 있을 때만. WP-379: app 도 있을 때만. WP-386: space 도 있을 때만.
        const { data } = await homeApi.startChat({
          sessionId,
          query,
          correlationId,
          ...(screenContext ? { screenContext: screenContextPayload(screenContext) } : {}),
          ...(fileIds.length ? { fileIds } : {}),
          ...(app ? { app } : {}),
          ...(space ? { space } : {}),
        });
        // 응답 전에 ■ 를 눌렀다면 서버가 받은 지금 취소한다(그때는 서버가 몰라 취소를 보내지 않았다).
        const cancelNow = chatStreams.attach(correlationId, data.correlationId, data.sessionId);
        if (cancelNow) void homeApi.cancelChat(cancelNow).catch(() => {});
        // 새 세션을 목록에 바로 보인다(생성 중 상태 문구를 붙일 행이 필요).
        if (!sessionId) void qc.invalidateQueries({ queryKey: homeKeys.sessions() });
        return true;
      } catch (e) {
        const rejection = chatStartRejection(e);
        // 서버가 받지 않았다 — 낙관적 사용자 턴의 첨부도 뗀다(WP-234: 보낸 것처럼 보이거나 세션 30개 계산에 이중으로 잡히지 않게).
        chatStreams.failStart(key, gen, correlationId, rejection ? null : FAILED_EMPTY, userTurn);
        if (rejection) {
          if (rejection === 'busy') toast.error('이 대화는 아직 답변 중이에요');
          // limit: 입력창 위 상한 안내가 재동기화 결과로 뜬다.
          void resyncActiveChats();
        } else {
          handleApiError(e, 'AI 구성에 실패했습니다');
        }
        return false;
      }
    },
    [qc],
  );

  // #335: 현재 대화의 생성만 멈춘다 — 부분 답변은 칸에 남고, 서버가 STOPPED 로 저장한다.
  const stopStreaming = useCallback(() => {
    const key = chatStreams.getSnapshot().currentKey;
    if (!key) return;
    const cid = chatStreams.stopLocal(key);
    if (cid) void homeApi.cancelChat(cid).catch(() => {});
  }, []);

  // 새 대화 — 진행 중 생성은 그대로 두고 현재 칸만 비운다(WP-191 확인창 제거).
  const newSession = useCallback(() => chatStreams.newConversation(), []);

  // 대화 선택 — 칸이 있으면 그대로(생성 중이면 스트리밍이 이어 보인다), 없으면 서버에서 읽는다(R14).
  // 칸은 있어도 이력이 아직이면(그 조회가 실패한 칸) 다시 읽는다. WP-268: 읽는 동안은 전송을 막는다 — 실패·시간 초과면 푼다.
  const restoreSession = useCallback(
    async (id: string) => {
      chatStreams.select(id);
      if (chatStreams.hasHistory(id)) return;
      const token = chatStreams.beginLoading(id);
      // 요청 자체에 시간 제한을 둔다 — 잠금이 풀린 뒤 늦은 이력이 새 질문과 섞이지 않게.
      await reload(id, HISTORY_LOCK_TIMEOUT_MS);
      chatStreams.endLoading(id, token); // 성공이면 load 가 이미 풀었다(no-op). reload 는 실패를 삼킨다.
    },
    [reload],
  );

  /**
   * WP-384 딥링크 — 그 대화를 읽어 현재 대화로 둔다. 이미 이력이 있으면 바로 고른다. 없거나 남의 대화(404)면 'not-found'(호출자가 토스트), 그 밖의
   * 실패는 공용 오류 토스트 + 'error'. 읽기에 성공한 뒤에만 고른다 — 없는 대화가 현재 대화로 남지 않게.
   */
  const openSession = useCallback(async (id: string): Promise<'ok' | 'not-found' | 'error'> => {
    if (chatStreams.hasHistory(id)) {
      chatStreams.select(id);
      return 'ok';
    }
    try {
      const [{ data }, proposals] = await Promise.all([
        homeApi.sessionMessages(id, HISTORY_LOCK_TIMEOUT_MS),
        homeApi
          .sessionProposals(id, HISTORY_LOCK_TIMEOUT_MS)
          .then((r) => r.data)
          .catch(() => [] as PendingAction[]),
      ]);
      chatStreams.load(id, data.map(messageToTurn), proposals);
      chatStreams.select(id);
      setLinkedSessions((prev) => ({ ...prev, [id]: linkedSessionSummary(id, data) }));
      return 'ok';
    } catch (err) {
      if (isNotFoundError(err)) return 'not-found';
      handleApiError(err, '대화를 불러오지 못했어요');
      return 'error';
    }
  }, []);

  // 삭제 — 생성 중이면 먼저 취소해 슬롯을 비우고(지운 대화에 답변 저장 시도 방지), 성공하면 칸을 잊는다.
  const deleteSession = useCallback(
    (id: string) => {
      const s = chatStreams.getSnapshot();
      const cid = isGenerating(s, id) ? (s.active.get(id) ?? s.entries.get(id)?.correlationId ?? null) : null;
      const remove = () =>
        del.mutate(id, {
          onSuccess: () => {
            chatStreams.forget(id);
            // 링크로 연 항목도 버린다 — 지운 대화가 목록에 다시 붙지 않게.
            setLinkedSessions((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          },
        });
      // 취소 후 삭제(스펙 §4) — 취소 실패(이미 끝남 등)여도 삭제는 진행한다.
      if (cid) void homeApi.cancelChat(cid).catch(() => {}).finally(remove);
      else remove();
    },
    [del],
  );

  // #843: 승인 — 클릭 시점의 대화를 잡아 결과를 그 대화에만 붙인다(대화를 옮겨도 다른 대화로 새지 않게, chatProposals).
  const confirmActionItem = useCallback((card: ProposalCard) => confirmProposalCard(card, currentTarget()), []);
  const confirmAllActionItems = useCallback(() => confirmAllProposalCards(currentTarget()), []);

  /** #843: 거부 — 대기 카드는 서버에 REJECTED 기록 후 결과 줄, 실패 카드는 닫기만. */
  const dismissActionItem = useCallback(async (card: ProposalCard) => {
    const at = currentTarget();
    if (!at) return;
    if (card.phase === 'failed') {
      chatStreams.removeCard(at.key, at.gen, card.id);
      return;
    }
    if (card.phase !== 'pending') return;
    chatStreams.patchCard(at.key, at.gen, card.id, { phase: 'submitting' });
    try {
      const { data } = await homeApi.rejectProposal(card.id);
      if (!chatStreams.appendTurn(at.key, at.gen, messageToTurn(data.message))) return;
      chatStreams.removeCard(at.key, at.gen, card.id);
    } catch (e) {
      if (isStaleProposal(e)) chatStreams.removeCard(at.key, at.gen, card.id);
      else chatStreams.patchCard(at.key, at.gen, card.id, { phase: 'pending' });
      handleApiError(e, '거부 요청을 보내지 못했습니다');
    }
  }, []);

  /** #843: 실패 카드 → AI 에게 사유를 반영해 다시 제안 요청(화면 컨텍스트 없이). */
  const requestProposalFix = useCallback(
    (card: ProposalCard) => {
      void submitQuery(`「${card.summary}」 승인이 실패했어요. 실패 사유를 반영해서 다시 제안해 줘.`, undefined, undefined, lastAppRef.current, lastSpaceRef.current);
    },
    [submitQuery],
  );

  const entry = snap.currentKey ? snap.entries.get(snap.currentKey) : undefined;
  return {
    sessionId: currentSessionId(snap),
    linkedSessions,
    turns: entry?.turns ?? EMPTY_TURNS,
    pending: entry?.pending ?? false,
    pendingActions: entry?.pendingActions ?? EMPTY_CARDS,
    newSessionNonce: snap.newSessionNonce,
    attachmentResetNonce: snap.attachmentResetNonce,
    limit: snap.limit,
    atLimit: atLimit(snap),
    sendBlocked: sendBlocked(snap),
    busyElsewhere: busyElsewhere(snap),
    reconnected: entry?.reconnected ?? false,
    otherActivity: otherActivity(snap),
    sessionStatus: (id: string) => sessionStatus(snap, id),
    isGenerating: (id: string) => isGenerating(snap, id),
    confirmActionItem,
    confirmAllActionItems,
    dismissActionItem,
    requestProposalFix,
    submitQuery,
    stopStreaming,
    newSession,
    restoreSession,
    openSession,
    deleteSession,
  };
}
