// 모바일 「필터」 시트(WP-194) — 적용된 필터 칩(각 ✕)과 「＋ 필터」를 데스크톱과 같은 FacetFilter 로 시트 본문에 그린다.
// 지금은 타임라인 아젠다(TimelineAgendaList)만 쓴다 — 이슈 목록은 빠른 필터 칩 줄(MobileQuickFilterRow, WP-1020)로 바뀌었다.
// FacetFilter 내부 팝오버는 Radix Popover 라 시트(Dialog) 위에 정상 포털된다. 「전체 해제」 = facet 값만 비움.
// 시트 최소 높이 55dvh + 「＋ 필터」 를 헤더 바로 아래에 두고 팝오버를 아래로 고정 — 시트가 낮으면 팝오버가 위로 뒤집혀 시트 전체를 덮었다.
// 펼침 영역(완료일 「기간 직접 지정」 달력)이 있는 facet 이 있으면 「＋ 필터」 아래에 25rem 을 비워 둔다 — 팝오버는 「＋ 필터」 아래 남은
// 높이만 쓰는데 그게 6주짜리 달력보다 낮아 390×664·390×844 에서도 달력 안을 스크롤해야 했다(WP-932). 시트 전체 최소 높이가 아니라
// 「＋ 필터」 아래 높이를 잡아야 칩이 쌓여 「＋ 필터」 가 내려가도 공간이 남는다(시트 상한 85dvh 까지). 달력이 커지면 E2E 가 깨진다.
import { FacetFilter } from '@/components/filter';
import { MobileSheetShell } from '@/components/mobile/MobileSheetShell';
import { cn } from '@/lib/utils';

import type { IssueFilterControls } from '../../hooks/useIssueFilterControls';

/**
 * 필터 시트가 실제로 쓰는 컨트롤만 — 타임라인(useTimelineFilterControls)이 넘긴다(WP-197).
 * facet 세 필드는 이슈 목록 훅의 모양을 그대로 따르고(한 곳에서 맞춘다), 「전체 해제」용 두 필드만 여기서 정한다(WP-2115).
 */
export type MobileFilterControls = Pick<IssueFilterControls, 'facets' | 'filterValue' | 'onFilterChange'> & {
  activeFilterCount: number; // 값이 있는 facet 수 — 「전체 해제」 활성 판정
  clearFacets: () => void; // facet 값만 비움
};

export function MobileFilterSheet({
  open,
  onClose,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  controls: MobileFilterControls;
}) {
  const hasExpandableFacet = controls.facets.some((f) => f.renderExtra);
  return (
    <MobileSheetShell
      open={open}
      onClose={onClose}
      title="필터"
      description="이슈 목록에 적용할 필터를 고르세요."
      testId="mobile-filter-sheet"
      className="min-h-[55dvh]"
      headerAction={
        <button
          type="button"
          onClick={controls.clearFacets}
          disabled={controls.activeFilterCount === 0}
          data-testid="mobile-filter-clear"
          className="min-h-11 px-1 text-sm text-primary disabled:text-muted-foreground"
        >
          전체 해제
        </button>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-1">
        <FacetFilter
          facets={controls.facets}
          value={controls.filterValue}
          onChange={controls.onFilterChange}
          popoverSide="bottom"
        />
        {/* 「＋ 필터」 아래 공간 — 펼침 영역 달력이 안쪽 스크롤 없이 들어갈 높이. */}
        <div className={cn(hasExpandableFacet && 'min-h-[25rem]')}>
          {controls.activeFilterCount === 0 && (
            <p className="mt-3 text-sm text-muted-foreground" data-testid="mobile-filter-empty">
              적용된 필터 없음
            </p>
          )}
        </div>
      </div>
    </MobileSheetShell>
  );
}
