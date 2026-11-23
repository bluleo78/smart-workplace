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

import { clearChunkReload, isChunkFailureAfterReload, isChunkLoadError, markChunkReload } from '@/lib/chunkLoadError';

import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** 청크 실패로 새로고침한 직후 또 청크 실패가 났는가 — 새로고침으로는 낫지 않는 경우(옛 index.html 캐시 등)라 다른 안내를 보인다. */
  chunkFailedAfterReload: boolean;
}

export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, chunkFailedAfterReload: false };
  }

  /** React가 렌더링 오류를 감지했을 때 state를 에러 상태로 전환 — 청크 실패면 새로고침 직후의 되풀이인지도 본다 */
  static getDerivedStateFromError(error: Error): State {
    const chunkFailedAfterReload = isChunkFailureAfterReload(error);
    return { hasError: true, error, chunkFailedAfterReload };
  }

  /** 오류 상세를 콘솔에 기록하고(프로덕션 로깅 서비스 연동 가능), 새로고침 직후 되풀이면 새로고침 표시를 지운다 */
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info);
    // 되풀이를 알린 때만 표시를 지운다 — 다른 오류·다른 경계가 지우면 진짜 되풀이를 놓친다
    if (this.state.chunkFailedAfterReload) clearChunkReload();
  }

  /**
   * 다시 시도 — 오류 상태를 풀고 다시 그린다. 청크 로드 실패(배포 중 502·옛 묶음 이름)는 같은 문서에서 다시 그려도
   * 같은 실패가 되풀이되므로(모듈 맵·React.lazy 가 실패를 쥔다) 페이지를 새로고침해 다시 받는다(WP-2021).
   */
  handleRetry = () => {
    const { error } = this.state;
    if (error && isChunkLoadError(error)) {
      markChunkReload(error);
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null, chunkFailedAfterReload: false });
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
              {this.state.chunkFailedAfterReload
                ? '새로고침해도 화면 파일을 받지 못했습니다. 새 버전이 배포되는 중이면 잠시 뒤 다시 열고, 계속되면 브라우저 캐시를 지운 뒤 다시 열어 주세요.'
                : '일시적인 오류가 발생했습니다. 다시 시도하거나 페이지를 새로고침해 주세요.'}
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
