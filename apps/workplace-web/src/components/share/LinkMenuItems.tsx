// 데스크톱 ⋯ 메뉴의 링크 항목(WP-1234) — 「키 복사 ⌘.」(이슈만)·「브라우저에서 열기」(설치된 앱일 때만).
// 일반 브라우저에는 이미 주소창이 있어 「브라우저에서 열기」는 뜻이 없으므로 standalone 일 때만 둔다.
import { ExternalLink, Hash } from 'lucide-react'

import { DropdownMenuItem, DropdownMenuShortcut } from '@/components/overlay/dropdown-menu'
import { shareShortcutLabels, type ShareTarget } from '@/lib/shareTarget'

import { copyShareKey, linkMenuFlags, openInBrowser } from './shareActions'

export function LinkMenuItems({ target, itemClassName }: { target: ShareTarget; itemClassName?: string }) {
  // 보임 규칙은 linkMenuFlags 한 곳에서 정한다 — hasLinkMenuItems 와 어긋나지 않게.
  const { showKey, showBrowser } = linkMenuFlags(target)
  return (
    <>
      {showKey && (
        <DropdownMenuItem className={itemClassName} data-testid="menu-copy-key" onSelect={() => void copyShareKey(target)}>
          <Hash aria-hidden="true" /> 키 복사
          <DropdownMenuShortcut>{shareShortcutLabels().key}</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      {showBrowser && (
        <DropdownMenuItem className={itemClassName} data-testid="menu-open-in-browser" onSelect={() => openInBrowser(target)}>
          <ExternalLink aria-hidden="true" /> 브라우저에서 열기
        </DropdownMenuItem>
      )}
    </>
  )
}
