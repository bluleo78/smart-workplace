// 모바일 빠른 필터 칩 줄(WP-1020) — 툴바 아래 두 번째 줄. 데스크톱 칩 줄(QuickFilterBar)과 같은 칩·「더 보기 ＋」를 가로 스크롤로 보인다.
// 예전 툴바의 「필터 N」 칩 → 시트 → 「＋ 필터」 → 항목 → 값 단계를 「칩 → 값 시트」 한 번으로 줄였다.
// - 걸린 칩은 앞으로 모은다 — 줄이 넘쳐도 걸린 필터는 늘 화면 안에 보인다. 오른쪽 끝 페이드로 더 있음을 알린다.
// - 칩을 누르면 바텀시트(행 48px 이상)가 열리고, 체크는 바로 목록에 반영된다. 「완료 · 결과 보기」는 시트만 닫는다.
// - 「더 보기 ＋」 시트: 칩으로 안 보이는 facet(누르면 같은 시트가 값 목록으로 바뀜) + 칩 고정·숨김 체크. 호버 없이 탭만으로 다 된다.
// 시트는 하나만 두고 내용만 바꾼다 — 시트 위에 시트를 겹치면 포커스·닫기가 엉킨다.
import { ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';

import { facetSearchable } from '@/components/filter/facetSummary';
import { FacetValueList } from '@/components/filter/FacetValueList';
import { QuickChipLabel } from '@/components/filter/QuickFilterBar';
import { appliedFirst } from '@/components/filter/quickFilterLayout';
import { useQuickFilter } from '@/components/filter/useQuickFilter';
import { MobileSheetShell } from '@/components/mobile/MobileSheetShell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

import type { IssueFilterControls } from '../../hooks/useIssueFilterControls';
import { HIDE_SCROLLBAR, HIT_EXPAND, MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from './chipStyles';

/** 칩 줄이 쓰는 컨트롤만 — 이슈 목록 훅(useIssueFilterControls)의 일부. */
export type MobileQuickFilterControls = Pick<
  IssueFilterControls,
  'facets' | 'filterValue' | 'onFilterChange' | 'quickChips' | 'quickFilterStorageKey' | 'activeFilterCount' | 'clearFacets'
>;

type SheetState = { kind: 'facet'; key: string } | { kind: 'more' } | null;

// 시트 안 큰 행 — 터치 영역 48px(WP-1020 합의). 공용 MOBILE_SHEET_ROW(44px)보다 한 단계 크다.
const SHEET_ROW = 'flex min-h-12 w-full items-center gap-3 px-4 text-left text-base active:bg-accent';

export function MobileQuickFilterRow({ controls }: { controls: MobileQuickFilterControls }) {
  const value = controls.filterValue;
  const q = useQuickFilter({
    facets: controls.facets,
    value,
    onChange: controls.onFilterChange,
    defaultChips: controls.quickChips,
    storageKey: controls.quickFilterStorageKey,
  });
  const [sheet, setSheet] = useState<SheetState>(null);
  const [query, setQuery] = useState('');
  const keys = appliedFirst(
    q.chips.map((f) => f.key),
    value,
  );
  const chips = keys.map((k) => q.chips.find((f) => f.key === k)!);
  // 시트에 띄운 facet — 칩이든 「더 보기」 소속이든 전체에서 찾는다(값이 걸리면 칩으로 옮겨 가도 시트는 그대로).
  const sheetFacet = sheet?.kind === 'facet' ? [...q.chips, ...q.more].find((f) => f.key === sheet.key) ?? null : null;
  const selected = sheetFacet ? (value[sheetFacet.key] ?? []) : [];

  function openFacet(key: string) {
    setQuery('');
    setSheet({ kind: 'facet', key });
  }

  return (
    <div className="relative" data-testid="mobile-quick-filter-row">
      <div className={cn('flex items-center gap-1.5 overflow-x-auto pb-2 pr-6', HIDE_SCROLLBAR)}>
        {chips.map((f) => {
          const sel = value[f.key] ?? [];
          const active = sel.length > 0;
          return active ? (
            // 걸린 칩 — 본문 탭 = 값 시트, × = 이 칩만 비움. 두 버튼이 각자 터치 영역을 넓힌다(HIT_EXPAND 는 자기 버튼 안에만).
            <span
              key={f.key}
              className={cn('inline-flex h-8 shrink-0 items-center rounded-full border text-sm whitespace-nowrap', MOBILE_CHIP_ACTIVE)}
              data-testid={`mobile-quick-filter-${f.key}`}
              data-active="true"
            >
              <button type="button" className={cn(HIT_EXPAND, 'inline-flex h-full items-center gap-1 pl-3 pr-1')} onClick={() => openFacet(f.key)}>
                <QuickChipLabel facet={f} selected={sel} />
              </button>
              <button
                type="button"
                aria-label={`${f.label} 필터 제거`}
                data-testid={`mobile-quick-filter-${f.key}-remove`}
                className={cn(HIT_EXPAND, 'inline-flex h-full items-center pl-1 pr-2.5')}
                onClick={() => q.clear(f.key)}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ) : (
            <button
              key={f.key}
              type="button"
              className={MOBILE_CHIP}
              onClick={() => openFacet(f.key)}
              data-testid={`mobile-quick-filter-${f.key}`}
            >
              {f.label}
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
            </button>
          );
        })}
        {(q.more.length > 0 || q.customizable) && (
          <button
            type="button"
            className={cn(MOBILE_CHIP, 'border-dashed text-muted-foreground')}
            onClick={() => setSheet({ kind: 'more' })}
            data-testid="mobile-quick-filter-more"
          >
            더 보기
            <Plus className="size-3.5" aria-hidden />
          </button>
        )}
        {controls.activeFilterCount > 0 && (
          <button
            type="button"
            className={cn(HIT_EXPAND, 'h-8 shrink-0 px-1.5 text-sm font-medium whitespace-nowrap text-primary')}
            onClick={controls.clearFacets}
            data-testid="mobile-quick-filter-clear-all"
          >
            필터 지우기
          </button>
        )}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background" aria-hidden="true" />

      <MobileSheetShell
        open={sheet != null}
        onClose={() => setSheet(null)}
        title={sheetFacet ? sheetFacet.label : '필터 더 보기'}
        description={sheetFacet ? `${sheetFacet.label} 값을 고르면 바로 목록에 반영됩니다.` : '칩으로 안 보이는 필터를 고르거나 칩을 고정·숨깁니다.'}
        testId="mobile-quick-filter-sheet"
        headerAction={
          sheetFacet && selected.length > 0 ? (
            <button
              type="button"
              onClick={() => q.clear(sheetFacet.key)}
              data-testid="mobile-quick-filter-sheet-clear"
              className="min-h-11 px-1 text-sm text-primary"
            >
              선택 해제
            </button>
          ) : undefined
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sheetFacet ? (
            <div className="px-4 pb-2">
              {facetSearchable(sheetFacet) && (
                <label className="mb-1 flex h-11 items-center gap-2 rounded-md border px-3">
                  <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`${sheetFacet.label} 검색`}
                    aria-label={`${sheetFacet.label} 검색`}
                    data-testid={`mobile-quick-filter-search-${sheetFacet.key}`}
                    className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                  />
                </label>
              )}
              <FacetValueList
                facet={sheetFacet}
                selected={selected}
                onToggle={(v) => q.toggle(sheetFacet.key, v)}
                query={query}
                variant="sheet"
              />
            </div>
          ) : (
            <div className="pb-2">
              {/* 칩 고정 목록을 위에(facet 순서 고정) — 고정할 때마다 아래 목록이 줄어도 누를 자리가 밀리지 않는다. */}
              {q.customizable && (
                <div className="mb-1 border-b pb-2" data-testid="mobile-quick-filter-pins">
                  <p className="px-4 pb-1 text-xs text-muted-foreground">칩으로 보이기</p>
                  {q.all.map((f) => (
                    <label key={f.key} className={cn(SHEET_ROW, 'cursor-pointer')} data-testid={`mobile-quick-filter-pin-${f.key}`}>
                      <span className="min-w-0 flex-1 truncate">{f.label}</span>
                      <Checkbox checked={q.isPinned(f.key)} onCheckedChange={() => q.togglePin(f.key)} aria-label={`${f.label} 칩으로 보이기`} />
                    </label>
                  ))}
                </div>
              )}
              {q.customizable && q.more.length > 0 && <p className="px-4 pb-1 pt-1 text-xs text-muted-foreground">다른 필터</p>}
              {q.more.map((f) => (
                <button key={f.key} type="button" className={SHEET_ROW} onClick={() => openFacet(f.key)} data-testid={`mobile-quick-filter-more-facet-${f.key}`}>
                  <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              ))}
              {q.more.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">모든 필터가 칩으로 보입니다</p>}
            </div>
          )}
        </div>
        {sheetFacet && (
          <div className="shrink-0 space-y-1.5 border-t px-4 pb-3 pt-3">
            <Button type="button" className="h-12 w-full text-base" onClick={() => setSheet(null)} data-testid="mobile-quick-filter-done">
              완료 · 결과 보기
            </Button>
            <p className="text-center text-xs text-muted-foreground">체크하는 즉시 목록에 반영돼요</p>
          </div>
        )}
      </MobileSheetShell>
    </div>
  );
}
