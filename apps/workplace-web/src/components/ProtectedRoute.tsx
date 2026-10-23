import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { useAuth } from '../hooks/useAuth';
import { savePendingPushTarget } from '../lib/push/openTarget';

/**
 * 로그인 뒤 돌아올 주소로 남기는 경로 — 공유 링크 진입(WP-579 설계 범위)만. /wiki/share/ 는 지금 이 라우트 밖(외부 보기 화면이 스스로 남김)이지만
 * 같은 규칙으로 둔다. 그 밖의 보호 경로는 남기지 않는다: 로그아웃·세션 만료 직후 같은 탭에서 다른 계정으로 로그인하면 이전 사용자의 화면으로 튀기 때문이다.
 */
const LOGIN_RETURN_PREFIXES = ['/wiki/share/', '/wiki/open/']

export function ProtectedRoute() {
  const { isLoading, isAuthenticated, connectionError, retryAuth, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // 세션 확인이 일시 오류(배포 중·서버 장애·네트워크)로 실패 — 로그인으로 보내지 않고 다시 시도를 준다(WP-859).
  // 세션은 남아 있어 서버가 돌아오면 다시 시도(또는 새로고침)로 그대로 들어간다.
  if (connectionError && !isAuthenticated) {
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"
        data-testid="auth-connection-error"
      >
        <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
        <div className="space-y-2">
          <p className="text-lg font-semibold">서버에 연결하지 못했습니다</p>
          <p className="max-w-md text-sm text-muted-foreground">
            잠시 서버에 닿지 않았어요. 로그인은 그대로 남아 있으니 잠시 뒤 다시 시도해 주세요.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Button variant="outline" onClick={retryAuth} data-testid="auth-connection-retry">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            다시 시도
          </Button>
          {/* 이 세션에만 서버가 계속 실패하는 경우의 빠져나갈 길 — 세션을 지우고(서버 로그아웃 실패는 무시) 로그인 화면으로. */}
          <Button
            variant="link"
            size="sm"
            onClick={() => void logout().catch(() => {}).then(() => navigate('/login', { replace: true }))}
            data-testid="auth-connection-login"
          >
            다른 계정으로 로그인
          </Button>
        </div>
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
