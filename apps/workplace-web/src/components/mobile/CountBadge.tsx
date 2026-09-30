// 모바일 안읽음 배지 — 탭바 탭·헤더 벨이 공유하는 빨간 원형 숫자 배지(모양·'99+' 규칙 단일화).
// 위치(absolute 좌표)는 붙는 곳마다 달라 className 으로 받는다.
import { formatBadgeCount } from '@/lib/mobile/badge'
import { cn } from '@/lib/utils'

export function CountBadge({ count, className, 'data-testid': testId }: { count: number; className?: string; 'data-testid'?: string }) {
  if (count <= 0) return null
  return (
    <span data-testid={testId} className={cn('absolute min-w-4 rounded-full bg-destructive px-1 text-[9px] leading-4 text-white', className)}>
      {formatBadgeCount(count)}
    </span>
  )
}
