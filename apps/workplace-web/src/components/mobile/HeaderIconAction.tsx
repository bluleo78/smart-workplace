// 모바일 헤더 인라인 주 액션 — 44px 아이콘 버튼(＋ 새 항목·✎ 편집 등). 텍스트 버튼 대신 써서 제목 폭을 지킨다(U1-2).
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function HeaderIconAction({
  label,
  onClick,
  disabled,
  tone = 'primary',
  children,
  'data-testid': testId,
}: {
  /** 스크린리더·툴팁용 이름(아이콘만 보이므로 필수). */
  label: string
  onClick: () => void
  disabled?: boolean
  /** primary = 화면의 주 동작(보내기·＋), default = 곁 동작(📎 첨부 등) — 주 동작보다 덜 눈에 띄게 기본 글자색. */
  tone?: 'primary' | 'default'
  children: ReactNode
  'data-testid'?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // 꺼진 상태는 활성 색과 확실히 구분되게 muted 글자색으로(주 색을 흐리게만 하면 켜진 것처럼 보였다).
        'flex h-11 w-11 shrink-0 items-center justify-center disabled:text-muted-foreground disabled:opacity-60 [&_svg]:h-5 [&_svg]:w-5',
        tone === 'primary' ? 'text-primary' : 'text-foreground',
      )}
    >
      {children}
    </button>
  )
}
