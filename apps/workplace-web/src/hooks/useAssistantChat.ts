// src/hooks/useAssistantChat.ts
// AI 어시스턴트 채팅 브리지 — 챗 세션 상태 + 세션 목록을 모은다.
// 어시스턴트는 어느 경로에서든 제자리(in-place)에서 답한다 — 홈으로 강제 이동/캔버스 구성 없음.
import { useChatSessionContext } from '@/hooks/chat-session-context';
import { useSessions } from '@/hooks/queries/useHomeQueries';
import type { ChatTurn, HomeSessionSummary } from '@/types/home';

export interface AssistantChat {
  turns: ChatTurn[];
  pending: boolean;
  sessions: HomeSessionSummary[];
  currentSessionId: string | null;
  /** '새 대화' 전이 신호(nonce) — 증가 시 패널이 미전송 입력 초안을 비운다(#204). */
  newSessionNonce: number;
  onSubmit: (query: string) => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
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
    onNewSession: session.newSession,
    onSelectSession: session.restoreSession,
    onDeleteSession: session.deleteSession,
  };
}
