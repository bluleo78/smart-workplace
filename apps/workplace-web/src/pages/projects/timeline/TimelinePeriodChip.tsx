// 모바일 아젠다 칩 줄 맨 앞 「◷ 기간」 칩(WP-247) — 기본값이어도 강조 표시. 누르면 데스크톱 드롭다운과 같은 선택지의 시트.
// 「직접 지정」은 시트 목록 아래 날짜 두 칸(PeriodRangeForm). 대체 기간이면 목록 아래(직접 지정 위)에 이유를 적는다.
import { CalendarRange, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
import { cn } from '@/lib/utils';
import type { CycleResponse } from '@/types/cycle';

import { MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from '../components/mobile/chipStyles';
import { periodOptions, periodOptionToParam, periodOptionValue } from './periodOptions';
import { PeriodRangeForm } from './PeriodRangeForm';
import type { PeriodParam, TimelinePeriod } from './timelineTypes';

export function TimelinePeriodChip({
  param, period, cycles, onChange,
}: { param: PeriodParam; period: TimelinePeriod | null; cycles: CycleResponse[]; onChange: (p: PeriodParam) => void }) {
  const [open, setOpen] = useState(false);
  // 칩은 좁아 이름만 — 「GW-2 · 10/1–10/14」 에서 「 · 」 앞. 전체면 「전체」.
  const short = period ? period.label.split(' · ')[0] : '전체';
  return (
    <>
      <button
        type="button"
        data-testid="agenda-chip-period"
        onClick={() => setOpen(true)}
        className={cn(MOBILE_CHIP, MOBILE_CHIP_ACTIVE, 'shrink-0')}
      >
        <CalendarRange className="size-3.5" aria-hidden />
        <span className="max-w-[8rem] truncate">{short}</span>
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
      <MobilePickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title="조회 기간"
        testId="agenda-period-sheet"
        options={periodOptions(cycles, new Date()).map((o) => ({ value: o.value, label: o.label, hint: o.hint ?? undefined }))}
        value={periodOptionValue(param)}
        onSelect={(v) => onChange(periodOptionToParam(v))}
        listFooter={
          <div className="border-t px-4 pt-3 pb-2">
            {period?.fallbackNote && <p className="pb-2 text-xs text-muted-foreground">{period.fallbackNote}</p>}
            <p className="pb-1.5 text-xs text-muted-foreground">직접 지정</p>
            <PeriodRangeForm
              initial={param.kind === 'range' ? { from: param.from, to: param.to } : null}
              inputClassName="h-11 text-base"
              buttonClassName="h-11"
              onApply={(from, to) => {
                setOpen(false);
                onChange({ kind: 'range', from, to });
              }}
            />
          </div>
        }
      />
    </>
  );
}
