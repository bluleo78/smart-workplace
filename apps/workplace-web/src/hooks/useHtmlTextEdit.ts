// HTML 「글자 고치기」 부모 쪽 훅(WP-1309) — iframe 안 글자 고치기 스크립트(lib/htmlTextEdit)와 메시지를 주고받아 고친 것을 모으고,
// 붙여넣기를 정리기로 걸러 돌려준다. HTML 문서 페이지의 「편집」과 노트 HTML 블록의 「글자 고치기」가 함께 쓴다.
// 모은 것을 원본에 되돌리는 일(prepareHtmlTextEdit 의 apply)은 부르는 화면이 한다 — 기준 원본(편집 화면을 띄운 소스)을 그 화면이 쥐고 있다.
import { useCallback, useRef } from 'react'

import { HTML_TEXT_EDIT_MESSAGE, type HtmlTextEditCommand, type HtmlTextEditEvent, htmlTextEditEventFromMessage } from '@/lib/htmlTextEdit'
import { type HtmlTextEdit, plainTextToHtml, sanitizeEditedHtml } from '@/lib/htmlTextEditSource'

import { useFrameChannel } from './useFrameChannel'

/** flush 가 iframe 의 답을 기다리는 최대 시간(ms) — iframe 이 없어졌거나 멈춰도 「저장」이 묶이지 않게. 그때는 지금까지 받은 것으로 간다. */
export const HTML_TEXT_EDIT_FLUSH_TIMEOUT_MS = 500

export interface HtmlTextEditor {
  /** srcdoc 에 넣을 토큰(htmlTextEditScript 인자) — 화면에 붙어 있는 동안 그대로다. */
  token: string
  /** iframe 창이 붙으면 부른다 — 돌려준 함수로 뗀다. */
  attach: (frameWindow: Window) => () => void
  /** 고르기 중엔 멈춘다 — 점선·편집을 끄고 클릭을 고르기에 넘긴다. */
  setPaused: (paused: boolean) => void
  /** iframe 에 남은 입력(쉬기 전 300ms)을 받아 지금까지 고친 것 전부(ref 별 최신, 처음 받은 순서)를 돌려준다 — 「저장」·「소스」 전환 전에 부른다. */
  flush: () => Promise<HtmlTextEdit[]>
  /** 모은 것을 비운다 — 기준 원본이 바뀌어 편집 화면을 다시 띄울 때. */
  reset: () => void
}

/**
 * 글자 고치기 상태를 iframe 에서 부모로 비춘다 — 원본은 iframe 이다(고친 요소가 거기 있다). iframe 은 지난번 뒤 바뀐 요소만 보내므로 ref 별로 합친다(덮어 쓴다).
 * - onChange: 고친 것을 받을 때마다(입력이 쉬면) 모은 전부를 넘긴다 — 화면은 원본에 되돌려 임시 저장·동기화로 보낸다.
 *   새로 받은 것이 없으면 같은 항목 객체가 그대로 가므로 받는 쪽(prepareHtmlTextEdit 의 apply)이 다시 직렬화하지 않는다.
 * - 붙여넣기: 클립보드 HTML(없으면 글자)을 정리기로 걸러 iframe 에 넣으라고 돌려준다 — 정리는 부모만 한다(iframe 안 스크립트를 믿지 않는다).
 * - 문서가 새로 뜨면(ready) 멈춤 상태를 다시 보낸다. 받은 것은 그대로 둔다 — 같은 기준 원본에서 고친 것이고 새 문단 id 는 문서마다 달라 겹치지 않는다.
 */
export function useHtmlTextEdit({ onChange }: { onChange?: (edits: HtmlTextEdit[]) => void } = {}): HtmlTextEditor {
  const editsRef = useRef(new Map<string, HtmlTextEdit>())
  const pausedRef = useRef(false)
  const waitersRef = useRef<Array<() => void>>([])
  // 모은 것 전부 — ref 별 최신, 처음 받은 순서(새 문단이 앞 문단 뒤에 오게).
  const edits = useCallback(() => Array.from(editsRef.current.values()), [])

  const { token, send, attach, connected } = useFrameChannel<HtmlTextEditCommand, HtmlTextEditEvent>(
    HTML_TEXT_EDIT_MESSAGE,
    htmlTextEditEventFromMessage,
    (msg, reply) => {
      if (msg.event === 'ready') {
        if (pausedRef.current) reply({ cmd: 'pause' })
      } else if (msg.event === 'paste') {
        const html = msg.html ? sanitizeEditedHtml(msg.html) : plainTextToHtml(msg.text)
        if (html) reply({ cmd: 'insert', html })
      } else {
        for (const item of msg.items) editsRef.current.set(item.ref, item)
        const waiters = waitersRef.current
        waitersRef.current = []
        waiters.forEach((resolve) => resolve())
        onChange?.(edits())
      }
    },
  )

  const setPaused = useCallback(
    (paused: boolean) => {
      pausedRef.current = paused
      send({ cmd: paused ? 'pause' : 'resume' })
    },
    [send],
  )

  const flush = useCallback(() => {
    if (!connected()) return Promise.resolve(edits())
    return new Promise<HtmlTextEdit[]>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve(edits())
      }
      waitersRef.current.push(finish)
      setTimeout(finish, HTML_TEXT_EDIT_FLUSH_TIMEOUT_MS)
      send({ cmd: 'flush' })
    })
  }, [connected, edits, send])

  const reset = useCallback(() => {
    editsRef.current = new Map()
  }, [])

  return { token, attach, setPaused, flush, reset }
}
