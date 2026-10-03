// 모바일 이슈 목록 한 줄 툴바(WP-194) — 데스크톱 ViewChipBar+IssueFilterBar(4줄로 꺾여 화면 40%)를 대체.
// 왼쪽: 가로 스크롤 칩 [뷰 ▾][◆ 에픽][필터 N][그룹: X] (오른쪽 페이드), 오른쪽 고정: 🔍 · 목록/보드 토글.
// 🔍 를 누르면 줄 전체가 검색창+「취소」로 바뀐다 — 취소는 줄만 닫고 검색어(URL q)는 유지, 🔍 에 점으로 표시.
import { ChevronDown, LayoutGrid, List, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { ISSUE_GROUP_BY_LABEL } from '../../../../lib/issueGrouping';
import { normalizeIssueQueryIgnoringViewAndGroup } from '../../../../lib/savedViewQuery';
import type { IssueGroupBy } from '../../../../types/issue';
import { useIssueFilterControls } from '../../hooks/useIssueFilterControls';
import { useSavedViewState } from '../../hooks/useSavedViewState';
import { MobileFilterSheet } from './MobileFilterSheet';
import { MobileViewSheet } from './MobileViewSheet';

// 칩 공통 스타일 — 터치 영역 44px(min-h-11 은 줄 높이를 키우므로 시각 32px + 상하 여백으로 확보).
export const MOBILE_CHIP =
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[13px] whitespace-nowrap';

/** 쿼리에서 view·group 과 에픽 범위(parent/topLevel)를 빼면 남는 조건이 없는지 — 모바일 뷰 칩 라벨 판정용. */
function isOnlyEpicScope(query: string): boolean {
  const p = new URLSearchParams(query);
  p.delete('parent');
  p.delete('topLevel');
  return normalizeIssueQueryIgnoringViewAndGroup(p.toString()) === '';
}

export function MobileIssueToolbar({ projectKey, epicSlot }: { projectKey: string; epicSlot?: ReactNode }) {
  const c = useIssueFilterControls(projectKey);
  const sv = useSavedViewState(projectKey);
  const [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState<'view' | 'filter' | 'group' | null>(null);

  // 뷰 칩 라벨 — 필터 없음=「전체」, 저장 뷰 선택 중=그 이름, 그 외(직접 조건)=「사용자 조건」.
  // 모바일에선 에픽 범위(parent/topLevel)를 옆의 「◆ 에픽」 칩이 따로 보여주므로, 에픽 범위만 걸린 상태도 「전체」로 본다.
  // (라벨 전용 — 데스크톱 ViewChipBar·저장 뷰 매칭은 sv.isAllActive 그대로.)
  const onlyEpicScope = !sv.activeView && isOnlyEpicScope(sv.currentQuery);
  const viewName = sv.isAllActive || onlyEpicScope ? '전체' : (sv.activeView?.name ?? '사용자 조건');
  const groupLabel = c.groupBy ? ISSUE_GROUP_BY_LABEL[c.groupBy] : '없음';

  // 검색 모드 — 칩 줄을 통째로 검색창으로 교체한다(좁은 폭에서 칩과 입력칸을 같이 두지 않는다).
  if (searching) {
    return (
      <div className="flex h-12 items-center gap-2" data-testid="mobile-issue-toolbar">
        <Input
          autoFocus
          value={c.qDraft}
          onChange={(e) => c.setQDraft(e.target.value)}
          placeholder="태스크 검색"
          aria-label="태스크 검색"
          data-testid="mobile-search-input"
          className="h-9 flex-1"
        />
        <button
          type="button"
          onClick={() => setSearching(false)}
          data-testid="mobile-search-cancel"
          className="min-h-11 shrink-0 px-2 text-sm text-primary"
        >
          취소
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-12 items-center gap-1" data-testid="mobile-issue-toolbar">
      {/* 칩 줄 — 넘치면 가로 스크롤, 오른쪽 끝 페이드로 더 있음을 알린다. */}
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1.5 overflow-x-auto py-2 pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            className={cn(MOBILE_CHIP, 'font-medium')}
            onClick={() => setSheet('view')}
            data-testid="mobile-chip-view"
          >
            <span className="max-w-[8rem] truncate">{viewName}</span>
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </button>
          {epicSlot}
          <button
            type="button"
            className={cn(MOBILE_CHIP, c.activeFilterCount > 0 && 'border-foreground bg-accent font-medium')}
            onClick={() => setSheet('filter')}
            data-testid="mobile-chip-filter"
          >
            필터{c.activeFilterCount > 0 && ` ${c.activeFilterCount}`}
          </button>
          <button type="button" className={MOBILE_CHIP} onClick={() => setSheet('group')} data-testid="mobile-chip-group">
            그룹: {groupLabel}
          </button>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background" aria-hidden="true" />
      </div>
      <button
        type="button"
        onClick={() => setSearching(true)}
        aria-label="검색"
        data-testid="mobile-search-open"
        className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground"
      >
        <Search className="size-5" />
        {/* 검색 줄을 닫아도 검색어가 적용 중임을 점으로 알린다. */}
        {c.filters.q !== '' && (
          <span
            className="absolute right-2.5 top-2.5 size-2 rounded-full bg-primary"
            data-testid="mobile-search-dot"
            aria-label="검색어 적용 중"
          />
        )}
      </button>
      <button
        type="button"
        onClick={() => c.setView(c.view === 'list' ? 'board' : 'list')}
        aria-label={c.view === 'list' ? '보드로 전환' : '목록으로 전환'}
        data-testid="mobile-view-toggle"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground"
      >
        {/* 현재 뷰 아이콘 1개 — 누르면 다른 뷰로 */}
        {c.view === 'list' ? <List className="size-5" /> : <LayoutGrid className="size-5" />}
      </button>

      <MobileViewSheet open={sheet === 'view'} onClose={() => setSheet(null)} projectKey={projectKey} controls={c} saved={sv} />
      <MobileFilterSheet open={sheet === 'filter'} onClose={() => setSheet(null)} controls={c} />
      <MobilePickerSheet
        open={sheet === 'group'}
        onClose={() => setSheet(null)}
        title="그룹 기준"
        testId="mobile-group-sheet"
        options={c.visibleGroupOptions.map((o) => ({ value: o.value ?? 'none', label: o.label }))}
        value={c.groupBy ?? 'none'}
        onSelect={(v) => c.setGroupBy(v === 'none' ? null : (v as IssueGroupBy))}
      />
    </div>
  );
}
