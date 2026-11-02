// 격리 iframe 과 토큰 실은 메시지를 주고받는 부모 쪽 통로(WP-1309) — 요소 고르기(useHtmlPicker)와 글자 고치기(useHtmlTextEdit)가 함께 쓴다.
// 토큰 만들기·창 붙이기/떼기·명령 보내기를 한곳에 두고, 받은 메시지의 꼴 가리기(parse)와 처리(onEvent)만 부르는 훅이 정한다.
import { useCallback, useEffect, useRef, useState } from 'react'

import { postFrameMessage, watchFrameMessages } from '@/lib/frameMessages'

/** 받은 message 를 이 창·이 토큰의 메시지로 가린다 — 맞으면 꼴을 맞춘 값, 아니면 null(htmlPickerEventFromMessage 등). 모듈 함수처럼 바뀌지 않는 것을 넘긴다. */
export type FrameMessageParser<E> = (event: Pick<MessageEvent, 'source' | 'data'>, frameWindow: Window, token: string) => E | null

export interface FrameChannel<C extends object> {
  /** srcdoc 스크립트에 넣을 토큰 — 화면에 붙어 있는 동안 그대로다. */
  token: string
  /** 붙은 iframe 에 명령을 보낸다(붙은 창이 없으면 버린다). */
  send: (command: C) => void
  /** iframe 창이 붙으면 부른다 — 돌려준 함수로 뗀다(iframe 콜백 ref 의 정리 함수로 쓴다). */
  attach: (frameWindow: Window) => () => void
  /** 지금 붙은 창이 있나 — 기다릴 답이 올 수 있는지 볼 때(flush). */
  connected: () => boolean
}

/**
 * 메시지 처리기는 창에 붙일 때 한 번 만들고, 처리(onEvent)는 ref 로 최신 것을 부른다 — 상태·콜백이 바뀔 때마다 다시 붙이지 않게.
 * onEvent 는 답할 send 를 함께 받는다(부르는 훅이 아직 선언하지 않은 send 를 처리기 안에서 쓰지 않게).
 * 보낸 창·종류·토큰 확인은 parse 가 한다(lib/frameMessages 의 frameMessageData).
 */
export function useFrameChannel<C extends object, E>(
  type: string,
  parse: FrameMessageParser<E>,
  onEvent: (event: E, send: (command: C) => void) => void,
): FrameChannel<C> {
  const [token] = useState(() => crypto.randomUUID())
  const frameRef = useRef<Window | null>(null)
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  const send = useCallback(
    (command: C) => {
      if (frameRef.current) postFrameMessage(frameRef.current, type, token, command)
    },
    [type, token],
  )

  const attach = useCallback(
    (frameWindow: Window) => {
      frameRef.current = frameWindow
      const unwatch = watchFrameMessages(frameWindow, (event) => {
        const msg = parse(event, frameWindow, token)
        if (msg) onEventRef.current(msg, send)
      })
      return () => {
        unwatch()
        if (frameRef.current === frameWindow) frameRef.current = null
      }
    },
    [parse, token, send],
  )

  const connected = useCallback(() => frameRef.current != null, [])
  return { token, send, attach, connected }
}
