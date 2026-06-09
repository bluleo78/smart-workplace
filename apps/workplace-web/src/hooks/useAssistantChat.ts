// src/hooks/useAssistantChat.ts
// AI 어시스턴트 채팅 브리지 — 세션 상태 + 세션 목록을 모으고,
// 비-홈에서 제출/새대화/선택 시 홈으로 이동(챗→compose→캔버스 주 경로 보존).
import { useLocation, useNavigate } from 'react-router-dom';

import { useHomeSessionContext } from '@/hooks/home-session-context';
import { useSessions } from '@/hooks/queries/useHomeQueries';
import type { ChatTurn, HomeSessionSummary } from '@/types/home';

export interface AssistantChat {
  turns: ChatTurn[];
  pending: boolean;
  sessions: HomeSessionSummary[];
  currentSessionId: string | null;
  onSubmit: (query: string) => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export function useAssistantChat(): AssistantChat {
  const session = useHomeSessionContext();
  const sessions = useSessions();
  const location = useLocation();
  const navigate = useNavigate();

  // 비-홈이면 캔버스가 보이도록 먼저 홈으로 이동.
  const goHome = () => {
    if (location.pathname !== '/') navigate('/');
  };

  return {
    turns: session.turns,
    pending: session.pending,
    sessions: sessions.data?.items ?? [],
    currentSessionId: session.sessionId,
    onSubmit: (query: string) => {
      goHome();
      session.submitQuery(query);
    },
    onNewSession: () => {
      goHome();
      session.newSession();
    },
    onSelectSession: (id: string) => {
      goHome();
      session.restoreSession(id);
    },
    onDeleteSession: session.deleteSession,
  };
}
