// 모바일 단일 선택 바텀시트 — 상태·우선순위·에픽·담당자 등 "목록에서 하나 고르기"의 공용 부품(WP-193~196).
// 선택하면 onSelect 후 닫힌다. searchable 이면 상단 검색창(키보드는 시트 안에서만 — 시트·키보드 동시 표시 원칙상 바깥 입력칸은 이미 blur).
// 높이는 index.css 의 bottom sheet 규칙(max-height: var(--vvh), bottom: var(--kb-inset))으로 키보드에 맞춰진다.
import { Check } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface PickerOption {
  value: string;
  label: string;
  icon?: ReactNode;
  /** 오른쪽 보조 정보(개수·진행률 등). */
  hint?: ReactNode;
}

export function MobilePickerSheet({
  open, onClose, title, options, value, onSelect, searchable = false, testId = 'mobile-picker-sheet',
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
}) {
  const [q, setQ] = useState('');
  const keyword = q.trim().toLowerCase();
  const shown = keyword ? options.filter((o) => o.label.toLowerCase().includes(keyword)) : options;
  const close = () => {
    setQ('');
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid={testId}
        className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
        onCloseAutoFocus={(e) => e.preventDefault()}
        // 검색 없는 시트는 열릴 때 첫 항목에 포커스를 주지 않는다(모바일에서 포커스 링이 튀어 보임).
        onOpenAutoFocus={(e) => {
          if (!searchable) e.preventDefault();
        }}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" />
        <SheetTitle className="px-4 pb-2 pt-3 text-base">{title}</SheetTitle>
        <SheetDescription className="sr-only">{title} 중 하나를 고르세요.</SheetDescription>
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
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 px-4 text-left text-base active:bg-accent [&_svg]:size-5 [&_svg]:shrink-0',
                  selected && 'bg-accent font-medium',
                )}
              >
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
                {selected && <Check className="text-primary" aria-hidden />}
              </button>
            );
          })}
          {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">결과가 없습니다</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
