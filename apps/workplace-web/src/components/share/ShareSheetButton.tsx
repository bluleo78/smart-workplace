// 모바일 ⬆︎ 공유 버튼(WP-1234) — 내비 바에 하나만 두고, 누르면 공유 시트(MobileActionSheet)를 연다.
// 아이폰 홈 화면 앱에는 주소창도 브라우저 공유 단추도 없어, 링크를 꺼내는 길을 이 시트 하나로 모은다.
// 시트 항목: 링크 복사(항상) · 다른 앱으로 보내기(Web Share 가 있을 때) · 키 복사(이슈) · 외부 공유 링크…(노트·드라이브).
import { Share } from 'lucide-react'
import { useState } from 'react'

import { MobileActionSheet } from '@/components/mobile/MobileActionSheet'
import type { ShareTarget } from '@/lib/shareTarget'
import { cn } from '@/lib/utils'

import { shareSheetActions } from './shareSheetActions'

export function ShareSheetButton({
  target,
  className,
  aboveAiSheet,
}: {
  target: ShareTarget
  className?: string
  /** AI 시트 안에서 연 화면(뷰어)이면 시트도 그 위로 올린다. */
  aboveAiSheet?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label="공유"
        aria-haspopup="dialog"
        data-testid="mobile-share-button"
        onClick={() => setOpen(true)}
        className={cn('flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground', className)}
      >
        <Share className="h-5 w-5" aria-hidden="true" />
      </button>
      <MobileActionSheet
        open={open}
        onClose={() => setOpen(false)}
        title={target.title}
        description={`${target.title} 공유`}
        actions={open ? shareSheetActions(target) : []}
        testId="share-sheet"
        aboveAiSheet={aboveAiSheet}
      />
    </>
  )
}
