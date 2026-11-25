// 모바일 「⇅ 정렬」 칩 + 바텀시트(WP-1238) — 데스크톱 정렬 메뉴(IssueSortMenu)와 같은 값·규칙을 시트로 보인다.
// 단일 선택 시트(MobilePickerSheet)는 고르면 닫혀 방향 토글·「기본으로」를 담을 수 없어 껍데기(MobileSheetShell)에 직접 채운다.
// 기준·방향은 고르는 즉시 URL 에 반영하고 시트는 열어 둔다 — 기준을 고른 뒤 방향까지 이어서 바꿀 수 있게. 닫기는 바깥 탭·끌어내리기.
import { Check } from 'lucide-react';
import { useState } from 'react';

import { MOBILE_SHEET_ROW, MobileSheetShell } from '@/components/mobile/MobileSheetShell';
import { Switch } from '@/components/ui/switch';
import { SELECTED_ROW_CLASS, TOGGLE_ON_CLASS } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

import { type ClosedLastToggle, DEFAULT_SORT, type IssueSortValue, sortChipLabel, sortMenuModel } from '../../../../lib/issueSort';
import { MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from './chipStyles';

export function MobileSortChip({
  sort,
  onChange,
  closedLast,
}: {
  sort: IssueSortValue | null;
  onChange: (next: IssueSortValue | null) => void;
  /** 「끝난 이슈 아래로」(WP-2103) — 그룹 없는 목록에서만 넘긴다. 없으면 줄을 숨긴다. */
  closedLast?: ClosedLastToggle;
}) {
  const [open, setOpen] = useState(false);
  // 항목·체크·고른 뒤 값은 데스크톱 메뉴와 같은 sortMenuModel — 기본 상태의 체크는 수정일·내림차순이다.
  const { keys, directions } = sortMenuModel(sort);
  // 「끝난 이슈 아래로」를 끈 것도 기본 순서가 아니다(WP-2103 리뷰 후속) — 데스크톱 메뉴와 같게 칩·「기본으로」에 반영한다.
  const closedMixed = closedLast?.on === false;
  const custom = sort != null || closedMixed;
  return (
    <>
      {/* 고른 정렬이 있거나 끝난 이슈를 섞으면 활성 칩(primary 틴트) — 그룹 칩과 같은 줄에서 「기본 순서가 아님」을 알린다. */}
      <button
        type="button"
        className={cn(MOBILE_CHIP, custom && MOBILE_CHIP_ACTIVE)}
        onClick={() => setOpen(true)}
        data-testid="mobile-chip-sort"
      >
        ⇅ {sortChipLabel(sort, closedMixed)}
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
            disabled={!custom}
            onClick={() => (closedLast ? closedLast.resetOrder() : onChange(null))}
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
        {/* 끝난 이슈 아래로(WP-2103) — 스위치 한 줄. 「기본으로」는 정렬과 이 설정을 함께 되돌린다. */}
        {closedLast && (
          // 행 전체가 label 이라 글자를 눌러도 스위치가 토글된다(MobileViewSheet 의 「완료 모두 보기」와 같은 마크업).
          <label className={cn(MOBILE_SHEET_ROW, 'border-t')}>
            <span className="min-w-0 flex-1">끝난 이슈 아래로</span>
            <Switch
              checked={closedLast.on}
              onCheckedChange={closedLast.onChange}
              data-testid="mobile-sort-closed-last"
            />
          </label>
        )}
      </MobileSheetShell>
    </>
  );
}
