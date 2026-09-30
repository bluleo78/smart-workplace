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
  titleAccessory,
  trailing,
  showAi = true,
  className,
  'data-testid': testId,
}: {
  title?: ReactNode
  /** 제목 바로 뒤에 붙는 작은 표식(노트의 "AI 생성" 칩 등). 제목(h1) 밖에 두어 제목 텍스트·접근 이름은 그대로다. */
  titleAccessory?: ReactNode
  /** ✦ 앞 우측 클러스터(주 액션·⋯ 메뉴 등). */
  trailing?: ReactNode
  /** ✦(AI) 버튼 표시 — 탭 편집처럼 화면 컨텍스트가 없는 설정 화면은 끈다(U3-R9). */
  showAi?: boolean
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
      {titleAccessory == null ? (
        <h1 data-testid="mobile-back-title" className={mobileDetailTitleClass}>{title}</h1>
      ) : (
        // 표식이 있으면 제목과 표식을 한 묶음으로 — 제목이 먼저 말줄임되고 표식은 제목 바로 뒤에 남는다.
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h1 data-testid="mobile-back-title" className={cn(mobileDetailTitleClass, 'flex-initial')}>{title}</h1>
          {titleAccessory}
        </div>
      )}
      {trailing}
      {showAi && <DetailAiButton data-testid="mobile-back-ai" />}
    </header>
  )
}
