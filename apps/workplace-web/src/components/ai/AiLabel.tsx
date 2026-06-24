import { Sparkles } from 'lucide-react'

import { AI_LABEL_CLASS } from './aiMarker'

// AI 마커의 최소 단위 — ✨ + 텍스트. AiContent 헤더와 인라인 캡션에서 공용.
export function AiLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={className ? `${AI_LABEL_CLASS} ${className}` : AI_LABEL_CLASS}>
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      {children}
    </span>
  )
}
