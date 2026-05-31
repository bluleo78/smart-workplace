import { useSessions } from '@/hooks/queries/useHomeQueries';
import { useHomeSession } from '@/hooks/useHomeSession';
import type { WidgetSpec } from '@/types/home';

import { FloatingChat } from './FloatingChat';
import { HomeCanvas } from './HomeCanvas';
import { ModuleSidebar } from './ModuleSidebar';
import { SessionSwitcher } from './SessionSwitcher';

// 기본 구성(AI 호출 없이 즉시 렌더) — 설계 §6. 모듈 const(안정 참조 — useHomeSession deps).
const DEFAULT_SPECS: WidgetSpec[] = [
  { type: 'my_tasks' },
  { type: 'issue_list', params: { assignee: 'me', status: 'IN_PROGRESS' } },
  { type: 'activity' },
];

/** 홈 셸 — 사이드바 + (세션 헤더 + 캔버스 + 떠있는 챗). 세션 전이는 useHomeSession 이 소유. */
export function HomeShell() {
  const session = useHomeSession(DEFAULT_SPECS);
  const sessions = useSessions();

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <ModuleSidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
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
          <FloatingChat
            turns={session.turns}
            pending={session.pending}
            collapseOnComplete={session.collapseOnComplete}
            onSubmit={session.submitQuery}
          />
        </div>
      </main>
    </div>
  );
}
