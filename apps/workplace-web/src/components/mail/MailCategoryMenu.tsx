// WP-1341 메일 분류 직접 바꾸기 — 데스크톱은 상세 동작 줄의 「분류: {분류} ▾」 드롭다운, 휴대폰은 바텀 시트(상세 ⋯ 메뉴·길게 누르기 시트에서 연다).
// 바꾼 분류는 나에게만 적용된다(내 메일 사본, 같은 메일을 받은 동료에게는 보이지 않음). 직접 바꾼 상태면 「AI 분류로 되돌리기」를 둔다.
// 바꾼 직후 알림 두 개는 useChangeMailCategory(hooks/queries)가 띄운다 — ① 「분류를 ○○(으)로 바꿨어요 [되돌리기]」
// ② 개인 비서·AI 기억이 켜져 있으면 학습 결과 「✦ AI 비서가 기억했어요: {문장} [기억 취소]」. 모양은 MailMoveMenu(옮기기)와 같은 패턴이다.
import { Check, ChevronDown, Tag } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { MAIL_CATEGORIES, type MailCategoryState } from '@/types/mailMessage'

// 분류 상태 타입은 types/mailMessage 에 둔다(만드는 함수 toCategoryState 와 함께) — 기존 import 경로를 위해 다시 내보낸다.
export type { MailCategoryState }

/**
 * 데스크톱 상세 동작 줄 「분류: {분류} ▾」(분류가 없으면 「분류」) — 머리말 「분류 바꾸기 · 나에게만 적용」, 5종(현재 ✓),
 * 직접 바꾼 상태면 구분선 아래 「AI 분류로 되돌리기」. onPick(null) 이 되돌리기다. 지금 분류를 다시 고른 경우는 받는 쪽(useChangeMailCategory)이 무시한다.
 */
export function MailCategoryMenu({
  current,
  onPick,
}: {
  current: MailCategoryState
  onPick: (category: string | null) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="mail-category">
          <Tag className="h-3.5 w-3.5" />
          {current.aiCategory ? `분류: ${current.aiCategory}` : '분류'}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-testid="mail-category-menu"
        className="w-56"
        // 메뉴(포털) 안 클릭이 React 트리로 상세·행 클릭에 번지지 않게(MailMoveMenu 와 같은 이유).
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">분류 바꾸기 · 나에게만 적용</DropdownMenuLabel>
        {MAIL_CATEGORIES.map((c) => (
          <DropdownMenuCheckboxItem
            key={c}
            data-testid={`mail-category-option-${c}`}
            checked={current.aiCategory === c}
            onSelect={() => onPick(c)}
          >
            {c}
          </DropdownMenuCheckboxItem>
        ))}
        {current.categoryByMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="mail-category-revert" onSelect={() => onPick(null)}>
              AI 분류로 되돌리기
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 휴대폰 분류 시트 한 줄 — 44px 행(MailMoveTargetSheet 와 같은 모양). */
function SheetRow({ children, ...props }: { children: ReactNode } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-base text-foreground active:bg-accent"
    >
      {children}
    </button>
  )
}

/**
 * 휴대폰·터치 「분류 바꾸기」 바텀 시트 — 제목 아래 「나에게만 적용돼요」, 5종(현재 ✓), 직접 바꾼 상태면 「AI 분류로 되돌리기」.
 * current 가 null 이면 닫혀 있다. 고르면 시트를 먼저 닫고(알림이 시트 오버레이 밑에 깔리지 않게) onPick 을 부른다(지금 분류를 다시 고르면
 * 받는 쪽이 무시한다).
 */
export function MailCategorySheet({
  current,
  onClose,
  onPick,
}: {
  current: MailCategoryState | null
  onClose: () => void
  onPick: (category: string | null) => void
}) {
  const pick = (c: string | null) => {
    onClose()
    onPick(c)
  }
  return (
    <Sheet open={current != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="mail-category-sheet"
        className="max-h-[85dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
        <SheetTitle className="px-4 pt-2 text-center text-base">분류 바꾸기</SheetTitle>
        <SheetDescription className="px-4 pb-1 text-center text-xs">나에게만 적용돼요</SheetDescription>
        <div role="menu" aria-label="분류 바꾸기" className="overflow-y-auto py-1">
          {MAIL_CATEGORIES.map((c) => {
            const checked = current?.aiCategory === c
            return (
              <SheetRow
                key={c}
                role="menuitemcheckbox"
                aria-checked={checked}
                data-testid={`mail-category-sheet-option-${c}`}
                onClick={() => pick(c)}
              >
                <span className="min-w-0 flex-1 truncate">{c}</span>
                <Check aria-hidden className={cn('size-5 shrink-0 text-primary', !checked && 'invisible')} />
              </SheetRow>
            )
          })}
          {current?.categoryByMe && (
            <div className="border-t">
              <SheetRow role="menuitem" data-testid="mail-category-sheet-revert" onClick={() => pick(null)}>
                AI 분류로 되돌리기
              </SheetRow>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
