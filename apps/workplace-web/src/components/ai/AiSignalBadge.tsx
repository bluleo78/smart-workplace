import { Sparkles } from 'lucide-react'

import { aiSignalBadgeClass, type AiSignalVariant } from './aiMarker'

// ③ AI 판단신호 배지 — AI가 기존 콘텐츠에 매긴 라벨(회신필요/분류/확인필요 등).
// icon-led: action/info 둘 다 미니 ✨ 보유(아이콘 유무로 비-AI 신호와 구분). reason 있으면 호버 툴팁(title).
// onClick 주어지면 <button>(필터 등 인터랙션), 아니면 <span>.
export function AiSignalBadge({
  variant,
  reason,
  onClick,
  className,
  children,
  'data-testid': testId,
}: {
  variant: AiSignalVariant
  reason?: string
  onClick?: (e: React.MouseEvent) => void
  className?: string
  children: React.ReactNode
  'data-testid'?: string
}) {
  const cls = className
    ? `${aiSignalBadgeClass(variant)} ${className}`
    : aiSignalBadgeClass(variant)
  const inner = (
    <>
      {/* ✨ 아이콘은 장식(aria-hidden) — AI 판단 신호임은 sr-only 텍스트로 스크린리더에 전달.
          (action 배지처럼 children 에 "AI"가 없는 경우에도 SR 사용자가 AI 표식을 인지) */}
      <span className="sr-only">AI </span>
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      {children}
    </>
  )
  if (onClick) {
    return (
      <button type="button" data-testid={testId} title={reason} onClick={onClick} className={`${cls} hover:opacity-90`}>
        {inner}
      </button>
    )
  }
  return (
    <span data-testid={testId} title={reason} className={cls}>
      {inner}
    </span>
  )
}
