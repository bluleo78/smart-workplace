import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { PageErrorBoundary } from './PageErrorBoundary';

/**
 * 앱 전체를 감싸는 오류 경계 — 주소(pathname)가 바뀌면 오류 화면을 푼다 (WP-2024).
 *
 * 한 화면이 터져 오류 화면이 뜬 뒤 브라우저 뒤로·앞으로 가기나 주소 입력으로 다른 주소에 가도 오류 화면이 남던 문제를 막는다.
 * (이 경계는 앱 셸까지 감싸 오류 화면에는 사이드바가 없다 — 셸을 살리는 안쪽 경계는 이 이슈 밖이다.)
 * useLocation 을 App 이 아니라 이 감싸개에서 읽는 이유: App 이 읽으면 이동마다 App 전체가 다시 그려진다.
 * search·hash 만 바뀌는 이동은 같은 화면이므로 pathname 만 resetKey 로 쓴다.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <PageErrorBoundary resetKey={pathname}>{children}</PageErrorBoundary>;
}
