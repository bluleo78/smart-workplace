// 남은 페이지를 끝까지 받는 화면(useFetchAllPages — 그룹 보드·타임라인·종료 에픽)의 「다음 페이지 실패」 안내(WP-1007).
// 자동 로드는 실패하면 멈추므로(끝없는 재요청 방지) 받은 만큼만 보인 채 남는다 — 일부만 보인다는 사실과 다시 시도를 한 줄로 알린다.
// 그룹 보드의 기존 안내(WP-996)와 같은 문구·모양을 세 화면이 함께 쓴다. 보일지 판정은 remainingPagesFailed(useFetchAllPages).
import { cn } from '@/lib/utils';

export function RemainingPagesError({
  message,
  onRetry,
  className,
  'data-testid': testId,
}: {
  /** 안내 문구 — 「나머지 이슈를 불러오지 못했습니다.」처럼 무엇이 빠졌는지(조사가 명사마다 달라 문장째 받는다). */
  message: string;
  onRetry: () => void;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <p className={cn('text-xs text-destructive', className)} data-testid={testId}>
      {message}{' '}
      {/* 터치에서는 보이지 않는 ::after 로 누르는 영역을 넓힌다(글자 높이만으로는 44px 에 못 미친다) — 종료 에픽 ↗ 링크와 같은 방식. */}
      <button
        type="button"
        className="relative underline pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']"
        onClick={onRetry}
      >
        다시 시도
      </button>
    </p>
  );
}
