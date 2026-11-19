import { Star } from 'lucide-react'

import { useIsWikiPageStarred, useToggleWikiStar } from '@/hooks/queries/useWikiStars'
import { ROW_ICON_BUTTON } from '@/lib/driveRecent'
import { cn } from '@/lib/utils'

import { Button } from '../ui/button'

/**
 * 노트 즐겨찾기 별 단추(WP-1765) — 눌림 상태(aria-pressed)로 즐겨찾기 여부를 알리고, 누르면 바로 바꾼다(낙관적 갱신, 실패 시 되돌림).
 * 즐겨찾기하면 별을 채운다(드라이브 ViewerStarButton 과 같은 모양). 터치에서는 다른 머리줄 단추처럼 44px.
 * variant="row" 는 목록 행용 — 크기를 키우지 않고 드라이브 행 단추(ROW_ICON_BUTTON)처럼 누름 영역만 넓혀 좁은 칸을 넘치지 않게 한다.
 * 머리줄·최근 행처럼 페이지 id 만 알면 어디든 둘 수 있게 상태를 스스로 읽는다.
 */
export function WikiStarButton({ pageId, className, variant = 'header' }: { pageId: number; className?: string; variant?: 'header' | 'row' }) {
  const starred = useIsWikiPageStarred(pageId)
  const { toggle } = useToggleWikiStar()
  const label = starred ? '즐겨찾기 빼기' : '즐겨찾기'
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(variant === 'row' ? ROW_ICON_BUTTON : 'pointer-coarse:size-11', className)}
      aria-label={label}
      aria-pressed={starred}
      title={label}
      data-testid="wiki-star-button"
      onClick={() => toggle(pageId, !starred)}
    >
      <Star className={cn(starred && 'fill-current text-primary')} />
    </Button>
  )
}
