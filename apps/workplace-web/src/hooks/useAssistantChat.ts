// src/hooks/useAssistantChat.ts
// AI 어시스턴트 채팅 브리지 — 챗 세션 상태 + 세션 목록을 모은다.
// 어시스턴트는 어느 경로에서든 제자리(in-place)에서 답한다 — 홈으로 강제 이동/캔버스 구성 없음.
import { useChatSessionContext } from '@/hooks/chat-session-context';
import { useSessions } from '@/hooks/queries/useHomeQueries';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type { ChatTurn, HomeSessionSummary, ProposalCard } from '@/types/home';

export interface AssistantChat {
  turns: ChatTurn[];
  pending: boolean;
  sessions: HomeSessionSummary[];
  currentSessionId: string | null;
  /** '새 대화' 전이 신호(nonce) — 증가 시 패널이 미전송 입력 초안을 비운다(#204). */
  newSessionNonce: number;
  /** WP-54: screenContext — 패널이 칩 상태를 반영해 넘기는 현재 화면 컨텍스트(없으면 미전송). */
  onSubmit: (query: string, screenContext?: AiScreenContext) => void;
  /** #335: 스트리밍 중단 — 진행 중 AI 응답을 멈춘다(부분 응답은 보존). */
  onStop: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  /** #351: 보류 확인 카드 배열(없으면 빈 배열). #843: 카드별 진행 상태(pending/submitting/failed) 포함. */
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

  return {
    turns: session.turns,
    pending: session.pending,
    sessions: sessions.data?.items ?? [],
    currentSessionId: session.sessionId,
    newSessionNonce: session.newSessionNonce,
    onSubmit: session.submitQuery,
    onStop: session.stopStreaming,
    onNewSession: session.newSession,
    onSelectSession: session.restoreSession,
    onDeleteSession: session.deleteSession,
    pendingActions: session.pendingActions,
    onConfirmActionItem: (card) => void session.confirmActionItem(card),
    onConfirmAllActionItems: () => void session.confirmAllActionItems(),
    onDismissActionItem: (card) => void session.dismissActionItem(card),
    onRequestProposalFix: session.requestProposalFix,
  };
}
