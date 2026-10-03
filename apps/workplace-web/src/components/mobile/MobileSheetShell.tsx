// 모바일 바텀시트 공용 껍데기(WP-194) — 그래버·제목 줄(+오른쪽 액션)·sr-only 설명·safe-area 패딩·높이 상한을 한 곳에 둔다.
// 선택 시트(MobilePickerSheet)·뷰 시트·필터 시트가 같은 모양을 쓰도록 공용화했다. 본문(children)은 각 시트가 채운다.
// 높이는 index.css 의 bottom sheet 규칙(max-height: var(--vvh), bottom: var(--kb-inset))으로 키보드에 맞춰진다.
import type { ReactNode } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// 시트 안 한 줄 행 공통 스타일 — 터치 영역 44px, 아이콘 size-5. 선택 시트 옵션·뷰 시트 행이 공유한다.
export const MOBILE_SHEET_ROW =
  'flex min-h-11 w-full items-center gap-3 px-4 text-left text-base active:bg-accent disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0';

export function MobileSheetShell({
  open,
  onClose,
  title,
  description,
  testId,
  className,
  headerAction,
  autoFocus = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 스크린리더용 설명(sr-only). */
  description: string;
  testId: string;
  /** SheetContent 추가 클래스(예: 최소 높이). */
  className?: string;
  /** 제목 줄 오른쪽 액션(예: 「에픽 만들기」·「전체 해제」). */
  headerAction?: ReactNode;
  /** 열릴 때 첫 포커스 가능 요소에 포커스(검색창 있는 시트). 기본은 막는다 — 모바일에서 포커스 링이 튀어 보임. */
  autoFocus?: boolean;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid={testId}
        className={cn('flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]', className)}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          if (!autoFocus) e.preventDefault();
        }}
      >
        {/* 그래버 — 바텀시트임을 알리는 손잡이 표시. */}
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {headerAction}
        </div>
        <SheetDescription className="sr-only">{description}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
