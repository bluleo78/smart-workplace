// 모바일 「⇅ 정렬」 칩 + 바텀시트(WP-1238) — 데스크톱 정렬 메뉴(IssueSortMenu)와 같은 값·규칙을 시트로 보인다.
// 단일 선택 시트(MobilePickerSheet)는 고르면 닫혀 방향 토글·「기본으로」를 담을 수 없어 껍데기(MobileSheetShell)에 직접 채운다.
// 기준·방향은 고르는 즉시 URL 에 반영하고 시트는 열어 둔다 — 기준을 고른 뒤 방향까지 이어서 바꿀 수 있게. 닫기는 바깥 탭·끌어내리기.
import { Check } from 'lucide-react';
import { useState } from 'react';

import { MOBILE_SHEET_ROW, MobileSheetShell } from '@/components/mobile/MobileSheetShell';
import { SELECTED_ROW_CLASS, TOGGLE_ON_CLASS } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

import { DEFAULT_SORT, type IssueSortValue, sortChipLabel, sortMenuModel } from '../../../../lib/issueSort';
import { MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from './chipStyles';

export function MobileSortChip({
  sort,
  onChange,
}: {
  sort: IssueSortValue | null;
  onChange: (next: IssueSortValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // 항목·체크·고른 뒤 값은 데스크톱 메뉴와 같은 sortMenuModel — 기본 상태의 체크는 수정일·내림차순이다.
  const { keys, directions } = sortMenuModel(sort);
  return (
    <>
      {/* 고른 정렬이 있으면 활성 칩(primary 틴트) — 그룹 칩과 같은 줄에서 「기본 순서가 아님」을 알린다. */}
      <button
        type="button"
        className={cn(MOBILE_CHIP, sort && MOBILE_CHIP_ACTIVE)}
        onClick={() => setOpen(true)}
        data-testid="mobile-chip-sort"
      >
        ⇅ {sortChipLabel(sort)}
      </button>
      <MobileSheetShell
        open={open}
        onClose={() => setOpen(false)}
        title="정렬"
        description="정렬 기준과 방향을 고르세요."
        testId="mobile-sort-sheet"
        headerAction={
          <button
            type="button"
            disabled={!sort}
            onClick={() => onChange(null)}
            data-testid="mobile-sort-reset"
            className="min-h-11 px-2 text-sm text-primary disabled:text-muted-foreground"
          >
            기본으로
          </button>
        }
      >
        <div role="listbox" aria-label="정렬 기준" className="min-h-0 flex-1 overflow-y-auto py-1">
          {keys.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.checked}
              data-testid={`mobile-sort-key-${o.value}`}
              onClick={() => onChange(o.next)}
              className={cn(MOBILE_SHEET_ROW, o.checked && SELECTED_ROW_CLASS)}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.value === DEFAULT_SORT.key && <span className="shrink-0 text-xs font-normal text-muted-foreground">기본</span>}
              {o.checked && <Check className="text-primary" aria-hidden />}
            </button>
          ))}
        </div>
        {/* 방향 — 두 칸 토글. 기본 상태에서 방향만 고르면 기본 기준(수정일)에 그 방향을 건다(내림차순은 기본 그대로). */}
        <div className="flex gap-2 border-t px-4 py-3" role="group" aria-label="정렬 방향">
          {directions.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={o.checked}
              data-testid={`mobile-sort-direction-${o.value}`}
              onClick={() => onChange(o.next)}
              className={cn('h-11 flex-1 rounded-md border text-sm', o.checked && TOGGLE_ON_CLASS)}
            >
              {o.value === 'asc' ? '↑ ' : '↓ '}
              {o.label}
            </button>
          ))}
        </div>
      </MobileSheetShell>
    </>
  );
}
