// 이슈 행·카드의 「⋯」 버튼(WP-273) — 목록 행(데스크톱 끝 칸·모바일 셀)과 보드 카드가 공유한다.
// 메뉴 자체는 목록·보드가 하나만 소유하므로 버튼은 openMenu(issue, 버튼 아래 모서리) 만 부른다(모바일은 좌표 무시 → 시트).
// 행·카드는 클릭=상세 이동, pointerdown=드래그·길게 누르기라 버튼에서 두 이벤트를 모두 멈춘다.
import { MoreHorizontal } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { IssueResponse } from '../../../types/issue';
import type { OpenRowMenu } from '../hooks/useIssueRowActions';

export function RowMenuButton({
  issue,
  onOpenMenu,
  open = false,
  alwaysVisible = false,
  testId,
  className,
}: {
  issue: IssueResponse;
  onOpenMenu: OpenRowMenu;
  /** 메뉴가 열린 동안 — 호버가 빠져도 계속 보인다. */
  open?: boolean;
  /** 모바일 — 호버가 없으므로 항상 보인다(시안 M1). */
  alwaysVisible?: boolean;
  testId: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`${issue.projectKey}-${issue.number} 작업 메뉴`}
      aria-haspopup="menu"
      aria-expanded={open}
      data-testid={testId}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        // 카드의 전면 오버레이 링크·행 onClick(상세 이동)으로 새지 않게.
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onOpenMenu(issue, { x: r.right, y: r.bottom, align: 'end' });
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        alwaysVisible
          ? 'size-9 -my-1.5 -mr-1 active:bg-accent'
          : 'size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        open && 'bg-muted text-foreground opacity-100',
        className,
      )}
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </button>
  );
}
