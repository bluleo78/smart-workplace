// src/components/filter/DateRangePickerPanel.tsx
// 「기간 직접 지정」 인라인 달력 패널 — 시작~끝 날짜를 고르고 「적용」 으로 확정한다.
// Radix 중첩 Popover 를 피하려고(AddFilterButton 주석 참고) 팝오버 안에 달력을 그대로 펼친다.
// 날짜는 로컬 날짜 키(YYYY-MM-DD)로만 주고받는다 — 시각·시간대 변환 없음.
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { formatClosedSpan } from '@/lib/closedRange';
import { formatDateKey, parseDateKey } from '@/lib/formatters';

export function DateRangePickerPanel({
  initial,
  onApply,
  onCancel,
}: {
  /** 이미 정해진 범위(양끝 포함, YYYY-MM-DD) — 달력이 그 달에서 열리고 선택돼 보인다. */
  initial?: { from: string; to: string } | null;
  onApply: (from: string, to: string) => void;
  onCancel: () => void;
}) {
  const [range, setRange] = useState<DateRange | undefined>(
    initial ? { from: parseDateKey(initial.from), to: parseDateKey(initial.to) } : undefined,
  );
  // 끝 날짜를 안 골랐으면(하루만 클릭) 그 하루짜리 범위로 본다.
  const from = range?.from ? formatDateKey(range.from) : null;
  const to = range?.from ? formatDateKey(range.to ?? range.from) : null;

  return (
    <div className="space-y-2" data-testid="date-range-panel">
      {/* 폭 w-64 팝오버 안에 들어가도록 셀을 한 칸 줄이고 패딩을 뺀다. */}
      <Calendar
        mode="range"
        selected={range}
        defaultMonth={range?.from ?? new Date()}
        onSelect={setRange}
        className="p-0 [--cell-size:--spacing(7)]"
      />
      {/* 요약·취소·적용 줄은 스크롤 상자 아래끝에 붙인다(sticky) — 모바일 필터 시트처럼 팝오버가 남은 높이만큼만 쓰고 안을 스크롤하면
          달력이 그 높이보다 커서 「적용」 까지 스크롤해야 했다(WP-873, 390×664). 달력은 위에서부터 보이고 이 줄은 늘 보인다.
          스크롤 상자가 없는(데스크톱) 팝오버에선 다 보이므로 붙을 일이 없다. 붙은 동안 아래로 지나가는 날짜를 가리도록 배경을 칠한다. */}
      <div className="sticky bottom-0 space-y-2 bg-popover pt-1">
        <p className="text-center text-xs text-muted-foreground" data-testid="date-range-summary">
          {/* 칩과 같은 구간 표기(연도·하루 접기 포함) — 패널에서 본 것과 칩이 같아야 한다. */}
          {from && to ? formatClosedSpan(from, to) : '시작일과 종료일을 고르세요'}
        </p>
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} data-testid="date-range-cancel">
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!from || !to}
            onClick={() => from && to && onApply(from, to)}
            data-testid="date-range-apply"
          >
            적용
          </Button>
        </div>
      </div>
    </div>
  );
}
