// 모바일 「필터」 시트(WP-194) — 적용된 필터 칩(각 ✕)과 「＋ 필터」를 데스크톱과 같은 FacetFilter 로 시트 본문에 그린다.
// FacetFilter 내부 팝오버는 Radix Popover 라 시트(Dialog) 위에 정상 포털된다. 「전체 해제」 = facet 값만 비움.
// 시트 최소 높이 55dvh + 「＋ 필터」 를 헤더 바로 아래에 두고 팝오버를 아래로 고정 — 시트가 낮으면 팝오버가 위로 뒤집혀 시트 전체를 덮었다.
import { FacetFilter } from '@/components/filter';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

import type { IssueFilterControls } from '../../hooks/useIssueFilterControls';

export function MobileFilterSheet({
  open,
  onClose,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  controls: IssueFilterControls;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="mobile-filter-sheet"
        className="flex min-h-[55dvh] max-h-[85dvh] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
        onCloseAutoFocus={(e) => e.preventDefault()}
        // 열릴 때 첫 버튼에 포커스 링이 튀지 않게 자동 포커스를 막는다(MobilePickerSheet 와 동일).
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <SheetTitle className="text-base">필터</SheetTitle>
          <button
            type="button"
            onClick={controls.clearFacets}
            disabled={controls.activeFilterCount === 0}
            data-testid="mobile-filter-clear"
            className="min-h-11 px-1 text-sm text-primary disabled:text-muted-foreground"
          >
            전체 해제
          </button>
        </div>
        <SheetDescription className="sr-only">태스크 목록에 적용할 필터를 고르세요.</SheetDescription>
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
      </SheetContent>
    </Sheet>
  );
}
