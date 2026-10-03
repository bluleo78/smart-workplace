// 모바일 날짜 바텀시트(WP-196) — 데스크톱 DatePickerPopover(팝오버+달력)의 모바일 짝.
// 빠른 선택(오늘·내일·다음 주) + 달력 + 지우기. 고르면 시트를 닫고 onSelect('yyyy-MM-dd' | null).
import { addDays, format, parse } from 'date-fns';

import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

import { MobileSheetShell } from './MobileSheetShell';

const QUICK = [
  { key: 'today', label: '오늘', days: 0 },
  { key: 'tomorrow', label: '내일', days: 1 },
  { key: 'next-week', label: '다음 주', days: 7 },
] as const;

const toKey = (d: Date) => format(d, 'yyyy-MM-dd');

export function MobileDateSheet({
  open, onClose, title, value, onSelect, testId = 'mobile-date-sheet',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 현재 값 'yyyy-MM-dd' — 없으면 null. */
  value: string | null;
  onSelect: (value: string | null) => void;
  testId?: string;
}) {
  const selected = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined;
  // 선택 공통 경로 — 시트를 먼저 닫고 값을 알린다(MobilePickerSheet 와 같은 순서: 호출부가 포커스 복귀를 이어서 처리).
  const pick = (v: string | null) => {
    onClose();
    onSelect(v);
  };
  const chip = 'inline-flex h-11 flex-1 items-center justify-center rounded-md border text-sm active:bg-accent';

  return (
    <MobileSheetShell open={open} onClose={onClose} title={title} description={`${title}을 고르세요.`} testId={testId}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex gap-2">
          {QUICK.map((q) => (
            <button key={q.key} type="button" className={chip} data-testid={`${testId}-${q.key}`} onClick={() => pick(toKey(addDays(new Date(), q.days)))}>
              {q.label}
            </button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => d && pick(toKey(d))}
          className="mx-auto mt-2"
        />
        {value && (
          <button type="button" data-testid={`${testId}-clear`} onClick={() => pick(null)} className={cn(chip, 'mt-2 w-full text-destructive')}>
            지우기
          </button>
        )}
      </div>
    </MobileSheetShell>
  );
}
