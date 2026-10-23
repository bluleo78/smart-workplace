import { ArrowLeft, Home } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { PageLoader } from '@/components/layout/PageLoader';
import { Button } from '@/components/ui/button';
import { browserOutdatedAppEnv, isSwControlled, recoverOutdatedApp } from '@/lib/pwa/outdatedApp';

/** 옛 버전 앱이라 모르는 주소인지 확인하는 동안 true(WP-872 — 판단은 lib/pwa/outdatedApp). SW 관리 밖이면 확인하지 않는다. */
function useOutdatedAppCheck(): boolean {
  const { pathname } = useLocation();
  // sw.ts 는 clients.claim 을 하지 않아 열린 동안 관리 여부가 바뀌지 않는다.
  const controlled = isSwControlled();
  // 404 로 판정한 주소 — 새 버전을 적용하면 새로고침될 때까지 확인 중으로 남고, 다른 없는 주소로 옮기면 다시 확인한다.
  const [notFoundPath, setNotFoundPath] = useState<string | null>(null);

  useEffect(() => {
    if (!controlled) return;
    // 화면을 떠나면 확인을 중단한다 — 다른 화면에서 갑자기 새로고침되지 않게.
    const controller = new AbortController();
    recoverOutdatedApp(browserOutdatedAppEnv(pathname, controller.signal))
      .catch(() => false)
      .then((recovering) => {
        if (!recovering && !controller.signal.aborted) setNotFoundPath(pathname);
      });
    return () => controller.abort();
  }, [controlled, pathname]);

  return controlled && notFoundPath !== pathname;
}

/**
 * 404 페이지 — 존재하지 않는 라우트 진입 시 표시.
 * AppLayout 내부에서 렌더되어 사이드바·헤더가 함께 노출되므로
 * 사용자는 즉시 다른 메뉴로 이동하거나 이전 페이지로 복귀할 수 있다.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  const checking = useOutdatedAppCheck();
  if (checking) return <PageLoader />;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center min-h-[60vh]">
      <h1 className="text-8xl font-bold text-muted-foreground">404</h1>
      <p className="text-xl font-semibold">페이지를 찾을 수 없습니다</p>
      <p className="text-sm text-muted-foreground">
        요청하신 페이지가 존재하지 않거나 이동되었습니다.
      </p>
      <div className="flex gap-2 mt-2">
        {/* 이전 페이지로 — 사용자가 잘못 클릭한 경우 빠르게 복귀 */}
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          이전 페이지로
        </Button>
        {/* 홈으로 — 컨텍스트를 잃은 경우의 안전한 시작점 */}
        <Button onClick={() => navigate('/')}>
          <Home className="h-4 w-4 mr-1" />
          홈으로 가기
        </Button>
      </div>
    </div>
  );
}
