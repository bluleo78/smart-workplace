// 태스크 필터/검색 + 뷰(list/board) 토글 바.
// URL 의 SearchParams 가 단일 source of truth — 로직은 useIssueFilterControls 훅이 담당하고 이 컴포넌트는 렌더만 한다.

import { CircleCheckBig, LayoutGrid, List } from 'lucide-react';

import { FacetFilter } from '@/components/filter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { IssueGroupBy } from '../../../types/issue';
import { type IssueFilterBarOptions, useIssueFilterControls } from '../hooks/useIssueFilterControls';

// 개인 프로젝트 import 호환 — 옵션 타입은 훅 파일로 옮겼다.
export type { IssueFilterBarOptions };

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
      <Input
        value={c.qDraft}
        onChange={(e) => c.setQDraft(e.target.value)}
        placeholder="태스크 검색"
        className="w-64"
        aria-label="태스크 검색"
      />

      <FacetFilter facets={c.facets} value={c.filterValue} onChange={c.onFilterChange} />

      <div className="ml-auto flex items-center gap-2">
        {/* 「완료 모두 보기」 — 종료 이슈 숨김 기본 범위(withDefaultIssueScope)를 쓰는 화면만 노출.
            상태·사이클 등 명시 필터가 이미 숨김을 해제했으면 눌린 상태로 비활성화한다. */}
        {c.showClosedToggle && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="show-all-closed-toggle"
            aria-pressed={c.filters.showAllClosed || c.closedHidingOverridden}
            disabled={c.closedHidingOverridden}
            onClick={c.toggleShowAllClosed}
            className={cn(
              'transition-colors',
              (c.filters.showAllClosed || c.closedHidingOverridden) && 'bg-accent',
            )}
          >
            <CircleCheckBig aria-hidden="true" /> 완료 모두 보기
          </Button>
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
      </div>

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

      {c.hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={c.reset}>
          초기화
        </Button>
      )}
    </div>
  );
}
