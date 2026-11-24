// 모바일 바텀시트 공용 껍데기(WP-194) — 그래버·제목 줄(+오른쪽 액션)·sr-only 설명·safe-area 패딩·높이 상한을 한 곳에 둔다.
// 선택 시트(MobilePickerSheet)·뷰 시트·필터 시트가 같은 모양을 쓰도록 공용화했다. 본문(children)은 각 시트가 채운다.
// 열리면 초점을 시트 컨텐츠 자신(tabindex -1)으로 옮겨 포커스 트랩이 걸리게 하고, 닫히면 연 요소로 돌려준다(WP-2057).
// 예전엔 열림 초점을 막기만 해서 키보드 초점이 aria-hidden 배경에 남았고, 닫힘 복원도 막아 초점이 body 로 빠졌다.
// 높이는 index.css 의 bottom sheet 규칙(max-height: var(--vvh), bottom: var(--kb-inset))으로 키보드에 맞춰진다.
import { type KeyboardEvent, type ReactNode, useCallback, useRef } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { DialogOpenerProbe, FOCUSABLE, noOtherDialogCovers, useDialogFocusRestore } from '@/hooks/useDialogFocusRestore';
import { cn } from '@/lib/utils';

import { isKeyboardEditable } from './useVisualViewport';

// 시트 안 한 줄 행 공통 스타일 — 터치 영역 44px, 아이콘 size-5. 선택 시트 옵션·뷰 시트 행이 공유한다.
export const MOBILE_SHEET_ROW =
  'flex min-h-11 w-full items-center gap-3 px-4 text-left text-base active:bg-accent disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0';

/**
 * 닫힘 복원 조건(WP-2057) — 셋 다 맞을 때만 연 요소로 돌려준다.
 * 1) 초점이 아직 아무 데도 없다(body) — 사용처가 닫으며 다른 곳(예: 위키 링크 적용 뒤 편집기)으로 옮겼으면 빼앗지 않는다.
 * 2) 다른 대화상자가 가리지 않는다(이어 연 시트·폭 전환으로 바뀐 대화상자).
 * 3) 연 요소가 키보드를 띄우는 편집 칸이 아니다 — 돌려주면 모바일 화면 키보드가 올라온다(위키 링크 시트는 그래서 편집기를 blur 하고 연다).
 */
function shouldRestoreFocus(target: HTMLElement) {
  const active = document.activeElement;
  if (active && active !== document.body) return false;
  return noOtherDialogCovers(target) && !isKeyboardEditable(target);
}

/**
 * 닫힘 복원 옵션(렌더마다 새 객체가 되지 않게 모듈에 둔다).
 * preventScroll — 연 단추가 화면 밖이어도 화면이 튀지 않게. followClosedDialogs — 액션 시트 항목이 연 시트는 사라진 항목 대신 액션 시트를 연 요소로.
 * keyboardOnly 판은 연 요소가 툴팁 트리거라 터치 복원이 툴팁을 남기는 호출부(WikiPresence)만 쓴다 — 스크린리더 터치 사용자도 복원이 필요해 기본은 아니다.
 */
const RESTORE_OPTIONS = { preventScroll: true, followClosedDialogs: true };
const RESTORE_OPTIONS_KEYBOARD_ONLY = { preventScroll: true, followClosedDialogs: true, keyboardOnly: true };

/**
 * Shift+Tab 으로 보낼 수 있는 요소인지 — 실제로 Tab 정지가 되는 것만 남긴다(WP-2057).
 * tabindex -1, 비활성 fieldset 안, visibility:hidden, inert·aria-hidden 조상 안, 레이아웃 없는(display:none) 요소는 뺀다.
 */
function isTabbable(el: HTMLElement) {
  if (el.tabIndex < 0 || el.getClientRects().length === 0) return false;
  if (getComputedStyle(el).visibility === 'hidden') return false;
  if (el.closest('fieldset:disabled, [inert], [aria-hidden="true"]')) return false;
  return true;
}

export function MobileSheetShell({
  open,
  onClose,
  title,
  description,
  testId,
  className,
  headerAction,
  autoFocus = false,
  restoreFocusForKeyboardOnly = false,
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
  /** 열릴 때 첫 포커스 가능 요소에 포커스(검색창 있는 시트 — Radix 기본). 기본(false)은 시트 컨텐츠 자신에 초점을 둔다(WP-2057) — 첫 단추에 링이 튀지 않으면서 포커스 트랩은 걸린다. */
  autoFocus?: boolean;
  /** 닫힘 포커스 복원을 키보드 사용자에게만 한다 — 연 요소가 툴팁 트리거라 터치 복원이 툴팁을 남기는 경우(WikiPresence). 기본(false)은 입력 수단과 무관하게 복원. */
  restoreFocusForKeyboardOnly?: boolean;
  children: ReactNode;
}) {
  // 시트 컨텐츠 DOM — autoFocus 가 아닐 때 열림 초점을 여기로 옮긴다(SheetContent 는 ref 를 props 로 그대로 내려보낸다).
  const contentRef = useRef<HTMLDivElement>(null);
  // 열림 초점: autoFocus 면 Radix 기본(첫 포커스 요소), 아니면 기본을 막고 컨텐츠 자신에 둔다(preventScroll 로 시트 슬라이드 중 튀지 않게).
  const openAutoFocus = useCallback(
    (e: Event) => {
      if (autoFocus) return;
      e.preventDefault();
      contentRef.current?.focus({ preventScroll: true });
    },
    [autoFocus],
  );
  // 닫힘 복원은 원시 시트·ui/DialogContent 와 같은 훅 — 연 요소로 초점을 돌려준다(조건은 shouldRestoreFocus).
  const focusRestore = useDialogFocusRestore(openAutoFocus, undefined, shouldRestoreFocus, restoreFocusForKeyboardOnly ? RESTORE_OPTIONS_KEYBOARD_ONLY : RESTORE_OPTIONS);
  // 열린 직후 초점은 컨텐츠 자신에 있어 Shift+Tab 이 Radix 트랩에 잡히지 않고 배경 마지막 요소로 샌다 — 시트 안 마지막 요소로 직접 보낸다(WP-2057).
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    if (e.key !== 'Tab' || !e.shiftKey || !content || e.target !== content) return;
    e.preventDefault();
    // 뒤에서부터 첫 Tab 정지 요소 하나만 찾는다. 없으면 컨텐츠에 그대로 둔다.
    const items = content.querySelectorAll<HTMLElement>(FOCUSABLE);
    for (let i = items.length - 1; i >= 0; i--) {
      if (isTabbable(items[i])) {
        items[i].focus();
        return;
      }
    }
  }, []);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        ref={contentRef}
        side="bottom"
        showCloseButton={false}
        data-testid={testId}
        className={cn('flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] outline-none', className)}
        onKeyDown={onKeyDown}
        onCloseAutoFocus={focusRestore.onCloseAutoFocus}
        onOpenAutoFocus={focusRestore.onOpenAutoFocus}
      >
        {/* 입력 칸 autoFocus 가 초점을 옮기기 전에 연 요소를 잡는다(ui/DialogContent 와 같다). */}
        <DialogOpenerProbe onMount={focusRestore.captureOpener} />
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
