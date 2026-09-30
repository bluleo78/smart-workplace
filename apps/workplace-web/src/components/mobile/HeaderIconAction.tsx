// 모바일 헤더 인라인 주 액션 — 44px 아이콘 버튼(＋ 새 항목·✎ 편집 등). 텍스트 버튼 대신 써서 제목 폭을 지킨다(U1-2).
import type { ReactNode } from 'react'

export function HeaderIconAction({
  label,
  onClick,
  disabled,
  children,
  'data-testid': testId,
}: {
  /** 스크린리더·툴팁용 이름(아이콘만 보이므로 필수). */
  label: string
  onClick: () => void
  disabled?: boolean
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
      className="flex h-11 w-11 shrink-0 items-center justify-center text-primary disabled:opacity-50 [&_svg]:h-5 [&_svg]:w-5"
    >
      {children}
    </button>
  )
}
