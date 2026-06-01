// 전역 챗 도크 — 모든 모듈에서 하단 상주. AI Native 의 주 진입점.
// 홈이 아닌 곳에서 제출하면 홈으로 이동해 캔버스에 결과를 구성("챗→compose→캔버스" 주 경로 보존).
import { useLocation, useNavigate } from 'react-router-dom';

import { FloatingChat } from '@/components/home/FloatingChat';
import { useHomeSessionContext } from '@/hooks/home-session-context';

export function GlobalChatDock() {
  const session = useHomeSessionContext();
  const location = useLocation();
  const navigate = useNavigate();

  // 입력 제출 → 비-홈이면 캔버스가 보이도록 먼저 홈으로 이동 후 compose 실행.
  const handleSubmit = (query: string) => {
    if (location.pathname !== '/') navigate('/');
    session.submitQuery(query);
  };

  return <FloatingChat turns={session.turns} pending={session.pending} onSubmit={handleSubmit} />;
}
