/**
 * 페이지 수준 ErrorBoundary 컴포넌트
 *
 * lazy-loaded 페이지 컴포넌트에서 uncaught 렌더링 에러가 발생했을 때
 * 흰 화면(WSOD) 대신 사용자 친화적인 오류 메시지를 표시한다.
 *
 * WidgetErrorBoundary는 위젯 단위의 작은 오류를 처리하고,
 * 이 컴포넌트는 페이지 전체를 감싸는 최상위 오류 경계 역할을 한다.
 *
 * 폴백이 useNavigate 를 쓰므로 react-router 의 Router 안에서만 그린다 — 밖에 두면
 * 오류 화면을 그리는 순간 라우터 훅이 실패해 오류 보호 자체가 사라지고 흰 화면이 된다.
 */
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { useNavigate } from 'react-router-dom';

import { isChunkLoadError } from '@/lib/chunkLoadError';

import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 오류 화면에서 홈으로 가는 단추.
 *
 * 주소를 먼저 바꾸고(`navigate('/')`) 오류 상태를 푼다 — 순서를 바꾸면 갱신이 따로 흘러
 * 옛 주소에서 자식을 다시 그려 같은 오류가 되풀이된다. 시작점에는 react-router 의
 * `resetKey` 가 없어 주소만 바꾸면 화면이 남으므로 오류 경계 스스로 상태를 풀어 준다
 * (main 합치면 `RouteErrorBoundary` 가 같은 일을 한다).
 */
// eslint-disable-next-line react-refresh/only-export-components -- 규칙이 export class 를 컴포넌트 export 로 세지 못해 로컬 컴포넌트가 있으면 오탐한다. 이 파일은 컴포넌트만 export 한다(WP-2028).
function HomeButton({ onDismiss }: { onDismiss: () => void }) {
  const navigate = useNavigate();
  const handleClick = () => {
    // replace: 설치형 PWA 에서 뒤로 가기·스와이프백으로 방금 나온 오류 주소에 다시 갇히지 않게 이전 기록을 덮어쓴다.
    navigate('/', { replace: true });
    onDismiss();
  };
  return (
    <Button variant="outline" onClick={handleClick}>
      <Home className="mr-2 h-4 w-4" />
      홈으로
    </Button>
  );
}

export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /** React가 렌더링 오류를 감지했을 때 state를 에러 상태로 전환 */
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  /** 오류 상세를 콘솔에 기록 (프로덕션 로깅 서비스 연동 가능) */
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info);
  }

  /**
   * 다시 시도 — 오류 상태를 풀고 다시 그린다. 청크 로드 실패(배포 중 502·옛 묶음 이름)는 같은 문서에서 다시 그려도
   * 같은 실패가 되풀이되므로(모듈 맵·React.lazy 가 실패를 쥔다) 페이지를 새로고침해 다시 받는다(WP-2021).
   */
  handleRetry = () => {
    if (isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  /**
   * 홈으로 가기 — 오류 상태를 풀어 오류 화면을 닫는다. 주소 이동(`HomeButton`) 뒤에 불리므로
   * 새 주소에서 자식을 다시 그린다. resetKey 가 없는 시작점에서는 이 자체 해소가 없으면
   * 주소만 바꾸고 화면이 남는다(WP-2028).
   */
  handleDismissError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">
              페이지를 불러오는 중 문제가 발생했습니다
            </h2>
            <p className="text-sm text-muted-foreground max-w-md">
              일시적인 오류가 발생했습니다. 다시 시도하거나 홈으로 돌아갈 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" onClick={this.handleRetry}>
              <RefreshCw className="mr-2 h-4 w-4" />
              다시 시도
            </Button>
            <HomeButton onDismiss={this.handleDismissError} />
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
