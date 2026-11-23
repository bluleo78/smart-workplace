/**
 * 페이지 수준 ErrorBoundary 컴포넌트
 *
 * lazy-loaded 페이지 컴포넌트에서 uncaught 렌더링 에러가 발생했을 때
 * 흰 화면(WSOD) 대신 사용자 친화적인 오류 메시지를 표시한다.
 *
 * WidgetErrorBoundary는 위젯 단위의 작은 오류를 처리하고,
 * 이 컴포넌트는 페이지 전체를 감싸는 최상위 오류 경계 역할을 한다.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

import { isChunkLoadError } from '@/lib/chunkLoadError';

import { Button } from './ui/button';

interface Props {
  children: ReactNode;
  /** 오류 중 이 값이 바뀌면(`!==`) 오류 상태를 풀고 자식을 다시 그린다 — 예: 주소(pathname) (WP-2024) */
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  error: Error | null;
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

  /**
   * resetKey 가 바뀌면 오류를 푼다. 앱 전체를 감싼 경계가 주소를 바꿔도 오류 화면에 갇히는 문제(WP-2024)를 막는다.
   * 오류 중일 때만 되돌려, 정상 상태에서는 불필요한 state 갱신이 없다.
   * 이전 상태에도 오류가 있었을 때만 푼다 — 새 주소에서 막 오류를 잡은 그 커밋은 prevProps 가 옛 주소라,
   * 그때 풀면 깨진 화면을 곧바로 한 번 더 그려 오류를 두 번 잡는다(react-error-boundary 와 같은 판정).
   */
  componentDidUpdate(prevProps: Props, prevState: State) {
    if (this.state.hasError && prevState.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
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
              일시적인 오류가 발생했습니다. 다시 시도하거나 페이지를 새로고침해 주세요.
            </p>
          </div>
          <Button variant="outline" onClick={this.handleRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            다시 시도
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
