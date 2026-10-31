// 메시지 링크로 들어왔을 때(?message, WP-1236) 다음에 할 일을 정한다 — React·DOM 비의존 순수 함수(vitest node 로 검증).
// 대화 목록은 최신 50개씩 페이지로 받으므로, 오래된 메시지는 앞 페이지를 더 받아 올 때까지 거슬러 올라간다.
import { appUrl, chatMessagePath } from '@/lib/appUrl'
import type { ShareTarget } from '@/lib/shareTarget'

/** 대화 목록 DOM id 접두 — 메시지 행 id(`message-anchor-<id>`)로 진입 앵커(useStickToBottom)가 찾는다. */
export function messageDomId(messageId: number): string {
  return `message-anchor-${messageId}`
}

/** 메시지를 찾으러 거슬러 올라갈 최대 페이지 수(50개씩 — 1000개). 넘으면 찾을 수 없다고 알린다. */
export const MAX_JUMP_PAGES = 20

export type MessageJumpStep = 'scroll' | 'fetch-older' | 'wait' | 'missing'

/**
 * @param found 찾는 행이 지금 화면(DOM)에 있는가 — 보통 링크의 메시지, 스레드 답글 링크인데 스레드 칸이 아직 없으면 루트 메시지
 * @param waitForThread 스레드 칸이 답글을 받는 중이라 기다리면 된다 — 본 목록을 거슬러 올라가지 않는다(useMessageLinkJump 가 칸 안을 다시 본다)
 */
export function messageJumpStep(s: {
  found: boolean
  waitForThread: boolean
  loaded: boolean
  hasOlder: boolean
  fetching: boolean
  pages: number
}): MessageJumpStep {
  if (s.found) return 'scroll'
  if (s.waitForThread || !s.loaded || s.fetching) return 'wait'
  if (s.hasOlder && s.pages < MAX_JUMP_PAGES) return 'fetch-older'
  return 'missing'
}

/**
 * 메시지의 링크 대상(ShareTarget) — 데스크톱 ⋯·우클릭·터치 시트·⇧⌘, 가 같은 주소·이름을 쓴다.
 * 이름은 본문 앞부분(보내기 대화상자·「다른 앱으로 보내기」 제목) — 본문이 없으면(첨부만) 「메시지」.
 */
export function messageShareTarget(
  conversation: { channelId: number; dm: boolean },
  m: { id: number; parentMessageId: number | null; plainText: string },
): ShareTarget {
  const text = m.plainText.replace(/\s+/g, ' ').trim()
  return {
    kind: 'message',
    url: appUrl(chatMessagePath({ ...conversation, messageId: m.id, threadRootId: m.parentMessageId })),
    title: text ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : '메시지',
  }
}
