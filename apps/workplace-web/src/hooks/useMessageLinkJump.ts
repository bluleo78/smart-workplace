// 메시지 링크 열기(WP-1236) — 채널·DM 주소의 ?message 를 읽어 그 메시지까지 거슬러 올라가 가운데로 보이고 잠깐 강조한다.
// 처음 들어올 때의 스크롤은 진입 앵커(useStickToBottom 의 initialAnchor = messageDomId)가 맡고, 같은 대화 안에서 다른 메시지 링크를
// 누른 경우(화면이 다시 마운트되지 않는다)는 여기서 직접 스크롤한다. 한 번 처리하면 ?message 를 지워 새로고침에 다시 뛰지 않게 한다.
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import type { EntryAnchor } from '@/lib/chatEntryAnchor'
import { parseId } from '@/lib/historyParam'
import { messageDomId, messageJumpStep } from '@/lib/messageLinkJump'

/** 강조를 남겨 두는 시간(ms) — 눈이 찾아갈 만큼만. */
const HIGHLIGHT_MS = 2500
/** 스레드 답글을 기다리는 최대 시간(ms) — 스레드 칸이 답글을 받는 동안. 넘으면 찾을 수 없다고 알린다. */
const THREAD_WAIT_MS = 8000
/** 스레드 칸 안을 다시 보는 간격(ms). */
const THREAD_POLL_MS = 250

interface OlderPages {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
  pages: number
  loaded: boolean
}

/** 지금 링크가 가리키는 메시지 id(?message)와 스레드 루트(?thread). */
function useMessageLinkTarget(): { messageId: number | null; threadRootId: number | null } {
  const [params] = useSearchParams()
  return { messageId: parseId(params.get('message')), threadRootId: parseId(params.get('thread')) }
}

/** 대화 메시지 목록(무한 조회)에서 링크 찾아가기에 쓰는 것만. */
interface ConversationMessages {
  data?: { pages: { items: unknown[] }[] }
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
}

/**
 * 채널·DM 화면의 메시지 링크(?message) — 그 메시지까지 거슬러 올라가 가운데로 보이고 강조한다. 스레드 답글이 아니면 처음 들어올 때의
 * 진입 앵커도 그 메시지라 돌려준다(없으면 undefined — 화면이 평소 진입 앵커를 쓴다).
 */
export function useConversationLinkJump(query: ConversationMessages): EntryAnchor | undefined {
  const pages = query.data?.pages
  useMessageLinkJump(
    {
      hasNextPage: query.hasNextPage,
      isFetchingNextPage: query.isFetchingNextPage,
      fetchNextPage: query.fetchNextPage,
      pages: pages?.length ?? 0,
      loaded: pages !== undefined,
    },
    pages?.reduce((n, p) => n + p.items.length, 0) ?? 0,
  )
  const { messageId, threadRootId } = useMessageLinkTarget()
  return messageId != null && threadRootId == null ? { id: messageDomId(messageId), align: 'center' } : undefined
}

/** 스레드 칸(열려 있으면)과 그 안의 답글 행. */
function findInThreadPanel(messageId: number): { panel: Element | null; row: HTMLElement | null } {
  const panel = document.querySelector('[data-testid="thread-panel"]')
  return { panel, row: panel?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`) ?? null }
}

/** 본 대화 목록(스레드 칸 밖)의 행 — 스레드 칸에도 루트가 같은 id 로 있을 수 있어 칸 안은 뺀다. */
function findInMainList(messageId: number): HTMLElement | null {
  const rows = document.querySelectorAll<HTMLElement>(`[data-message-id="${messageId}"]`)
  return Array.from(rows).find((r) => !r.closest('[data-testid="thread-panel"]')) ?? null
}

function highlight(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center' })
  el.dataset.linkHighlight = 'true'
  window.setTimeout(() => delete el.dataset.linkHighlight, HIGHLIGHT_MS)
}

const NOT_FOUND = '메시지를 찾을 수 없어요 — 지워졌거나 너무 오래된 메시지예요'

function useMessageLinkJump(older: OlderPages, renderKey: unknown): void {
  const [, setParams] = useSearchParams()
  const { messageId, threadRootId } = useMessageLinkTarget()
  const { hasNextPage, isFetchingNextPage, fetchNextPage, pages, loaded } = older
  // 같은 링크를 두 번 처리하지 않는다(?message 를 지우기 전 다시 그려질 때). ?message 가 지워지면 비워, 같은 링크를 다시 열면 또 간다.
  const handled = useRef<number | null>(null)

  useEffect(() => {
    if (messageId == null) {
      handled.current = null
      return
    }
    if (handled.current === messageId) return
    const finish = () => {
      handled.current = messageId
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('message')
          return next
        },
        { replace: true, preventScrollReset: true },
      )
    }
    // 스레드 답글 — 스레드 칸이 열려 있으면 칸 안에서 찾고(답글은 칸이 따로 받는다), 칸이 아직 없으면 본 목록에서 루트를 찾는다.
    // 루트가 첫 페이지보다 오래돼 칸이 열리지 않은 경우도 앞 페이지를 받아 루트를 찾으면 칸이 열린다(useOpenThread).
    const inThread = threadRootId != null
    const thread = inThread ? findInThreadPanel(messageId) : null
    const waitForThread = !!thread?.panel || (inThread && findInMainList(threadRootId) != null)
    const el = inThread ? (thread?.row ?? null) : findInMainList(messageId)
    const step = messageJumpStep({
      found: !!el,
      waitForThread,
      loaded,
      hasOlder: hasNextPage,
      fetching: isFetchingNextPage,
      pages,
    })
    if (step === 'scroll' && el) {
      highlight(el)
      finish()
      return
    }
    if (step === 'fetch-older') {
      void fetchNextPage()
      return
    }
    if (step === 'missing') {
      toast.error(NOT_FOUND)
      finish()
      return
    }
    if (waitForThread) {
      // 답글은 스레드 칸이 따로 받아 이 화면이 다시 그려지지 않을 수 있다 — 칸 안을 잠깐씩 다시 본다. 끝내 없으면(지운 답글) 알린다.
      const started = Date.now()
      const timer = window.setInterval(() => {
        const row = findInThreadPanel(messageId).row
        if (row) {
          window.clearInterval(timer)
          highlight(row)
          finish()
        } else if (Date.now() - started >= THREAD_WAIT_MS) {
          window.clearInterval(timer)
          toast.error(NOT_FOUND)
          finish()
        }
      }, THREAD_POLL_MS)
      return () => window.clearInterval(timer)
    }
  }, [messageId, threadRootId, loaded, hasNextPage, isFetchingNextPage, fetchNextPage, pages, renderKey, setParams])
}
