// 모바일 상세 헤더 바 — [‹ 뒤로] [제목] [trailing 액션] [✦ AI]. 탭바가 없는 화면의 단일 헤더(U1-1).
// 병합 모드 PageHeader 와 알림 푸시 화면이 같은 모양·동작을 공유한다.
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { DetailAiButton } from './DetailAiButton'
import { mobileBackButtonClass, mobileDetailBarClass, mobileDetailTitleClass } from './headerClass'
import { useMobileBack } from './useMobileBack'

export function MobileDetailBar({
  title,
  titleAccessory,
  titleClassName,
  titleVisible,
  trailing,
  showAi = true,
  onBack: onBackOverride,
  className,
  'data-testid': testId,
}: {
  title?: ReactNode
  /** 제목 바로 뒤에 붙는 작은 표식(노트의 "AI 생성" 칩 등). 제목(h1) 밖에 두어 제목 텍스트·접근 이름은 그대로다. */
  titleAccessory?: ReactNode
  /** 제목(h1) 추가 클래스 — 표식이 있을 때 제목을 줄어들지 않게 고정(shrink-0)하는 등. 없으면 기본 동작. */
  titleClassName?: string
  /**
   * 제목을 스크롤에 맞춰 보였다 숨기는 화면(메일 상세, WP-400)만 넘긴다 — false 면 제목을 투명하게 페이드하고 보조기술에서도 숨겨
   * 본문의 같은 제목을 두 번 읽지 않게 한다. 넘기지 않으면(undefined) 늘 보이고 페이드 전환도 없다.
   */
  titleVisible?: boolean
  /** ✦ 앞 우측 클러스터(주 액션·⋯ 메뉴 등). */
  trailing?: ReactNode
  /** ✦(AI) 버튼 표시 — 탭 편집처럼 화면 컨텍스트가 없는 설정 화면은 끈다(U3-R9). */
  showAi?: boolean
  /** ‹ 동작 재정의 — 화면이 자체 복귀 규칙을 가질 때(이슈 상세: 들어오기 직전 화면으로, #885). 없으면 히스토리/모듈 루트. */
  onBack?: () => void
  className?: string
  'data-testid'?: string
}) {
  const defaultBack = useMobileBack()
  const onBack = onBackOverride ?? defaultBack
  const titleHidden = titleVisible === false
  // 제목 표시 토글을 쓰는 화면만 페이드 전환을 붙인다.
  const titleFadeClass = titleVisible !== undefined && cn('transition-opacity duration-200', titleHidden && 'opacity-0')
  return (
    <header
      data-testid={testId}
      // relative z-45 — ⋯ 메뉴 패널이 본문 위로 뜨도록(데스크톱 PageHeader 와 같은 층, 오버레이 z-50 보다는 아래).
      className={cn('relative z-[45] bg-background', mobileDetailBarClass, className)}
    >
      <button
        type="button"
        data-testid="mobile-back"
        aria-label="뒤로"
        onClick={onBack}
        className={mobileBackButtonClass}
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      {titleAccessory == null ? (
        <h1 data-testid="mobile-back-title" aria-hidden={titleHidden || undefined} className={cn(mobileDetailTitleClass, titleFadeClass, titleClassName)}>{title}</h1>
      ) : (
        // 표식이 있으면 제목과 표식을 한 묶음으로 — 제목이 먼저 말줄임되고 표식은 제목 바로 뒤에 남는다.
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h1 data-testid="mobile-back-title" aria-hidden={titleHidden || undefined} className={cn(mobileDetailTitleClass, 'flex-initial', titleFadeClass, titleClassName)}>{title}</h1>
          {titleAccessory}
        </div>
      )}
      {trailing}
      {showAi && <DetailAiButton data-testid="mobile-back-ai" />}
    </header>
  )
}
