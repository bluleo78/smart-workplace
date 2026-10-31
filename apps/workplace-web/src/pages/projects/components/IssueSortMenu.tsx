// 이슈 목록·보드 「⇅ 정렬」 칩 + 메뉴(WP-1238) — 필터 막대 오른쪽 보기 설정 묶음에 놓는다.
// 한 기준만 고른다(수정일·마감일·우선순위·생성일·상태·담당자) + 오름차순/내림차순 + 「기본으로」.
// 값은 URL(sort·direction)이 원본이라 이 컴포넌트는 고른 값을 onChange 로만 넘긴다(저장은 useIssueFilterControls.setSort).
// 항목·체크·고른 뒤 값은 모바일 시트와 같은 sortMenuModel 에서 오고, 여기는 마크업만 맡는다.
import { ArrowUpDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import { Button } from '@/components/ui/button';
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

import {
  DEFAULT_SORT,
  ISSUE_SORT_DIRECTION_LABEL,
  ISSUE_SORT_LABEL,
  type IssueSortValue,
  sortChipLabel,
  sortMenuModel,
  type SortMenuOption,
} from '../../../lib/issueSort';

const SECTION_LABEL_CLASS = 'text-xs font-normal text-muted-foreground';

export function IssueSortMenu({
  sort,
  onChange,
}: {
  /** 고른 정렬 — null 이면 기본(수정일 내림차순, 서버 기본). */
  sort: IssueSortValue | null;
  onChange: (next: IssueSortValue | null) => void;
}) {
  const { keys, directions } = sortMenuModel(sort);
  // 한 묶음(기준 또는 방향)의 라디오 — 골라도 메뉴를 닫지 않는다(preventDefault): 기준을 고르고 이어서 방향을 바꾸며 뒤의 목록을 볼 수 있게(열 메뉴와 같다).
  // 기본 상태의 체크는 실제 순서인 수정일·내림차순이고, 그 조합을 다시 골라도 기본 그대로다(sortMenuModel).
  const radios = <T extends string>(options: SortMenuOption<T>[], testIdPrefix: string, hint?: (v: T) => string | null) => (
    <DropdownMenuRadioGroup value={options.find((o) => o.checked)?.value}>
      {options.map((o) => (
        <DropdownMenuRadioItem
          key={o.value}
          value={o.value}
          data-testid={`${testIdPrefix}-${o.value}`}
          onSelect={(e) => {
            e.preventDefault();
            onChange(o.next);
          }}
        >
          {o.label}
          {hint?.(o.value) && <span className="ml-auto text-xs text-muted-foreground">{hint(o.value)}</span>}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* 기본일 땐 「⇅ 정렬」만 보이는 수수한 칩, 고르면 기준·방향을 보이고 켜짐(primary) 표시 — 지금 순서가 기본이 아님을 알린다. */}
        <Button
          variant="outline"
          size="sm"
          data-testid="issue-sort-chip"
          aria-label={`정렬 기준 — ${sort ? `${ISSUE_SORT_LABEL[sort.key]} ${ISSUE_SORT_DIRECTION_LABEL[sort.direction]}` : '기본(수정일)'}`}
          className={cn(sort ? TOGGLE_ON_CLASS : 'text-muted-foreground')}
        >
          <ArrowUpDown aria-hidden="true" /> {sortChipLabel(sort)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" data-testid="issue-sort-menu">
        <DropdownMenuLabel className={SECTION_LABEL_CLASS}>정렬 기준</DropdownMenuLabel>
        {radios(keys, 'issue-sort-key', (k) => (k === DEFAULT_SORT.key ? '기본' : null))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={SECTION_LABEL_CLASS}>방향</DropdownMenuLabel>
        {radios(directions, 'issue-sort-direction')}
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="issue-sort-reset" disabled={!sort} onSelect={() => onChange(null)}>
          기본으로
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
