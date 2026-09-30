// 모바일 상세 헤더 바 — [‹ 뒤로] [제목] [trailing 액션] [✦ AI]. 탭바가 없는 화면의 단일 헤더(U1-1).
// 병합 모드 PageHeader 와 알림 푸시 화면이 같은 모양·동작을 공유한다.
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { DetailAiButton } from './DetailAiButton'
import { mobileDetailTitleClass } from './headerClass'
import { useMobileBack } from './useMobileBack'

export function MobileDetailBar({
  title,
  trailing,
  className,
  'data-testid': testId,
}: {
  title?: ReactNode
  /** ✦ 앞 우측 클러스터(주 액션·⋯ 메뉴 등). */
  trailing?: ReactNode
  className?: string
  'data-testid'?: string
}) {
  const onBack = useMobileBack()
  return (
    <header
      data-testid={testId}
      // relative z-45 — ⋯ 메뉴 패널이 본문 위로 뜨도록(데스크톱 PageHeader 와 같은 층, 오버레이 z-50 보다는 아래).
      className={cn('relative z-[45] flex h-14 shrink-0 items-center gap-0.5 border-b bg-background px-1', className)}
    >
      <button
        type="button"
        data-testid="mobile-back"
        aria-label="뒤로"
        onClick={onBack}
        className="flex h-11 w-11 shrink-0 items-center justify-center text-primary"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <h1 data-testid="mobile-back-title" className={mobileDetailTitleClass}>{title}</h1>
      {trailing}
      <DetailAiButton data-testid="mobile-back-ai" />
    </header>
  )
}
