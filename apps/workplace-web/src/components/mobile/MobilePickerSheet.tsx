// 모바일 단일 선택 바텀시트 — 상태·우선순위·에픽·담당자 등 "목록에서 하나 고르기"의 공용 부품(WP-193~196).
// 선택하면 onSelect 후 닫힌다. searchable 이면 상단 검색창(키보드는 시트 안에서만 — 시트·키보드 동시 표시 원칙상 바깥 입력칸은 이미 blur).
// 그래버·제목 줄·safe-area 등 시트 껍데기는 MobileSheetShell 이 맡는다.
import { Check } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { cn } from '@/lib/utils';

import { MOBILE_SHEET_ROW, MobileSheetShell } from './MobileSheetShell';

export interface PickerOption {
  value: string;
  label: string;
  icon?: ReactNode;
  /** 오른쪽 보조 정보(개수·진행률 등). */
  hint?: ReactNode;
}

export function MobilePickerSheet({
  open, onClose, title, options, value, onSelect, searchable = false, testId = 'mobile-picker-sheet', headerAction, listFooter,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: PickerOption[];
  /** 현재 값 — ✓ 표시. 없으면 null. */
  value: string | null;
  onSelect: (value: string) => void;
  searchable?: boolean;
  testId?: string;
  /** 제목 줄 오른쪽 액션(예: 「에픽 만들기」). 없으면 제목만 렌더한다. */
  headerAction?: ReactNode;
  /** 옵션 목록 아래에 붙는 선택 불가 줄(예: 「불러오는 중…」). 없으면 아무것도 렌더하지 않는다. */
  listFooter?: ReactNode;
}) {
  const [q, setQ] = useState('');
  const keyword = q.trim().toLowerCase();
  const shown = keyword ? options.filter((o) => o.label.toLowerCase().includes(keyword)) : options;
  const close = () => {
    setQ('');
    onClose();
  };

  return (
    <MobileSheetShell
      open={open}
      onClose={close}
      title={title}
      description={`${title} 중 하나를 고르세요.`}
      testId={testId}
      headerAction={headerAction}
      // 검색 없는 시트는 열릴 때 첫 항목에 포커스를 주지 않는다(모바일에서 포커스 링이 튀어 보임).
      autoFocus={searchable}
    >
      {searchable && (
        <div className="px-4 pb-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색"
            data-testid={`${testId}-search`}
            // 16px 미만이면 iOS 가 입력 시 화면을 확대한다.
            className="h-10 w-full rounded-md border bg-background px-3 text-base"
          />
        </div>
      )}
      <div role="listbox" aria-label={title} className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected}
              data-testid={`picker-option-${o.value}`}
              onClick={() => {
                close();
                onSelect(o.value);
              }}
              className={cn(MOBILE_SHEET_ROW, selected && 'bg-accent font-medium')}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              {selected && <Check className="text-primary" aria-hidden />}
            </button>
          );
        })}
        {listFooter}
        {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">결과가 없습니다</p>}
      </div>
    </MobileSheetShell>
  );
}
