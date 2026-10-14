// 모바일 날짜 바텀시트(WP-196) — 데스크톱 DatePickerPopover(팝오버+달력)의 모바일 짝.
// 빠른 선택(오늘·내일·다음 주) + 달력 + 지우기. 고르면 시트를 닫고 onSelect('yyyy-MM-dd' | null).
// WP-380: 선택 prop 으로 이전 날짜 비활성·지우기 문구·지우기 숨김. 주의 — 빠른 선택은 브라우저 날짜(new Date()) 기준이고 disabledBefore 는
// 호출부가 넘기는 날짜(메모리 기한은 KST 오늘)라, 시간대가 KST 와 다른 브라우저에선 빠른 선택이 비활성 구간에 걸릴 수 있다(드묾).
import { addDays } from 'date-fns';

import { Calendar } from '@/components/ui/calendar';
import { formatDateKey, parseDateKey } from '@/lib/formatters';
import { cn } from '@/lib/utils';

import { MobileSheetShell } from './MobileSheetShell';

const QUICK = [
  { key: 'today', label: '오늘', days: 0 },
  { key: 'tomorrow', label: '내일', days: 1 },
  { key: 'next-week', label: '다음 주', days: 7 },
] as const;

export function MobileDateSheet({
  open, onClose, title, value, onSelect, testId = 'mobile-date-sheet', disabledBefore, clearLabel = '지우기', canClear = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 현재 값 'yyyy-MM-dd' — 없으면 null. */
  value: string | null;
  onSelect: (value: string | null) => void;
  testId?: string;
  /** 이 날짜 이전은 고를 수 없다(WP-380 메모리 기한 — 오늘 이전 비활성). */
  disabledBefore?: Date;
  /** 지우기 버튼 문구(WP-380 "기한 없음"). */
  clearLabel?: string;
  /** false 면 지우기 버튼을 두지 않는다(만료 행 "기한 연장"). */
  canClear?: boolean;
}) {
  const selected = value ? parseDateKey(value) : undefined;
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
            <button key={q.key} type="button" className={chip} data-testid={`${testId}-${q.key}`} onClick={() => pick(formatDateKey(addDays(new Date(), q.days)))}>
              {q.label}
            </button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => d && pick(formatDateKey(d))}
          disabled={disabledBefore ? { before: disabledBefore } : undefined}
          // 날짜 칸 32px → 44px(터치 최소 영역). 44×7 + 좌우 p-3 = 332px 라 390px 시트(px-4 안 358px)에 들어간다.
          className="mx-auto mt-2 [--cell-size:--spacing(11)]"
        />
        {canClear && value && (
          <button type="button" data-testid={`${testId}-clear`} onClick={() => pick(null)} className={cn(chip, 'mt-2 w-full text-destructive')}>
            {clearLabel}
          </button>
        )}
      </div>
    </MobileSheetShell>
  );
}
