// WP-962 「옮기기」 대상 고르기 — 데스크톱은 드롭다운 메뉴(목록 행 hover 버튼·상세 툴바), 휴대폰·터치는 바텀 시트(길게 누르기 시트·상세 ⋯ 메뉴).
// 받은편지함·보관을 위에, 그 아래 「내 메일함」 트리를 깊이만큼 들여 보인다. 메일을 담지 못하는 묶음 메일함은 이름만(고를 수 없음).
// 어떤 메일함을 둘지는 lib/mailMoveActions 의 mailMoveTargets 가 정한다(지금 보는 메일함 제외 등).
import { Archive, Folder, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { folderIndentPx } from '@/lib/mailFolders'
import type { MailMoveTargetOption } from '@/lib/mailMoveActions'
import { cn } from '@/lib/utils'
import type { MailMoveTarget } from '@/types/mailFolder'

/** 대상 아이콘 — 받은편지함·보관·메일함. */
function TargetIcon({ option }: { option: MailMoveTargetOption }) {
  if (option.target.kind === 'INBOX') return <Inbox aria-hidden />
  if (option.target.kind === 'ARCHIVE') return <Archive aria-hidden />
  return <Folder aria-hidden />
}

/** 기본 메일함과 내 메일함 사이 구분이 필요한가(둘 다 있을 때). */
function splitIndex(targets: readonly MailMoveTargetOption[]): number {
  const i = targets.findIndex((t) => t.section === 'user')
  return i > 0 ? i : -1
}

/**
 * 데스크톱 「옮기기」 드롭다운. trigger 는 버튼 하나(asChild). 열고 닫을 때 행 클릭으로 번지지 않게 메뉴 안 이벤트는 호출 측 행 밖(portal)이다.
 */
export function MailMoveMenu({
  targets,
  onPick,
  trigger,
  align = 'end',
  testIdPrefix = 'mail-move-target',
}: {
  targets: readonly MailMoveTargetOption[]
  onPick: (target: MailMoveTarget) => void
  trigger: ReactNode
  align?: 'start' | 'end'
  testIdPrefix?: string
}) {
  const split = splitIndex(targets)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        data-testid="mail-move-menu"
        // 긴 트리도 화면 안에서 스크롤 — 메뉴가 화면 밖으로 넘치지 않게.
        className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-56 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">옮길 메일함</DropdownMenuLabel>
        {targets.map((t, i) => (
          <div key={t.key}>
            {i === split && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">내 메일함</DropdownMenuLabel>
              </>
            )}
            <DropdownMenuItem
              data-testid={`${testIdPrefix}-${t.key}`}
              disabled={!t.selectable}
              onSelect={() => onPick(t.target)}
              style={t.section === 'user' ? { paddingLeft: folderIndentPx(t.depth) + 2 } : undefined}
              className="[&_svg]:text-muted-foreground"
            >
              <TargetIcon option={t} />
              <span className="min-w-0 truncate">{t.label}</span>
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 휴대폰·터치 「옮기기」 바텀 시트 — 44px 행, 내 메일함은 깊이만큼 들여 쓴다. */
export function MailMoveTargetSheet({
  open,
  onClose,
  targets,
  onPick,
}: {
  open: boolean
  onClose: () => void
  targets: readonly MailMoveTargetOption[]
  onPick: (target: MailMoveTarget) => void
}) {
  const split = splitIndex(targets)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="mail-move-sheet"
        className="max-h-[85dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
        <SheetTitle className="px-4 pb-1 pt-2 text-base">옮길 메일함</SheetTitle>
        <SheetDescription className="sr-only">메일을 옮길 메일함을 고르세요</SheetDescription>
        <div className="overflow-y-auto py-1">
          {targets.map((t, i) => (
            <div key={t.key}>
              {i === split && <p className="border-t px-4 pb-1 pt-2 text-xs text-muted-foreground">내 메일함</p>}
              <button
                type="button"
                data-testid={`mail-move-sheet-target-${t.key}`}
                disabled={!t.selectable}
                onClick={() => {
                  // 시트를 먼저 닫는다 — 실행 취소 토스트가 시트 오버레이 밑에 깔리지 않게(MessageActionSheet 와 같은 이유).
                  onClose()
                  onPick(t.target)
                }}
                style={t.section === 'user' ? { paddingLeft: 16 + Math.min(t.depth, 4) * 16 } : undefined}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 px-4 text-left text-base text-foreground active:bg-accent disabled:text-muted-foreground [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                )}
              >
                <TargetIcon option={t} />
                <span className="min-w-0 truncate">{t.label}</span>
              </button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
