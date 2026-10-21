import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';
import { savePendingPushTarget } from '../lib/push/openTarget';

/**
 * 로그인 뒤 돌아올 주소로 남기는 경로 — 공유 링크 진입(WP-579 설계 범위)만. /wiki/share/ 는 지금 이 라우트 밖(외부 보기 화면이 스스로 남김)이지만
 * 같은 규칙으로 둔다. 그 밖의 보호 경로는 남기지 않는다: 로그아웃·세션 만료 직후 같은 탭에서 다른 계정으로 로그인하면 이전 사용자의 화면으로 튀기 때문이다.
 */
const LOGIN_RETURN_PREFIXES = ['/wiki/share/', '/wiki/open/']

export function ProtectedRoute() {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // 공유 링크로 들어왔으면 로그인 뒤 그 주소로 돌아오게 남긴다 — 알림 열기와 같은 대기 목적지를 AppLayout 이 1회 소비한다.
    if (LOGIN_RETURN_PREFIXES.some((p) => location.pathname.startsWith(p))) {
      savePendingPushTarget({ tenantId: null, url: location.pathname + location.search });
    }
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
