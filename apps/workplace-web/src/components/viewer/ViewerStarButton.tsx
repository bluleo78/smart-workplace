import { Star } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

/** 보기 창 별표 상태(WP-1698) — 지금 항목이 별표됐는지와 바꾸는 함수. 호출부(드라이브 화면·「별표」 목록)가 항목마다 만든다. */
export interface ViewerStar {
  starred: boolean
  onToggle: () => void
}

/**
 * 보기 창 머리줄 별표 단추(WP-1698) — 눌림 상태(aria-pressed)로 별표 여부를 알린다. 이름은 늘 「별표」(토글 단추 규칙 — 상태는
 * aria-pressed 가 말한다), 별표하면 별을 채운다. 터치에서는 다른 머리줄 단추처럼 44px.
 */
export function ViewerStarButton({ star, className }: { star: ViewerStar; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('pointer-coarse:size-11', className)}
      aria-label="별표"
      aria-pressed={star.starred}
      title={star.starred ? '별표 빼기' : '별표'}
      data-testid="viewer-star"
      onClick={star.onToggle}
    >
      <Star className={cn(star.starred && 'fill-current text-primary')} />
    </Button>
  )
}
