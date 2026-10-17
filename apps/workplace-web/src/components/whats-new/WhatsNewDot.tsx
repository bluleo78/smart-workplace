// 「새 소식」 안 읽음 점 — 8px 원(bg-primary). 아바타 모서리나 메뉴 항목 옆에 놓는다(WP-439).
import { cn } from '@/lib/utils'

export function WhatsNewDot({ testId, className }: { testId: string; className?: string }) {
  // 스크린리더에는 항목 이름으로 충분하므로 장식 처리(aria-hidden).
  return <span aria-hidden data-testid={testId} className={cn('size-2 shrink-0 rounded-full bg-primary', className)} />
}
