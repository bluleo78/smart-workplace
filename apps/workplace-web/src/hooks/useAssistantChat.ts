// src/hooks/useAssistantChat.ts
// AI 어시스턴트 채팅 브리지 — 챗 세션 상태 + 세션 목록을 모은다.
// 어시스턴트는 어느 경로에서든 제자리(in-place)에서 답한다 — 홈으로 강제 이동/캔버스 구성 없음.
import { useChatSessionContext } from '@/hooks/chat-session-context';
import { useSessions } from '@/hooks/queries/useHomeQueries';
import type { ChatTurn, HomeSessionSummary, PendingAction } from '@/types/home';

export interface AssistantChat {
  turns: ChatTurn[];
  pending: boolean;
  sessions: HomeSessionSummary[];
  currentSessionId: string | null;
  /** '새 대화' 전이 신호(nonce) — 증가 시 패널이 미전송 입력 초안을 비운다(#204). */
  newSessionNonce: number;
  onSubmit: (query: string) => void;
  /** #335: 스트리밍 중단 — 진행 중 AI 응답을 멈춘다(부분 응답은 보존). */
  onStop: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  /** #333 M2: 현재 위임 진행 라벨(없으면 null). 서브에이전트 위임 중 버블로 표시. */
  delegationLabel: string | null;
  /** #351: 보류 확인 액션 배열(없으면 빈 배열). 일괄 카드로 렌더. */
  pendingActions: PendingAction[];
  /** #351: 단일 항목 승인 → confirm POST → 카드에서 제거. */
  onConfirmActionItem: (action: PendingAction) => void;
  /** #351: 단일 항목 거부 → 서버 호출 없이 카드에서 제거. */
  onDismissActionItem: (action: PendingAction) => void;
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
    delegationLabel: session.delegationLabel,
    pendingActions: session.pendingActions,
    onConfirmActionItem: session.confirmActionItem,
    onDismissActionItem: session.dismissActionItem,
  };
}
