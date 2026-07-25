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
      {/* size-3(=h-3 w-3, 시각 동일) 로 표기 — Button 의 cva 가 `svg:not([class*='size-'])` 에만
          size-4 를 강제하므로, size- 접두 클래스를 쓰면 AiLabel 을 Button 안에 넣어도 아이콘 크기가
          덮이지 않는다(h-3 w-3 이면 두 규칙이 충돌해 결과가 스타일시트 순서에 좌우된다). */}
      <Sparkles className="size-3" aria-hidden="true" />
      {children}
    </span>
  )
}
