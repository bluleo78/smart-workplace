// 모바일 「필터」 시트(WP-194) — 적용된 필터 칩(각 ✕)과 「＋ 필터」를 데스크톱과 같은 FacetFilter 로 시트 본문에 그린다.
// FacetFilter 내부 팝오버는 Radix Popover 라 시트(Dialog) 위에 정상 포털된다. 「전체 해제」 = facet 값만 비움.
// 시트 최소 높이 55dvh + 「＋ 필터」 를 헤더 바로 아래에 두고 팝오버를 아래로 고정 — 시트가 낮으면 팝오버가 위로 뒤집혀 시트 전체를 덮었다.
import { FacetFilter } from '@/components/filter';
import { MobileSheetShell } from '@/components/mobile/MobileSheetShell';

import type { IssueFilterControls } from '../../hooks/useIssueFilterControls';

/** 필터 시트가 실제로 쓰는 컨트롤만 — 이슈 목록(useIssueFilterControls)과 타임라인(useTimelineFilterControls)이 함께 넘길 수 있게(WP-197). */
export type MobileFilterControls = Pick<
  IssueFilterControls,
  'facets' | 'filterValue' | 'onFilterChange' | 'activeFilterCount' | 'clearFacets'
>;

export function MobileFilterSheet({
  open,
  onClose,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  controls: MobileFilterControls;
}) {
  return (
    <MobileSheetShell
      open={open}
      onClose={onClose}
      title="필터"
      description="태스크 목록에 적용할 필터를 고르세요."
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
        {controls.activeFilterCount === 0 && (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="mobile-filter-empty">
            적용된 필터 없음
          </p>
        )}
      </div>
    </MobileSheetShell>
  );
}
