// 모바일 다중 선택 바텀시트(WP-196) — 담당자처럼 여러 개를 고르는 값. 행을 탭해 토글하고, 시트가 닫힐 때(완료·바깥 탭·아래로 끌기)
// 한 번만 onClose(최종 선택)으로 알린다 — 데스크톱 AssigneePickerPopover 의 "닫을 때 집합 교체" 의미와 같다.
import { Check } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import type { PickerOption } from './MobilePickerSheet';
import { MOBILE_SHEET_ROW, MobileSheetShell } from './MobileSheetShell';

export function MobileMultiPickerSheet({
  open, onClose, title, options, value, searchable = false, testId = 'mobile-multi-picker-sheet',
}: {
  open: boolean;
  onClose: (selected: string[]) => void;
  title: string;
  options: PickerOption[];
  value: string[];
  searchable?: boolean;
  testId?: string;
}) {
  const [picked, setPicked] = useState<string[]>(value);
  const [q, setQ] = useState('');
  // 열릴 때마다 현재 값으로 다시 시작 — 지난번 열었다가 닫은 선택이 남지 않게. effect 대신 렌더 중 상태 조정
  // (React 권장 패턴, eslint-disable 불필요). 열린 동안 value 가 바뀌어도 사용자의 편집 중 선택은 덮지 않는다.
  // key 리마운트는 닫힘 애니메이션 중 체크가 초기화돼 깜빡이므로 쓰지 않는다.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPicked(value);
      setQ('');
    }
  }
  const keyword = q.trim().toLowerCase();
  const shown = keyword ? options.filter((o) => o.label.toLowerCase().includes(keyword)) : options;
  const toggle = (v: string) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const close = () => onClose(picked);

  return (
    <MobileSheetShell
      open={open}
      onClose={close}
      title={title}
      description={`${title}을 여러 명 고를 수 있습니다.`}
      testId={testId}
      autoFocus={searchable}
      headerAction={
        <button type="button" data-testid={`${testId}-done`} onClick={close} className="h-11 px-2 text-sm font-medium text-primary">
          완료
        </button>
      }
    >
      {searchable && (
        <div className="px-4 pb-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색"
            data-testid={`${testId}-search`}
            className="h-10 w-full rounded-md border bg-background px-3 text-base"
          />
        </div>
      )}
      <div role="listbox" aria-multiselectable aria-label={title} className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.map((o) => {
          const on = picked.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={on}
              data-testid={`multi-option-${o.value}`}
              onClick={() => toggle(o.value)}
              className={cn(MOBILE_SHEET_ROW, on && 'font-medium')}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              <span className={cn('flex size-5 items-center justify-center rounded border', on && 'border-primary bg-primary text-primary-foreground')}>
                {on && <Check className="size-3.5" aria-hidden />}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">결과가 없습니다</p>}
      </div>
    </MobileSheetShell>
  );
}
