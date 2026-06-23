// src/components/layout/BrandMark.tsx
// 제품 브랜드 마크 — primary 라운드 사각 + lucide Boxes(쌓인 모듈 = 모듈러 워크플레이스 은유).
// favicon.svg 와 시각 일치. 순수 표시용 — 클릭 동작은 감싸는 버튼이 담당.
import { Boxes } from 'lucide-react'

import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground',
        className,
      )}
    >
      {/* 장식 글리프 — 접근성 이름은 감싼 버튼/워드마크가 제공 */}
      <Boxes className="h-5 w-5" aria-hidden />
    </span>
  )
}
