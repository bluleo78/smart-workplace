// 데스크톱 ⋯ 메뉴의 링크 항목(WP-1234·WP-1235) — 「키 복사 ⌘.」(이슈만)·「채팅·이슈로 보내기…」(늘)·「브라우저에서 열기」(설치된 앱일 때만).
// 일반 브라우저에는 이미 주소창이 있어 「브라우저에서 열기」는 뜻이 없으므로 standalone 일 때만 둔다.
import { ExternalLink, Hash, MessageSquareShare } from 'lucide-react'

import { DropdownMenuItem, DropdownMenuShortcut } from '@/components/overlay/dropdown-menu'
import { openSendToChat } from '@/lib/sendToChat'
import { shareShortcutLabels, type ShareTarget } from '@/lib/shareTarget'

import { copyShareKey, linkMenuFlags, openInBrowser } from './shareActions'

export function LinkMenuItems({ target, itemClassName }: { target: ShareTarget; itemClassName?: string }) {
  // 대상마다 달라지는 보임 규칙은 linkMenuFlags 한 곳에서 정한다.
  const { showKey, showBrowser } = linkMenuFlags(target)
  return (
    <>
      {showKey && (
        <DropdownMenuItem className={itemClassName} data-testid="menu-copy-key" onSelect={() => void copyShareKey(target)}>
          <Hash aria-hidden="true" /> 키 복사
          <DropdownMenuShortcut>{shareShortcutLabels().key}</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      {/* 대화상자는 메뉴가 닫힌 다음 틱에 열린다(openSendToChat 이 미룬다) — 같은 틱에 열면 메뉴가 트리거로 돌려주는 초점과 부딪친다. */}
      <DropdownMenuItem className={itemClassName} data-testid="menu-send-to-chat" onSelect={() => openSendToChat(target)}>
        <MessageSquareShare aria-hidden="true" /> 채팅·이슈로 보내기…
      </DropdownMenuItem>
      {showBrowser && (
        <DropdownMenuItem className={itemClassName} data-testid="menu-open-in-browser" onSelect={() => openInBrowser(target)}>
          <ExternalLink aria-hidden="true" /> 브라우저에서 열기
        </DropdownMenuItem>
      )}
    </>
  )
}
