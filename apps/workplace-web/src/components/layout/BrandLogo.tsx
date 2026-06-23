// src/components/layout/BrandLogo.tsx
// 브랜드 로고 락업 — 마크 + 2줄 워드마크(SMART / Workplace).
// 워드마크는 모바일 드로어에선 항상, 데스크톱(lg)에선 expanded 일 때만 노출
// (RailLink 라벨과 동일한 'expanded ? "" : "lg:hidden"' 패턴).
import { cn } from '@/lib/utils'

import { BrandMark } from './BrandMark'

export function BrandLogo({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <BrandMark />
      <span className={cn('flex min-w-0 flex-col leading-none', expanded ? '' : 'lg:hidden')}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Smart
        </span>
        <span className="text-sm font-bold tracking-tight text-foreground">Workplace</span>
      </span>
    </span>
  )
}
