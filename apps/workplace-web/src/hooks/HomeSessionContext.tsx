// 홈 세션 상태(캔버스 + 챗 transcript)를 AppLayout 레벨에서 제공.
// 챗 도크는 전역 상주(모든 모듈), 캔버스는 홈 모듈 전용 — 둘이 같은 세션을 공유.
import type { ReactNode } from 'react';

import { DEFAULT_SPECS, HomeSessionContext } from './home-session-context';
import { useHomeSession } from './useHomeSession';

export function HomeSessionProvider({ children }: { children: ReactNode }) {
  const session = useHomeSession(DEFAULT_SPECS);
  return <HomeSessionContext value={session}>{children}</HomeSessionContext>;
}
