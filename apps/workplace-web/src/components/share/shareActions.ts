// 링크 공유 동작(WP-1234) — 🔗 버튼·⋯ 항목·⬆︎ 시트·단축키가 같은 복사·토스트·보내기를 쓴다.
import { toast } from 'sonner'

import { copyToClipboard } from '@/lib/copyToClipboard'
import { isStandaloneDisplay } from '@/lib/platform'
import { openSendToChat } from '@/lib/sendToChat'
import type { ShareTarget } from '@/lib/shareTarget'

/**
 * 대상 링크를 복사하고 토스트로 알린다. 토스트의 「채팅으로 보내기」는 같은 링크를 앱 안 채널·DM·이슈 댓글로 보내는
 * 대화상자를 연다(WP-1235) — 복사한 뒤 붙여 넣을 곳이 앱 안이라면 한 번에 보내게.
 */
export function copyShareLink(target: ShareTarget): Promise<boolean> {
  return copyToClipboard(target.url, {
    success: '링크를 복사했어요',
    failure: '링크를 복사하지 못했어요',
    successAction: { label: '채팅으로 보내기', onClick: () => openSendToChat(target) },
  })
}

/** 이슈 키(WP-12)를 복사한다. 키가 없는 대상이면 아무것도 하지 않는다. */
export function copyShareKey(target: ShareTarget): Promise<boolean> {
  if (!target.key) return Promise.resolve(false)
  return copyToClipboard(target.key, { success: '키를 복사했어요', failure: '키를 복사하지 못했어요' })
}

/** 설치된 앱(standalone)에서 지금 화면을 브라우저 탭으로 연다 — 주소창이 필요한 일(북마크·다른 계정)을 위해. */
export function openInBrowser(target: ShareTarget): void {
  window.open(target.url, '_blank', 'noopener')
}

/** 이 브라우저에 시스템 공유(Web Share)가 있는가 — 없으면 「다른 앱으로 보내기」를 두지 않는다. */
export function canSendToOtherApp(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/**
 * 시스템 공유 시트로 링크를 보낸다. 사용자 활성화(클릭) 안에서 동기로 불러야 iOS 가 막지 않으므로 앞에 await·타이머를 두지 않는다.
 * 사용자가 취소하면(AbortError) 조용히 끝내고, 그 밖의 실패만 알린다.
 */
export function sendToOtherApp(target: ShareTarget): void {
  navigator.share({ title: target.title, url: target.url }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === 'AbortError') return
    toast.error('공유하지 못했어요')
  })
}

/**
 * 이 대상에 보일 데스크톱 ⋯ 링크 항목 중 대상마다 달라지는 것 — LinkMenuItems 가 쓴다.
 * 키 복사는 키가 있는 대상(이슈)만. 「채팅·이슈로 보내기…」는 모든 대상에 늘 있다(WP-1235) — 그래서 대상이 있는 화면의 ⋯ 에는
 * 링크 항목이 늘 하나 이상 있어, 예전의 「항목이 하나라도 있는가」(hasLinkMenuItems) 판정은 없앴다. 일반 브라우저에는 이미 주소창이 있어 「브라우저에서 열기」는 뜻이 없으므로 standalone 일 때만 둔다.
 */
export function linkMenuFlags(target: ShareTarget): { showKey: boolean; showBrowser: boolean } {
  return { showKey: !!target.key, showBrowser: isStandaloneDisplay() }
}
