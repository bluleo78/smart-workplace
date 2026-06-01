// 홈 세션 상태(캔버스 + 챗 transcript)를 AppLayout 레벨에서 제공.
// 챗 도크는 전역 상주(모든 모듈), 캔버스는 홈 모듈 전용 — 둘이 같은 세션을 공유.
import { createContext, useContext, type ReactNode } from 'react';

import { useHomeSession } from './useHomeSession';
import type { WidgetSpec } from '@/types/home';

// 홈 캔버스 기본 위젯 사양 — 안정 참조(모듈 const, useHomeSession deps).
const DEFAULT_SPECS: WidgetSpec[] = [
  { type: 'my_tasks' },
  { type: 'issue_list', params: { assignee: 'me', status: 'IN_PROGRESS' } },
  { type: 'activity' },
];

type HomeSessionValue = ReturnType<typeof useHomeSession>;

const HomeSessionContext = createContext<HomeSessionValue | null>(null);

export function HomeSessionProvider({ children }: { children: ReactNode }) {
  const session = useHomeSession(DEFAULT_SPECS);
  return <HomeSessionContext value={session}>{children}</HomeSessionContext>;
}

// 세션 컨텍스트 소비 훅. Provider 밖에서 호출 시 에러.
export function useHomeSessionContext(): HomeSessionValue {
  const ctx = useContext(HomeSessionContext);
  if (!ctx) throw new Error('useHomeSessionContext must be used within HomeSessionProvider');
  return ctx;
}
