// HTML 요소 고르기 부모 쪽 훅(WP-1301) — iframe 안 고르기 스크립트(lib/htmlPicker)와 메시지를 주고받아 켜짐·고른 목록을 들고 있는다.
// 노트 HTML 블록과 HTML 문서 페이지(WP-1299 §6-3)가 함께 쓴다. 고른 목록(items)이 「AI로 고치기」(WP-1302)가 꺼내 쓰는 API 다.
import { useCallback, useEffect, useRef, useState } from 'react'

import { watchFrameMessages } from '@/lib/frameMessages'
import { type HtmlPickerCommand, htmlPickerEventFromMessage, type PickedElement, postHtmlPickerCommand } from '@/lib/htmlPicker'

export interface HtmlPicker {
  /** srcdoc 에 넣을 토큰(htmlPickerScript 인자) — 화면에 붙어 있는 동안 그대로다. */
  token: string
  /** 고르기가 켜져 있나(막대 단추 또는 iframe 안 ⌘/Ctrl+클릭). */
  enabled: boolean
  /** 고른 순서대로 — 칩 번호 = 순서 + 1. */
  items: PickedElement[]
  /** iframe 창이 붙으면 부른다 — 돌려준 함수로 뗀다(iframe 콜백 ref 의 정리 함수로 쓴다). */
  attach: (frameWindow: Window) => () => void
  setEnabled: (on: boolean) => void
  remove: (index: number) => void
  clear: () => void
  highlight: (index: number) => void
}

/**
 * iframe 안 고르기 상태를 부모에 비춘다 — 원본은 iframe 이다(고른 요소가 거기 있다). 부모는 명령만 보내고 「state」 메시지로 따라간다.
 * - 문서가 새로 뜨면(소스가 바뀌어 iframe 이 다시 그려짐) 「ready」 가 오고 고른 것은 사라진다 — 켜져 있었으면 다시 켜 보낸다.
 * - 보낸 창·토큰이 맞는 메시지만 받는다(htmlPickerEventFromMessage).
 * - iframe 안 Esc 는 한 단계씩(설계 §1): 고른 것 풀기는 iframe 이 스스로 하고, 고른 것 없이 누른 Esc 만 와서 고르기를 끈 뒤 onExit — 그다음(블록 선택 등)은 부르는 화면이 한다.
 */
export function useHtmlPicker({ onExit }: { onExit?: () => void } = {}): HtmlPicker {
  const [token] = useState(() => crypto.randomUUID())
  const [enabled, setEnabledState] = useState(false)
  const [items, setItems] = useState<PickedElement[]>([])
  const frameRef = useRef<Window | null>(null)
  // 메시지 처리기는 창에 붙일 때 한 번 만들고 최신 값은 ref 로 읽는다(켜짐·onExit 가 바뀔 때마다 다시 붙이지 않게).
  const enabledRef = useRef(enabled)
  const onExitRef = useRef(onExit)
  useEffect(() => {
    enabledRef.current = enabled
    onExitRef.current = onExit
  })

  const send = useCallback(
    (command: HtmlPickerCommand) => {
      if (frameRef.current) postHtmlPickerCommand(frameRef.current, token, command)
    },
    [token],
  )

  const setEnabled = useCallback(
    (on: boolean) => {
      // 화면은 바로 바꾸고 iframe 의 state 로 맞춘다 — 끄면 고른 것도 푼다.
      setEnabledState(on)
      if (!on) setItems([])
      send({ cmd: on ? 'enable' : 'disable' })
    },
    [send],
  )

  const attach = useCallback(
    (frameWindow: Window) => {
      frameRef.current = frameWindow
      const unwatch = watchFrameMessages(frameWindow, (event) => {
        const msg = htmlPickerEventFromMessage(event, frameWindow, token)
        if (!msg) return
        if (msg.event === 'ready') {
          setItems([])
          if (enabledRef.current) send({ cmd: 'enable' })
        } else if (msg.event === 'state') {
          setEnabledState(msg.enabled)
          setItems(msg.items)
        } else {
          setEnabled(false)
          onExitRef.current?.()
        }
      })
      return () => {
        unwatch()
        if (frameRef.current === frameWindow) frameRef.current = null
      }
    },
    [token, send, setEnabled],
  )

  return {
    token,
    enabled,
    items,
    attach,
    setEnabled,
    remove: useCallback((index: number) => send({ cmd: 'remove', index }), [send]),
    clear: useCallback(() => send({ cmd: 'clear' }), [send]),
    highlight: useCallback((index: number) => send({ cmd: 'highlight', index }), [send]),
  }
}
