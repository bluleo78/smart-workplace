// 목록 열 머리 정렬 단추(WP-1238) — 평면 목록 thead 와 사이클 구간 목록 열 이름 행이 같이 쓴다.
// 누르면 오름차순 → 내림차순 → 기본 순으로 돌고(cycleHeaderSort), 정렬된 열엔 primary 화살표를 보인다.
// 머리 칸은 SortableTh 하나로 그린다 — 정렬 대상이면 aria-sort 를 단 <th> + 정렬 단추, 아니면 평범한 <th>(children).
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { ariaSortOf, cycleHeaderSort, type IssueSortValue } from '../../../lib/issueSort';
import type { IssueSortKey } from '../../../types/issue';

/** 열 머리의 정렬 대상 — 지금 정렬과 바꾸는 함수. 없으면(정렬을 쓰지 않는 화면·0 높이 폭 정의 행) 머리는 예전처럼 글자만. */
export interface HeadSort {
  sort: IssueSortValue | null;
  onSort: (next: IssueSortValue | null) => void;
}

export function SortHeaderButton({
  label,
  sortKey,
  head,
  srOnlyLabel = false,
}: {
  label: string;
  sortKey: IssueSortKey;
  head: HeadSort;
  /** 아이콘 열(상태·우선순위)처럼 머리 글자를 스크린리더에만 둘 때 — 화살표만 보인다. */
  srOnlyLabel?: boolean;
}) {
  const active = head.sort?.key === sortKey ? head.sort.direction : null;
  const Icon = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => head.onSort(cycleHeaderSort(head.sort, sortKey))}
      data-testid={`issue-sort-head-${sortKey}`}
      // 머리 글자를 그대로 이름으로 둔다 — 정렬 상태는 <th> 의 aria-sort 가 알린다.
      className={cn(
        'group/sort inline-flex max-w-full items-center gap-0.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'text-primary',
      )}
    >
      <span className={cn(srOnlyLabel ? 'sr-only' : 'truncate')}>{label}</span>
      {/* 정렬 안 된 열은 마우스를 올리거나 초점이 올 때만 흐린 ⇅ — 평소 머리 줄을 어지럽히지 않는다. */}
      <Icon
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0',
          !active && 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60',
        )}
      />
    </button>
  );
}

/**
 * 목록 머리 칸 — head·sortKey 가 모두 있으면 정렬 칸(<th aria-sort> + SortHeaderButton), 아니면 children 을 담은 평범한 칸.
 * 평면 목록·사이클 구간 머리의 고정 상태 열과 선택 열(columnHeadCells)이 같은 짝을 반복하지 않게 모았다.
 */
export function SortableTh({
  className,
  head,
  sortKey,
  label,
  srOnlyLabel = false,
  children,
}: {
  className?: string;
  head?: HeadSort;
  sortKey?: IssueSortKey;
  label: string;
  srOnlyLabel?: boolean;
  /** 정렬 칸이 아닐 때의 내용. */
  children: ReactNode;
}) {
  if (!head || !sortKey) return <th className={className}>{children}</th>;
  return (
    <th className={className} aria-sort={ariaSortOf(head.sort, sortKey)}>
      <SortHeaderButton label={label} sortKey={sortKey} head={head} srOnlyLabel={srOnlyLabel} />
    </th>
  );
}
