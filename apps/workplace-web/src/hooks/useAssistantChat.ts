// src/hooks/useAssistantChat.ts
// AI 어시스턴트 채팅 브리지 — 챗 세션 상태 + 세션 목록을 모은다.
// 어시스턴트는 어느 경로에서든 제자리(in-place)에서 답한다 — 홈으로 강제 이동/캔버스 구성 없음.
// WP-190: 대화별 상태(목록 문구·헤더 점·상한) 노출.
import { useEffect } from 'react';

import { useChatSessionContext } from '@/hooks/chat-session-context';
import { useSessions } from '@/hooks/queries/useHomeQueries';
import type { AiActivity } from '@/lib/ai/aiActivity';
import { chatStreams, type SessionStatus } from '@/lib/ai/chatStreams';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type { ChatTurn, HomeSessionSummary, ProposalCard, TurnAttachment } from '@/types/home';

export interface AssistantChat {
  turns: ChatTurn[];
  pending: boolean;
  sessions: HomeSessionSummary[];
  currentSessionId: string | null;
  /** '새 대화' 전이 신호(nonce) — 증가 시 패널이 미전송 입력 초안을 비운다(#204). */
  newSessionNonce: number;
  /**
   * WP-54 화면 컨텍스트 포함 전송. WP-234: attachments — 이번 메시지 첨부.
   * false 면 서버가 받지 않았다(409·429·400 등) — 패널이 입력을 되돌리고 첨부 초안을 남긴다(WP-190·WP-234).
   */
  onSubmit: (query: string, screenContext?: AiScreenContext, attachments?: TurnAttachment[]) => Promise<boolean>;
  /** WP-234: 실제 대화 전환(새 대화·대화 선택·현재 대화 삭제) 신호 — 증가 시 패널이 첨부 초안을 비운다. */
  attachmentResetNonce: number;
  /** #335: 현재 대화의 생성만 멈춘다(부분 응답 보존). */
  onStop: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  /** WP-190: 사용자 동시 생성 상한(서버 값, 기본 3). */
  limit: number;
  /** WP-190: 다른 대화가 상한만큼 답변 중 — 입력창 위 안내. */
  atLimit: boolean;
  /** WP-190: 전송 막힘(상한·■ 뒤 서버 종결 대기·이력 읽는 중·다른 창에서 답변 중). */
  sendBlocked: boolean;
  /** WP-266: 현재 대화가 다른 창에서 답변 중인데 이 창엔 아직 "답변 중" 표시가 없다 — 입력창 위 안내. */
  busyElsewhere: boolean;
  /** WP-265: 현재 대화의 생성 도중 SSE 가 다시 이어졌다 — 답변 아래 "끝나면 전체를 불러와요" 안내. */
  reconnected: boolean;
  /** WP-190: 현재 대화를 뺀 나머지의 생성 중/새 답변 — 헤더 "대화 목록" 점. */
  otherActivity: AiActivity;
  /** WP-190: 대화 목록 둘째 줄 상태. */
  sessionStatus: (id: string) => SessionStatus;
  /** WP-190: 삭제 확인창 문구 분기. */
  isGenerating: (id: string) => boolean;
  /** #351/#843: 확인 카드 배열(카드별 진행 상태 포함). */
  pendingActions: ProposalCard[];
  /** 단일 카드 승인 — 성공이면 카드 제거, 실패면 카드에 사유 표시. 결과는 대화 이력에 기록된다. */
  onConfirmActionItem: (card: ProposalCard) => void;
  /** #843: 대기 카드를 순서대로 모두 승인하고 실패를 토스트 1건으로 집계. */
  onConfirmAllActionItems: () => void;
  /** 거부(대기 카드 → 서버 REJECTED 기록) 또는 닫기(실패 카드). */
  onDismissActionItem: (card: ProposalCard) => void;
  /** #843: 실패 카드 → AI 에게 사유를 반영해 다시 제안해 달라고 요청. */
  onRequestProposalFix: (card: ProposalCard) => void;
}

export function useAssistantChat(): AssistantChat {
  const session = useChatSessionContext();
  const sessions = useSessions();
  // WP-190: 목록이 완전할 때만 사라진 대화의 "새 답변" 표시를 지운다(R15).
  useEffect(() => {
    if (sessions.data) chatStreams.pruneUnseen(sessions.data.items.map((s) => s.id), sessions.data.nextCursor === null);
  }, [sessions.data]);

  return {
    turns: session.turns,
    pending: session.pending,
    sessions: sessions.data?.items ?? [],
    currentSessionId: session.sessionId,
    newSessionNonce: session.newSessionNonce,
    attachmentResetNonce: session.attachmentResetNonce,
    onSubmit: session.submitQuery,
    onStop: session.stopStreaming,
    onNewSession: session.newSession,
    onSelectSession: (id) => void session.restoreSession(id),
    onDeleteSession: session.deleteSession,
    limit: session.limit,
    atLimit: session.atLimit,
    sendBlocked: session.sendBlocked,
    busyElsewhere: session.busyElsewhere,
    reconnected: session.reconnected,
    otherActivity: session.otherActivity,
    sessionStatus: session.sessionStatus,
    isGenerating: session.isGenerating,
    pendingActions: session.pendingActions,
    onConfirmActionItem: (card) => void session.confirmActionItem(card),
    onConfirmAllActionItems: () => void session.confirmAllActionItems(),
    onDismissActionItem: (card) => void session.dismissActionItem(card),
    onRequestProposalFix: session.requestProposalFix,
  };
}
