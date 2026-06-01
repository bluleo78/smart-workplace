// 홈 모듈 콘텐츠 — AI 캔버스 + 세션 스위처. 챗 도크/네비는 전역 셸이 담당.
import { useHomeSessionContext } from '@/hooks/home-session-context';
import { useSessions } from '@/hooks/queries/useHomeQueries';

import { HomeCanvas } from './HomeCanvas';
import { SessionSwitcher } from './SessionSwitcher';

/** 홈 셸 — 세션 헤더 + 캔버스. 세션은 전역 Provider 가 소유. */
export function HomeShell() {
  const session = useHomeSessionContext();
  const sessions = useSessions();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 캔버스 헤더 — 세션 스위처 */}
      <header className="flex h-10 shrink-0 items-center border-b px-4" data-testid="canvas-header">
        <SessionSwitcher
          sessions={sessions.data?.items ?? []}
          currentSessionId={session.sessionId}
          onNew={session.newSession}
          onSelect={session.restoreSession}
          onDelete={session.deleteSession}
        />
      </header>
      <div className="relative flex-1 overflow-hidden">
        <HomeCanvas pages={session.pages} activeIndex={session.activeIndex} onSelectPage={session.setActive} />
      </div>
    </div>
  );
}
