// 줄(메시지·댓글·메일 행) 링크 메뉴(WP-1236) — 마우스 올림 ⋯ 와 우클릭이 같은 메뉴를 연다: 「링크 복사」 + 상세 ⋯ 의 링크 항목(LinkMenuItems).
// 상세 화면과 달리 줄에는 🔗 단추가 없어서 「링크 복사」를 메뉴 맨 위에 둔다.
import { Link2 } from 'lucide-react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import type { ShareTarget } from '@/lib/shareTarget'

import { LinkMenuItems } from './LinkMenuItems'
import type { RowLinkMenuAnchor } from './rowLinkMenuAnchor'
import { copyShareLink } from './shareActions'

/** 0 크기 고정 앵커에 붙는 링크 메뉴 — 연 동안만 그린다(닫으면 onClose 로 부른 쪽이 내린다). testId 는 메뉴 내용에 단다. */
export function RowLinkMenu({
  target,
  anchor,
  onClose,
  testId,
}: {
  target: ShareTarget
  anchor: RowLinkMenuAnchor
  onClose: () => void
  testId: string
}) {
  return (
    <DropdownMenu open onOpenChange={(o) => !o && onClose()} modal>
      <DropdownMenuTrigger asChild>
        {/* 0 크기 고정 앵커 — 우클릭 지점·⋯ 단추 모서리. 탭 순서·스크린리더에서 뺀다. */}
        <span
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed size-0"
          style={{ left: anchor.x, top: anchor.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={anchor.align}
        sideOffset={4}
        className="w-56"
        data-testid={testId}
        // 앵커가 보이지 않는 span 이라 닫힐 때 포커스를 되돌리지 않는다(줄로 튀어 스크롤되는 것 방지).
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem data-testid="menu-copy-link" onSelect={() => void copyShareLink(target)}>
          <Link2 aria-hidden="true" /> 링크 복사
        </DropdownMenuItem>
        <LinkMenuItems target={target} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
