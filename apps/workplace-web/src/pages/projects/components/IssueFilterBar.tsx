// 태스크 필터/검색 + 뷰(list/board) 토글 바.
// URL 의 SearchParams 가 단일 source of truth — 로직은 useIssueFilterControls 훅이 담당하고 이 컴포넌트는 렌더만 한다.

import { LayoutGrid, List } from 'lucide-react';

import { QuickFilterBar } from '@/components/filter';
import { ShowAllClosedToggle } from '@/components/issue/ShowAllClosedToggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SEARCH_QUERY_MAX_LENGTH } from '@/lib/searchLimits';

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
    <div className="flex flex-wrap items-center gap-2 py-2">
      {/* 왼쪽 묶음 — 검색·빠른 필터 칩(WP-1020)·「필터 지우기」. 「필터 지우기」는 「더 보기」와 한 덩어리라 줄이 넘쳐도 혼자 떨어지지 않는다(WP-931).
          내용 폭만큼 자리를 잡아(grow·기본 basis auto), 한 줄에 다 안 들어가면 오른쪽 묶음이 아랫줄로 내려간다. */}
      <div className="flex min-w-0 grow flex-wrap items-center gap-2" data-testid="issue-filter-main">
        <Input
          value={c.qDraft}
          onChange={(e) => c.setQDraft(e.target.value)}
          // 검색어 길이 상한 — 서버 요청 줄 한도를 넘겨 목록이 실패하지 않게(WP-732)
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          placeholder="태스크 검색"
          className="w-auto max-w-64 grow basis-40"
          aria-label="태스크 검색"
        />

        {/* 빠른 필터 칩 — 자주 쓰는 facet 은 칩으로 바로, 나머지는 「더 보기」(WP-1020). 칩 고정·숨김은 화면·사용자별로 기억한다. */}
        <QuickFilterBar
          facets={c.facets}
          value={c.filterValue}
          onChange={c.onFilterChange}
          defaultChips={c.quickChips}
          storageKey={c.quickFilterStorageKey}
          trailing={
            // 「필터 지우기」 — 예전 「초기화」와 같은 범위(검색어 포함 필터 전부, view·group·열 구성은 유지).
            c.hasActiveFilters && (
              <button
                type="button"
                onClick={c.reset}
                data-testid="quick-filter-clear-all"
                className="h-8 px-1.5 text-sm font-medium whitespace-nowrap text-primary hover:underline"
              >
                필터 지우기
              </button>
            )
          }
        />
      </div>

      {/* 오른쪽 묶음 — 보기 설정(완료 모두 보기·그룹·열·뷰 전환). */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
      </div>
    </div>
  );
}
