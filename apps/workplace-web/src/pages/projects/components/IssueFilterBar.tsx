// 태스크 필터/검색 + 뷰(list/board) 토글 바.
// URL 의 SearchParams 가 단일 source of truth — 로직은 useIssueFilterControls 훅이 담당하고 이 컴포넌트는 렌더만 한다.

import { LayoutGrid, List } from 'lucide-react';

import { QuickFilterBar } from '@/components/filter';
import { FilterLine } from '@/components/filter/FilterLine';
import { ShowAllClosedToggle } from '@/components/issue/ShowAllClosedToggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import { FilterInput } from '@/components/ui/filter-input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import type { IssueGroupBy } from '../../../types/issue';
import { type IssueFilterBarOptions, useIssueFilterControls } from '../hooks/useIssueFilterControls';
import { IssueColumnPickerButton } from './IssueColumnPicker';
import { IssueSortMenu } from './IssueSortMenu';

export function IssueFilterBar({
  projectKey,
  options,
}: {
  projectKey: string;
  options?: IssueFilterBarOptions;
}) {
  const c = useIssueFilterControls(projectKey, options);
  const listLabel = options?.listLabel ?? '리스트';
  const ListIcon = options?.listIcon ?? List;

  return (
    // 필터 줄(WP-1355) — 키워드(제목·키) → 빠른 필터 칩 → 「필터 지우기」 → 오른쪽 끝 보기 설정. 슬롯 배치는 FilterLine 이 맡는다.
    <FilterLine
      className="py-2"
      data-testid="issue-filter-main"
      keyword={
        // 길이 상한(WP-732)은 FilterInput 내부에서 건다.
        // 자리표시는 대상 필드만, 접근성 이름은 목적까지(「태스크 필터: 제목·키」).
        <FilterInput value={c.qDraft} onChange={c.setQDraft} placeholder="제목·키" aria-label="태스크 필터: 제목·키" />
      }
      // 빠른 필터 칩 — 자주 쓰는 facet 은 칩으로 바로, 나머지는 「더 보기」(WP-1020). 칩 고정·숨김은 화면·사용자별로 기억한다.
      // 필터 줄 안에서는 FilterLine 이 줄바꿈을 막고, 넘치면 칩 묶음만 가로 스크롤한다(필터 줄 규칙 5).
      chips={
        <QuickFilterBar
          facets={c.facets}
          value={c.filterValue}
          onChange={c.onFilterChange}
          defaultChips={c.quickChips}
          storageKey={c.quickFilterStorageKey}
        />
      }
      // 「필터 지우기」 — 예전 「초기화」와 같은 범위(검색어 포함 필터 전부, view·group·열 구성은 유지).
      // 칩 스크롤에 가려지지 않도록 chips 밖 clear 슬롯에 둔다(필터 줄 규칙 6). 걸린 필터가 없으면 슬롯을 비운다.
      clear={
        c.hasActiveFilters ? (
          <button
            type="button"
            onClick={c.reset}
            data-testid="quick-filter-clear-all"
            className="h-8 px-1.5 text-sm font-medium whitespace-nowrap text-primary hover:underline"
          >
            필터 지우기
          </button>
        ) : undefined
      }
      // 오른쪽 끝 묶음 — 보기 설정(완료 모두 보기·그룹·정렬·열·뷰 전환).
      end={
        <>
          {/* 「완료 모두 보기」 — 종료 이슈 숨김 기본 범위(withDefaultIssueScope)를 쓰는 화면만 노출.
            상태·사이클 등 명시 필터가 이미 숨김을 해제했으면 눌린 상태로 비활성화한다. */}
          {c.showClosedToggle && (
            <ShowAllClosedToggle
              on={c.filters.showAllClosed}
              overridden={c.closedHidingOverridden}
              onToggle={c.toggleShowAllClosed}
            />
          )}
          {/* 그룹 기준 — 셀렉트(드롭다운). null='none' 으로 매핑. */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">그룹</span>
            <Select
              value={c.groupBy ?? 'none'}
              onValueChange={(v) => c.setGroupBy(v === 'none' ? null : (v as IssueGroupBy))}
            >
              <SelectTrigger
                size="sm"
                className="w-28"
                aria-label="그룹 기준"
                data-testid="group-by-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {c.visibleGroupOptions.map((opt) => (
                  <SelectItem
                    key={opt.value ?? 'none'}
                    value={opt.value ?? 'none'}
                    data-testid={`group-by-${opt.value ?? 'none'}`}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* 정렬(WP-1238) — 목록·보드 공용(보드는 컬럼 안 카드 순서). 목록 열 머리 클릭과 같은 URL 값을 보여 준다.
            checklist 순서를 쓰는 개인 화면은 options.showSort=false 로 숨긴다. */}
          {c.showSort && <IssueSortMenu sort={c.sort} onChange={c.setSort} />}
          {/* 표시할 열(WP-270) — 표가 있는 목록 뷰에서만. 보드엔 열이 없고, 모바일은 이 막대 대신 모바일 툴바를 쓴다.
            완료일 기간 필터가 걸리면 완료일 열이 자동으로 켜져 메뉴에 「필터로 켜짐」이 보인다. */}
          {c.view === 'list' && (options?.showColumnPicker ?? true) && (
            <IssueColumnPickerButton projectKey={projectKey} closedFilterActive={c.filters.closedIn != null} />
          )}

          {/* 뷰 전환 — 아이콘 토글. AppRail 과 동일하게 shadcn Tooltip 사용(키보드 포커스 툴팁 지원). */}
          <TooltipProvider>
            <div className="flex items-center gap-1" role="group" aria-label="뷰 전환">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={c.view === 'list' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => c.setView('list')}
                    aria-pressed={c.view === 'list'}
                    aria-label={listLabel}
                  >
                    <ListIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{listLabel}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={c.view === 'board' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => c.setView('board')}
                    aria-pressed={c.view === 'board'}
                    aria-label="보드"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>보드</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </>
      }
    />
  );
}
