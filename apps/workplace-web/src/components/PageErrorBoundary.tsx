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

import { clearChunkReload, isChunkFailureAfterReload, isChunkLoadError, markChunkReload } from '@/lib/chunkLoadError';

import { Button } from './ui/button';

interface Props {
  children: ReactNode;
  /** 오류 중 이 값이 바뀌면(`!==`) 오류 상태를 풀고 자식을 다시 그린다 — 예: 주소(pathname) (WP-2024) */
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** 청크 실패로 새로고침한 직후 또 청크 실패가 났는가 — 새로고침으로는 낫지 않는 경우(옛 index.html 캐시 등)라 다른 안내를 보인다. */
  chunkFailedAfterReload: boolean;
}

/**
 * 오류 화면에서 홈으로 가는 단추.
 *
 * 주소를 홈으로 바꾸고(`navigate('/')`) 오류 상태를 푼다. 라우터의 이동은 낮은 우선순위로 반영될 수 있어
 * 오류 해소가 먼저 그려지면 옛 주소의 자식이 다시 던질 수 있다 — 그래도 이동이 반영되면
 * `RouteErrorBoundary` 의 `resetKey`(pathname) 가 바뀌어 `componentDidUpdate` 가 오류를 다시 푼다(WP-2024).
 * 직접 푸는 것(`onDismiss`)은 resetKey 없이 쓰인 경계(테스트 등)에서도 홈 단추가 동작하게 한다.
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
    this.state = { hasError: false, error: null, chunkFailedAfterReload: false };
  }

  /** React가 렌더링 오류를 감지했을 때 state를 에러 상태로 전환 — 청크 실패면 새로고침 직후의 되풀이인지도 본다 */
  static getDerivedStateFromError(error: Error): State {
    const chunkFailedAfterReload = isChunkFailureAfterReload(error);
    return { hasError: true, error, chunkFailedAfterReload };
  }

  /**
   * resetKey 가 바뀌면 오류를 푼다. 앱 전체를 감싼 경계가 주소를 바꿔도 오류 화면에 갇히는 문제(WP-2024)를 막는다.
   * 오류 중일 때만 되돌려, 정상 상태에서는 불필요한 state 갱신이 없다.
   * 이전 상태에도 오류가 있었을 때만 푼다 — 새 주소에서 막 오류를 잡은 그 커밋은 prevProps 가 옛 주소라,
   * 그때 풀면 깨진 화면을 곧바로 한 번 더 그려 오류를 두 번 잡는다(react-error-boundary 와 같은 판정).
   * 청크 되풀이 표시(WP-2021)도 함께 지운다 — 다른 주소에서 난 새 오류에 옛 안내가 남지 않게.
   */
  componentDidUpdate(prevProps: Props, prevState: State) {
    if (this.state.hasError && prevState.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, chunkFailedAfterReload: false });
    }
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

  /**
   * 홈으로 가기 — 오류 상태를 풀어 오류 화면을 닫는다(청크 되풀이 표시도 함께 지운다). 주소 이동(`HomeButton`) 과
   * 함께 불린다 — resetKey 가 없는 경계에서도 홈 단추가 동작하게 하고, resetKey 가 있으면 이동 반영 뒤 한 번 더 풀린다(WP-2028).
   */
  handleDismissError = () => {
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
                : '일시적인 오류가 발생했습니다. 다시 시도하거나 홈으로 돌아갈 수 있습니다.'}
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
