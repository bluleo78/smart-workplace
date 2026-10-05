// 타임라인 필터바 맨 앞 「◷ 기간」 드롭다운(WP-247) — 기간도 「어떤 이슈를 볼지」 정하는 필터라 담당자·상태 옆에 둔다.
// 기본값이어도 강조 표시로 라벨을 늘 보여 지금 걸러져 있음을 알린다. 대체 기간이면 title 툴팁으로 이유를 알린다.
import { CalendarRange, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { CycleResponse } from '@/types/cycle';

import { periodOptions, periodOptionToParam, periodOptionValue } from './periodOptions';
import { PeriodRangeForm } from './PeriodRangeForm';
import type { PeriodParam, TimelinePeriod } from './timelineTypes';

const GROUP_LABEL = { cycle: '사이클', preset: '기간', all: null } as const;

export function TimelinePeriodPicker({
  param, period, cycles, onChange,
}: { param: PeriodParam; period: TimelinePeriod | null; cycles: CycleResponse[]; onChange: (p: PeriodParam) => void }) {
  const [open, setOpen] = useState(false);
  const options = periodOptions(cycles, new Date());
  const current = periodOptionValue(param);
  const pick = (p: PeriodParam) => {
    setOpen(false);
    onChange(p);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid="timeline-period-trigger"
          title={period?.fallbackNote ?? undefined}
          className="border-primary/40 bg-primary/10 font-medium text-primary hover:bg-primary/15"
        >
          <CalendarRange className="size-3.5" aria-hidden />
          {period ? period.label : '전체'}
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1" data-testid="timeline-period-popover">
        <div role="menu" aria-label="조회 기간">
          {(['cycle', 'preset', 'all'] as const).map((g) => (
            <div key={g} className={cn(g !== 'cycle' && 'mt-1 border-t pt-1')}>
              {GROUP_LABEL[g] && <p className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">{GROUP_LABEL[g]}</p>}
              {options.filter((o) => o.group === g).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current === o.value}
                  data-testid={`timeline-period-option-${o.value}`}
                  onClick={() => pick(periodOptionToParam(o.value))}
                  className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted', current === o.value && 'bg-accent font-medium')}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-xs font-normal text-muted-foreground">{o.hint}</span>}
                  <Check className={cn('size-3.5 shrink-0', current !== o.value && 'invisible')} aria-hidden />
                </button>
              ))}
              {g === 'preset' && (
                <div className="px-2 pt-1 pb-1.5">
                  <p className="pb-1 text-[11px] text-muted-foreground">직접 지정</p>
                  <PeriodRangeForm
                    initial={param.kind === 'range' ? { from: param.from, to: param.to } : null}
                    onApply={(from, to) => pick({ kind: 'range', from, to })}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
