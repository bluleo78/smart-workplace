// 줄(메시지·댓글·메일 행) 링크 메뉴(WP-1236) — 마우스 올림 ⋯ 와 우클릭이 같은 메뉴를 연다: 「링크 복사」 + 상세 ⋯ 의 링크 항목(LinkMenuItems).
// 상세 화면과 달리 줄에는 🔗 단추가 없어서 「링크 복사」를 링크 묶음 맨 위에 둔다.
// 줄마다 고유 동작이 있으면(메일 행 답장·보관 등, WP-1730) children 으로 받아 링크 묶음 위에 두고 구분선으로 나눈다 — 우클릭 메뉴는 하나다.
import { Link2 } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { useMenuFocusReturn } from '@/components/overlay/useMenuFocusReturn'
import type { ShareTarget } from '@/lib/shareTarget'

import { LinkMenuItems } from './LinkMenuItems'
import type { RowLinkMenuAnchor } from './rowLinkMenuAnchor'
import { copyShareLink } from './shareActions'

/**
 * 0 크기 고정 앵커에 붙는 링크 메뉴 — 연 동안만 그린다(닫으면 onClose 로 부른 쪽이 내린다). testId 는 메뉴 내용에 단다.
 * children(줄 고유 동작 항목)이 있으면 링크 묶음 위에 두고 구분선을 넣는다.
 */
export function RowLinkMenu({
  target,
  anchor,
  onClose,
  testId,
  children,
}: {
  target: ShareTarget
  anchor: RowLinkMenuAnchor
  onClose: () => void
  testId: string
  children?: ReactNode
}) {
  // 연 동안만 마운트되므로 항상 열림. 닫힐 때 초점을 연 요소로 돌려준다(WP-1778).
  const focusReturn = useMenuFocusReturn(true, anchor.origin)
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
        // 앵커가 보이지 않는 span 이라 Radix 기본 복귀는 막고, 앵커 span 대신 메뉴를 연 요소로
        // 초점을 돌려준다 — 항목이 다른 곳으로 초점을 옮겼다면 건드리지 않는다(WP-1778).
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
      >
        {children && (
          <>
            {children}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem data-testid="menu-copy-link" onSelect={() => void copyShareLink(target)}>
          <Link2 aria-hidden="true" /> 링크 복사
        </DropdownMenuItem>
        <LinkMenuItems target={target} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
