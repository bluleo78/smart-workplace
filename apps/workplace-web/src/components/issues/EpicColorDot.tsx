// 에픽 색점(WP-1017) — 에픽 고르개·시트·메뉴 항목 앞의 ●. 에픽마다 정한 색(없으면 유형 색)으로 칠해 목록·타임라인의 같은 에픽과 이어 보이게 한다.

import { epicColorToken, epicDotClass } from '@/lib/epicColor';
import { cn } from '@/lib/utils';
import type { IssueTypeSummary } from '@/types/issueType';

export function EpicColorDot({
  epic,
  className,
}: {
  epic: { number: number; epicColor?: string | null; type?: IssueTypeSummary | null };
  className?: string;
}) {
  return (
    <span
      className={cn('size-2 shrink-0 rounded-full', epicDotClass(epicColorToken(epic)), className)}
      data-testid={`epic-color-dot-${epic.number}`}
      aria-hidden="true"
    />
  );
}
