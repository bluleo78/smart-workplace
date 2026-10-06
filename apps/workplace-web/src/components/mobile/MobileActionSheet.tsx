// 모바일 액션 바텀시트 — 길게 누르기 등으로 여는 "이 항목에 할 수 있는 일" 목록(44px 행). 채팅 MessageActionSheet 의 스타일을
// 일반화했다(채팅은 이모지 줄 등 고유 요소가 있어 이번엔 이관하지 않음). 액션을 누르면 시트를 먼저 닫고 실행한다 —
// 이어서 여는 다른 시트·토스트가 닫히는 오버레이 밑에 깔리지 않게.
import type { ReactNode } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface MobileSheetAction {
  /** testid 접미사(`mobile-action-<key>`)이자 React key. */
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** 파괴적 작업 — 빨간 글자. */
  destructive?: boolean;
  /** 지금은 할 수 없는 작업(보관된 공간·원본 유실 등) — 숨기지 않고 흐리게 보여 이유를 짐작하게 한다. */
  disabled?: boolean;
}

export function MobileActionSheet({
  open, onClose, title, description, actions, testId = 'mobile-action-sheet', className,
}: {
  open: boolean;
  onClose: () => void;
  /** 시트 상단에 보이는 대상 이름(예: 이슈 제목). */
  title: string;
  description?: string;
  actions: MobileSheetAction[];
  testId?: string;
  /** 시트 층·모양 보정 — 더 높은 층(z-[60] AI 시트) 안에서 열 때 z-[80] 등으로 올린다(WP-234). */
  className?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid={testId}
        className={cn('max-h-[85dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]', className)}
        // 트리거 없는 시트 — 닫힐 때 포커스를 되돌리지 않는다(행으로 포커스가 튀어 스크롤되는 것 방지).
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
        <SheetTitle className="line-clamp-2 px-4 pb-1 pt-3 text-base font-semibold">{title}</SheetTitle>
        <SheetDescription className="sr-only">{description ?? `${title} 작업`}</SheetDescription>
        <div className="py-1">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              data-testid={`mobile-action-${a.key}`}
              disabled={a.disabled}
              onClick={() => {
                onClose();
                a.onSelect();
              }}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 px-4 text-left text-base active:bg-accent disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0',
                a.destructive ? 'text-destructive' : 'text-foreground [&_svg]:text-muted-foreground',
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
