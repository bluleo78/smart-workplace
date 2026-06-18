import { Button } from '@/components/ui/button';

/**
 * 홈 위젯 공통 인라인 에러 상태 — 데이터 fetch 실패(5xx 등) 시 표시(#205).
 * 거짓 '빈 상태'와 명확히 구분하기 위해 destructive 안내문 + '다시 시도'(refetch) 버튼을 제공한다.
 * 디자인 시스템 06. Feedback States §C(Inline Error: text-destructive + outline 재시도)를 따른다.
 */
export function WidgetError({
  message = '불러오지 못했습니다',
  onRetry,
  testId,
}: {
  message?: string;
  onRetry: () => void;
  testId: string;
}) {
  return (
    <div
      // I3(a11y): 에러는 즉시 안내가 필요하므로 role="alert"(assertive live region).
      role="alert"
      className="flex flex-col items-center gap-2 px-4 py-6 text-center"
      data-testid={testId}
    >
      <p className="text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}
