// 모바일 에픽 시트 맨 아래 「종료된 에픽」 구역(WP-245) — MobilePickerSheet 의 listFooter 로 들어간다.
// 검색 중이면(검색어로 거른 목록을 받는다) 항상 펼쳐 보여 준다. 거르기·빈 결과 처리는 호출부의 listFooter 함수가 맡는다 —
// 맞는 것이 없을 때 null 을 돌려줘야 시트가 「결과가 없습니다」를 띄우기 때문(요소는 안에서 null 을 그려도 truthy).
// 선택·「›」 는 시트가 넘겨 준 close 로 닫는다 — 검색어까지 함께 비워 다음에 열 때 걸러진 목록이 남지 않게.
import { Check, ChevronRight } from 'lucide-react';

import { MOBILE_SHEET_ROW } from '@/components/mobile/MobileSheetShell';
import { cn } from '@/lib/utils';

import { ClosedStatusBadge } from '../../../../components/issues/ClosedStatusBadge';
import type { IssueResponse } from '../../../../types/issue';

export function MobileClosedEpicsFooter({
  epics, searching, open, selectedNumber, onToggle, onSelect, onOpenDetail, close,
}: {
  /** 보여 줄 종료 에픽 — 검색 중이면 검색어로 거른 목록(비어 있지 않음). */
  epics: IssueResponse[];
  /** 시트에 검색어가 있음 — 이때는 맞는 종료 에픽이 보이도록 항상 펼친다. */
  searching: boolean;
  /** 검색 중이 아닐 때의 펼침 상태(접힘 기본, 선택된 종료 에픽이 있으면 펼침 — 상위가 정한다). */
  open: boolean;
  selectedNumber: number | null;
  onToggle: (next: boolean) => void;
  onSelect: (epicNumber: number) => void;
  onOpenDetail: (epicNumber: number) => void;
  close: () => void;
}) {
  const expanded = searching || open;

  return (
    <div className="border-t">
      <button
        type="button"
        aria-expanded={expanded}
        data-testid="mobile-epic-closed-toggle"
        onClick={() => onToggle(!expanded)}
        className={cn(MOBILE_SHEET_ROW, 'text-sm text-muted-foreground')}
      >
        <ChevronRight className={cn('transition-transform', expanded && 'rotate-90')} aria-hidden />
        <span className="flex-1">종료된 에픽</span>
        <span>{epics.length}</span>
      </button>
      {expanded &&
        epics.map((ep) => {
          const selected = selectedNumber === ep.number;
          return (
            <div key={ep.number} className={cn('flex items-stretch', selected && 'bg-accent')}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`mobile-epic-closed-${ep.number}`}
                onClick={() => {
                  close();
                  // 이미 선택된 에픽 재탭은 해제하지 않는다(시트의 진행 중 옵션과 같은 규칙).
                  if (!selected) onSelect(ep.number);
                }}
                className={cn(MOBILE_SHEET_ROW, 'min-w-0 flex-1', selected && 'font-medium')}
              >
                <span className={cn('min-w-0 flex-1 truncate text-muted-foreground', ep.status === 'CANCELED' && 'line-through')}>
                  {ep.title}
                </span>
                <ClosedStatusBadge status={ep.status} />
                {selected ? <Check className="text-primary" aria-hidden /> : <span className="size-5 shrink-0" aria-hidden />}
              </button>
              <button
                type="button"
                aria-label={`${ep.title} 상세 열기`}
                data-testid={`mobile-epic-closed-${ep.number}-detail`}
                onClick={() => {
                  close();
                  onOpenDetail(ep.number);
                }}
                className="flex w-11 shrink-0 items-center justify-center border-l text-muted-foreground active:bg-accent"
              >
                <ChevronRight className="size-5" aria-hidden />
              </button>
            </div>
          );
        })}
    </div>
  );
}
