// 메모리 기한 고르기(WP-380) — 데스크톱은 팝오버(빠른 선택 + 달력), 모바일은 MobileDateSheet. 오늘(KST) 이전은 고를 수 없다(서버의 과거 기한 400 과
// 같은 기준). field 는 편집·추가 폼의 기한 칸("10월 24일까지"/"기한 없음"), link 는 만료 행의 "기한 연장" 링크(기한 없음 선택 없음).
// 모바일 시트의 빠른 선택(오늘·내일·다음 주)은 시트가 정하며 "한 달 뒤"는 없다.
import { CalendarIcon } from 'lucide-react';
import { useState } from 'react';

import { MobileDateSheet } from '@/components/mobile/MobileDateSheet';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/useIsMobile';
import { expiryQuickPicks, MEMORY_LINK } from '@/lib/aiMemory';
import { formatDateKey, formatDateOnlyMonthDay, kstDateKey, parseDateKey } from '@/lib/formatters';

interface Props {
  /** 지금 기한(YYYY-MM-DD) — 없으면 null. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** 트리거 testid — 빠른 선택은 `{testId}-none|next-week|next-month`, 팝오버 `{testId}-popover`, 모바일 시트 `{testId}-sheet`. */
  testId: string;
  variant?: 'field' | 'link';
  /** 저장 중에는 트리거를 잠근다 — 만료 행의 「기한 연장」이 「계속 기억」과 함께 잠겨 PATCH 가 겹치지 않게. */
  disabled?: boolean;
}

export function AiMemoryExpiryPicker({ value, onChange, testId, variant = 'field', disabled }: Props) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const today = kstDateKey(new Date());
  const pick = (v: string | null) => {
    setOpen(false);
    onChange(v);
  };
  const label = variant === 'link' ? '기한 연장' : value ? `${formatDateOnlyMonthDay(value)}까지` : '기한 없음';

  // 모바일은 시트를 직접 연다(onClick), 데스크톱은 PopoverTrigger 가 연다(onClick 없음).
  const trigger = (onClick?: () => void) =>
    variant === 'link' ? (
      <button type="button" data-testid={testId} disabled={disabled} onClick={onClick} className={MEMORY_LINK}>
        {label}
      </button>
    ) : (
      <Button type="button" variant="outline" size="sm" data-testid={testId} disabled={disabled} onClick={onClick} className="gap-1.5 font-normal pointer-coarse:min-h-11">
        <CalendarIcon className="size-3.5 text-muted-foreground" />
        {label}
      </Button>
    );

  if (isMobile) {
    return (
      <>
        {trigger(() => setOpen(true))}
        <MobileDateSheet
          open={open}
          onClose={() => setOpen(false)}
          title="기한"
          // 기한 연장은 지난 기한을 현재 값으로 넘기지 않는다 — 달력이 지난 달에서 열리고 지우기가 보이는 것을 막는다.
          value={variant === 'field' ? value : null}
          onSelect={onChange}
          testId={`${testId}-sheet`}
          disabledBefore={parseDateKey(today)}
          clearLabel="기한 없음"
          canClear={variant === 'field'}
        />
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger()}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" data-testid={`${testId}-popover`}>
        <div className="flex gap-1 pb-2">
          {expiryQuickPicks(today, variant === 'field').map((q) => (
            <Button
              key={q.key}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              data-testid={`${testId}-${q.key}`}
              onClick={() => pick(q.value)}
            >
              {q.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={value ? parseDateKey(value) : undefined}
          defaultMonth={parseDateKey(value && value >= today ? value : today)}
          disabled={{ before: parseDateKey(today) }}
          onSelect={(d) => d && pick(formatDateKey(d))}
        />
      </PopoverContent>
    </Popover>
  );
}
