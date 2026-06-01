// 홈 모듈 콘텐츠 — AI 캔버스 + 세션 스위처. 챗 도크/네비는 전역 셸이 담당.
import { appTitleTextClass } from '@/components/layout/sidebar-link';
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
      {/* 홈 헤더 — 사이드바가 없는 홈은 이 상단 헤더가 앱 타이틀을 담당한다.
          좌측: 앱 타이틀(Smart Workplace) / 우측: 세션 스위처. 중앙은 전역 AI 칩 자리로 비운다.
          h-14·border-b 로 레일 앱 마크 헤더 및 타 모듈 사이드바 타이틀과 가로 정렬. */}
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b px-4"
        data-testid="canvas-header"
      >
        {/* 홈은 제품 워드마크 자체가 타이틀이라 아이콘 생략(레일 앱 마크와 중복 회피) */}
        <div className={appTitleTextClass}>Smart Workplace</div>
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
