// 데스크톱 🔗 링크 복사 버튼(WP-1234) — 상세 화면 오른쪽 위에서 누르면 지금 보는 대상의 링크를 바로 복사한다.
// PWA(데스크톱 앱)에는 주소창이 없어 링크를 딸 길이 이것뿐이다. 툴팁에 같은 일을 하는 단축키(⇧⌘,)를 함께 알린다.
import { Link } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { shareShortcutLabels, type ShareTarget } from '@/lib/shareTarget'
import { cn } from '@/lib/utils'

import { copyShareLink } from './shareActions'

export function CopyLinkButton({
  target,
  className,
  tooltipClassName,
}: {
  target: ShareTarget
  className?: string
  /** 툴팁은 body 로 포털된다 — 다크 뷰어처럼 테마를 직접 단 화면은 같은 테마 클래스를 넘긴다. */
  tooltipClassName?: string
}) {
  const label = `링크 복사 ${shareShortcutLabels().link}`
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            data-testid="copy-link-button"
            className={cn('shrink-0', className)}
            onClick={() => void copyShareLink(target)}
          >
            <Link aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className={tooltipClassName}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
