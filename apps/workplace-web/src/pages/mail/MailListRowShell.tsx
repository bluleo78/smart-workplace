// 임시보관함·예약됨 목록이 함께 쓰는 행 뼈대(WP-1787 리뷰 후속) — 3줄 행 모양(첫 줄: 열기 버튼·첨부·곁 내용·⋯ 메뉴 / 제목 / 미리보기).
// WP-1550: 행은 버튼이 아니다 — 버튼 안에 ⋯ 메뉴 버튼이 중첩되면 접근성 위반(nested-interactive)이라, 마우스 클릭만 행 전체가 받고
// 키보드·스크린리더 접근점은 안의 열기 버튼(data-row-open)과 ⋯ 메뉴 버튼을 형제로 둔다. 받은편지함 행과 같은 방식.
import { MoreHorizontal, Paperclip } from 'lucide-react'
import type { ReactNode } from 'react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { hasMailSubject, mailSubjectText } from '@/lib/mailSubject'
import { cn } from '@/lib/utils'

/**
 * 목록 행 뼈대 — 3줄 행(열기 버튼·첨부·곁 내용·⋯ 메뉴 / 제목 / 미리보기)과 행 클릭·키보드 접근 규칙을 한 곳에 둔다.
 * 임시보관함과 예약됨 목록이 행 모양·접근성(중첩 버튼 금지)을 똑같이 가져가야 해서 공유한다 — 다른 점(곁 내용·메뉴 항목)만 호출부가 채운다.
 */
export function MailListRowShell({
  testId,
  rowAttrs,
  onOpen,
  openTestId,
  openLabel,
  lead,
  attachmentCount,
  attachmentTestId,
  trailing,
  menuTestId,
  menuLabel,
  menuItems,
  subject,
  preview,
}: {
  testId: string
  /** 행에 더 붙일 data 속성 */
  rowAttrs?: Record<string, string | number>
  onOpen: () => void
  openTestId?: string
  openLabel: string
  /** 열기 버튼 안 내용(표식·시각 + 받는 사람) */
  lead: ReactNode
  attachmentCount: number
  attachmentTestId?: string
  /** 첨부 표시와 ⋯ 사이의 곁 내용(저장 시각 등) */
  trailing?: ReactNode
  menuTestId: string
  menuLabel: string
  /** ⋯ 메뉴 항목(DropdownMenuItem 들) */
  menuItems: ReactNode
  subject: string
  preview: string
}) {
  return (
    <div
      data-testid={testId}
      {...rowAttrs}
      onClick={onOpen}
      className={cn(
        'flex w-full min-w-0 cursor-pointer flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50',
        // 열기 버튼은 자체 outline 을 끄고(outline-none) 행 전체가 전역 초점 테두리(outline-ring/50)와 같은 모양으로 초점을 그린다.
        'has-[[data-row-open]:focus-visible]:outline-2 has-[[data-row-open]:focus-visible]:-outline-offset-2 has-[[data-row-open]:focus-visible]:outline-ring/50',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          data-row-open
          data-testid={openTestId}
          aria-label={openLabel}
          // 자체 onClick 은 두지 않는다 — 클릭·Enter·Space 의 click 이 행 onClick 으로 올라가 한 번만 연다.
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
        >
          {lead}
        </button>
        {attachmentCount > 0 && (
          <Paperclip
            data-testid={attachmentTestId}
            aria-label={`첨부 ${attachmentCount}개`}
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        )}
        {trailing}
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid={menuTestId}
            aria-label={menuLabel}
            // 행 열기와 분리 — 메뉴 버튼을 눌러도 행이 열리지 않게.
            onClick={(e) => e.stopPropagation()}
            // 데스크톱은 작은 아이콘 버튼, 터치는 위아래로 넓혀 44px(행 높이는 그대로).
            className="-my-1 -mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:-my-2.5 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:-mr-3"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <span className={cn('truncate text-sm', !hasMailSubject(subject) && 'text-muted-foreground')}>{mailSubjectText(subject)}</span>
      {preview && (
        <span aria-hidden="true" className="truncate text-xs text-muted-foreground">
          {preview}
        </span>
      )}
    </div>
  )
}
