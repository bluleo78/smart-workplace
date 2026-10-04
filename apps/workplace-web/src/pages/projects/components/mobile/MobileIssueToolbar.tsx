// 모바일 이슈 목록 한 줄 툴바(WP-194) — 데스크톱 ViewChipBar+IssueFilterBar(4줄로 꺾여 화면 40%)를 대체.
// 왼쪽: 가로 스크롤 칩 [뷰 ▾][◆ 에픽][필터 N][그룹: X] (오른쪽 페이드), 오른쪽 고정: 🔍 · 목록/보드 토글.
// 🔍 를 누르면 줄 전체가 검색창+「취소」로 바뀐다 — 취소는 줄만 닫고 검색어(URL q)는 유지, 🔍 에 점으로 표시.
// 개인 프로젝트(WP-221)는 options(데스크톱 IssueFilterBar 와 같은 IssueFilterBarOptions)·showViewChip=false 로 재사용한다.
import { ChevronDown, LayoutGrid, List, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
import { Input } from '@/components/ui/input';
import { cn, euroRo } from '@/lib/utils';

import { ISSUE_GROUP_BY_LABEL } from '../../../../lib/issueGrouping';
import type { IssueGroupBy } from '../../../../types/issue';
import { type IssueFilterBarOptions, type IssueFilterControls, useIssueFilterControls } from '../../hooks/useIssueFilterControls';
import { type SavedViewState, useSavedViewState } from '../../hooks/useSavedViewState';
import { HIDE_SCROLLBAR, MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from './chipStyles';
import { MobileFilterSheet } from './MobileFilterSheet';
import { MobileViewSheet } from './MobileViewSheet';

type ToolbarProps = {
  projectKey: string;
  epicSlot?: ReactNode;
  /** 필터·그룹 옵션과 목록 토글 라벨·아이콘 — 데스크톱 IssueFilterBar 와 같은 객체(개인 = PERSONAL_FILTER_OPTIONS). 기본 = 팀 동작. */
  options?: IssueFilterBarOptions;
  /** 저장 뷰 칩 노출 — 저장 뷰가 없는 개인 프로젝트는 false(WP-221). */
  showViewChip?: boolean;
};

export function MobileIssueToolbar({ showViewChip = true, ...props }: ToolbarProps) {
  return showViewChip ? <TeamToolbar {...props} /> : <ToolbarBody {...props} />;
}

// 저장 뷰 상태(useSavedViewState)는 툴바 전체(검색 모드 포함)보다 오래 살아야 한다 — 검색 모드로 바뀌며 칩 줄이 언마운트돼도
// 선택한 뷰(selectedViewId)·업데이트 대상이 초기화되지 않게(#777) 여기서 호출한다. 개인(showViewChip=false)은 이 래퍼를 거치지 않아 조회도 없다(WP-221).
function TeamToolbar(props: Omit<ToolbarProps, 'showViewChip'>) {
  const sv = useSavedViewState(props.projectKey);
  return <ToolbarBody {...props} sv={sv} />;
}

function ToolbarBody({
  projectKey,
  epicSlot,
  options,
  sv,
}: Omit<ToolbarProps, 'showViewChip'> & { sv?: SavedViewState }) {
  const c = useIssueFilterControls(projectKey, options);
  const [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState<'filter' | 'group' | null>(null);
  // 목록 쪽 토글 — 팀 = 「목록」(List), 개인 = 「체크리스트」(ListChecks). 데스크톱 listLabel 기본 '리스트' 와 달리 options.listLabel 이 없으면 모바일 문구는 기존 「목록」.
  const listLabel = options?.listLabel ?? '목록';
  const ListIcon = options?.listIcon ?? List;
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
        <div className={cn('flex items-center gap-1.5 overflow-x-auto py-2 pr-6', HIDE_SCROLLBAR)}>
          {/* 저장 뷰 칩 — sv 를 받은 팀 툴바만. */}
          {sv && <MobileViewChip projectKey={projectKey} controls={c} sv={sv} />}
          {epicSlot}
          <button
            type="button"
            className={cn(MOBILE_CHIP, c.activeFilterCount > 0 && MOBILE_CHIP_ACTIVE)}
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
        aria-label={c.view === 'list' ? '보드로 전환' : `${listLabel}${euroRo(listLabel)} 전환`}
        data-testid="mobile-view-toggle"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground"
      >
        {/* 현재 뷰 아이콘 1개 — 누르면 다른 뷰로 */}
        {c.view === 'list' ? <ListIcon className="size-5" /> : <LayoutGrid className="size-5" />}
      </button>

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

// 뷰 칩 + 뷰 시트 — 저장 뷰 상태 sv 는 TeamToolbar 가 들고 있다(검색 모드에서 이 칩이 언마운트돼도 선택 유지).
// 시트는 Radix 포털이라 칩 줄(가로 스크롤 영역) 안에 둬도 화면에 그대로 뜬다.
function MobileViewChip({ projectKey, controls, sv }: { projectKey: string; controls: IssueFilterControls; sv: SavedViewState }) {
  const [open, setOpen] = useState(false);
  // 뷰 칩 라벨 — 필터 없음=「전체」, 저장 뷰 선택 중=그 이름, 그 외(직접 조건)=「사용자 조건」.
  // 에픽 범위만 걸린 상태도 「전체」(sv.isAllActiveIgnoringEpic — 뷰 시트 「전체」 ✓ 와 같은 판정).
  const viewName = sv.isAllActiveIgnoringEpic ? '전체' : (sv.activeView?.name ?? '사용자 조건');
  return (
    <>
      <button type="button" className={cn(MOBILE_CHIP, 'font-medium')} onClick={() => setOpen(true)} data-testid="mobile-chip-view">
        <span className="max-w-[8rem] truncate">{viewName}</span>
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
      <MobileViewSheet open={open} onClose={() => setOpen(false)} projectKey={projectKey} controls={controls} saved={sv} />
    </>
  );
}
