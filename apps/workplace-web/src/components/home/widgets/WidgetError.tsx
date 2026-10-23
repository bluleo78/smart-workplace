import { LoadErrorState } from '@/components/LoadErrorState';

/**
 * 홈 위젯 공통 인라인 에러 상태 — 데이터 fetch 실패(5xx 등) 시 표시(#205).
 * 거짓 '빈 상태'와 명확히 구분하기 위해 destructive 안내문 + '다시 시도'(refetch) 버튼을 제공한다.
 * 모양은 앱 공통 불러오기 실패 상태(LoadErrorState inline, WP-865)를 그대로 쓴다 — 위젯만 여백이 조금 넓다.
 */
export function WidgetError({
  message = '불러오지 못했습니다',
  onRetry,
  retrying,
  testId,
}: {
  message?: string;
  onRetry: () => void;
  /** 다시 부르는 중 — 버튼을 잠근다(연타가 같은 요청을 거듭 보내지 않게). */
  retrying?: boolean;
  testId: string;
}) {
  return <LoadErrorState variant="inline" title={message} onRetry={onRetry} retrying={retrying} className="px-4 py-6" testId={testId} />;
}
