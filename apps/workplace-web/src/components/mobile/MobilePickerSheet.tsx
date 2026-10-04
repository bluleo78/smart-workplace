// 모바일 단일 선택 바텀시트 — 상태·우선순위·에픽·담당자 등 "목록에서 하나 고르기"의 공용 부품(WP-193~196).
// 선택하면 onSelect 후 닫힌다. searchable 이면 상단 검색창(키보드는 시트 안에서만 — 시트·키보드 동시 표시 원칙상 바깥 입력칸은 이미 blur).
// 그래버·제목 줄·safe-area 등 시트 껍데기는 MobileSheetShell 이 맡는다.
// 옵션에 detail 이 있으면 행 끝에 「›」 버튼을 붙인다 — 선택 버튼 안에 중첩할 수 없어 형제로 둔다.
import { Check, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { cn } from '@/lib/utils';

import { MOBILE_SHEET_ROW, MobileSheetShell } from './MobileSheetShell';

export interface PickerOption {
  value: string;
  label: string;
  icon?: ReactNode;
  /** 오른쪽 보조 정보(개수·진행률 등). */
  hint?: ReactNode;
  /** 행 끝 「›」 보조 버튼(예: 에픽 상세 열기, WP-227) — 행 탭(선택)과 별개로 동작한다. 누르면 시트를 닫고 실행. */
  detail?: { label: string; onOpen: () => void };
}

export function MobilePickerSheet({
  open, onClose, title, options, value, onSelect, searchable = false, testId = 'mobile-picker-sheet', headerAction, listFooter, reserveCheck = false,
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
  /** 미선택 줄에도 ✓ 자리를 비워 둔다 — hint 가 줄마다 같은 x 에 서야 하는 시트(진행률 등)용. 선택된 줄만 hint 가 밀리지 않게. */
  reserveCheck?: boolean;
}) {
  const [q, setQ] = useState('');
  const keyword = q.trim().toLowerCase();
  const shown = keyword ? options.filter((o) => o.label.toLowerCase().includes(keyword)) : options;
  // 한 행이라도 「›」가 있으면 없는 행에도 같은 폭 자리를 비워 ✓·힌트 열을 맞춘다.
  const hasDetail = options.some((o) => o.detail);
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
          const optionButton = (
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
              className={cn(MOBILE_SHEET_ROW, hasDetail && 'min-w-0 flex-1', selected && 'bg-accent font-medium')}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {/* hint 는 선택 줄(font-medium)에서도 보통 굵기 — 굵기가 바뀌면 ch 폭이 달라져 줄마다 위치가 어긋난다. */}
              {o.hint && <span className="shrink-0 text-xs font-normal text-muted-foreground">{o.hint}</span>}
              {selected ? <Check className="text-primary" aria-hidden /> : reserveCheck && <span className="size-5 shrink-0" aria-hidden />}
            </button>
          );
          if (!hasDetail) return optionButton;
          const { detail } = o;
          return (
            <div key={o.value} className={cn('flex items-stretch', selected && 'bg-accent')}>
              {optionButton}
              {detail ? (
                <button
                  type="button"
                  aria-label={detail.label}
                  data-testid={`picker-option-${o.value}-detail`}
                  onClick={() => {
                    close();
                    detail.onOpen();
                  }}
                  // 보이는 폭 44px · 행 높이 그대로(≥44px) — 터치 영역 기준 충족. 왼쪽 구분선으로 행 탭 영역과 나눈다.
                  className="flex w-11 shrink-0 items-center justify-center border-l text-muted-foreground active:bg-accent"
                >
                  <ChevronRight className="size-5" aria-hidden />
                </button>
              ) : (
                <span className="w-11 shrink-0" aria-hidden />
              )}
            </div>
          );
        })}
        {listFooter}
        {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">결과가 없습니다</p>}
      </div>
    </MobileSheetShell>
  );
}
