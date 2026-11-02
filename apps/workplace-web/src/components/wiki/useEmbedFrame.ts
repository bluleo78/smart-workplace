// 노트 HTML 블록 iframe 공용 훅(WP-1242·WP-1302) — 블록 미리보기와 「AI로 고치기」 비교 미리보기가 같은 문서·높이 맞추기를 쓴다.
import { useCallback, useMemo, useRef, useState } from 'react'

import { HTML_EMBED_DEFAULT_HEIGHT, HTML_EMBED_HEIGHT_SCRIPT, htmlEmbedDocument, watchEmbedHeight } from './wikiHtmlEmbedFrame'

export interface EmbedFrameOptions {
  /** 문서 끝에 더 붙일 스크립트(블록의 고르기 스크립트 등) — 없으면 높이 보고 스크립트만. */
  extraScript?: string
  /** iframe 창이 붙을 때 함께 등록할 것(고르기 등) — 돌려준 함수로 떨어질 때 해제한다. 정체가 바뀌면 다시 붙는다. */
  onAttach?: (frameWindow: Window) => () => void
}

/**
 * 블록 소스로 iframe 문서(htmlEmbedDocument + extraScript)를 만들고, 붙은 iframe 창의 높이 보고를 받아 높이를 돌려준다.
 * - doc 은 소스·스크립트가 바뀔 때만 새로 만든다(SandboxedHtmlFrame 이 문자열로 비교해 iframe 을 다시 만든다).
 * - frameRef 는 React 19 콜백 ref 정리 함수로, 문서가 바뀌어 새 iframe 이 붙거나 블록이 내려가면 등록을 푼다.
 * - ownScript 는 문서 뒤에 붙인 우리 스크립트만(높이 보고 + extraScript) — doc 대신 source + ownScript 로 나눠 넘길 때 쓴다.
 * - frameEl 은 지금 붙은 iframe 요소 — 포커스가 이 iframe 으로 넘어갔는지 보는 쪽(블록 클릭 선택)이 읽는다.
 */
export function useEmbedFrame(source: string, { extraScript = '', onAttach }: EmbedFrameOptions = {}) {
  const doc = useMemo(() => htmlEmbedDocument(source) + extraScript, [source, extraScript])
  // 우리 스크립트만 따로(WP-1290 × WP-1309) — 「우리 스크립트만」 iframe(SandboxedHtmlFrame ownScript)에는 소스와 나눠 넘겨 nonce 를 단다.
  const ownScript = useMemo(() => HTML_EMBED_HEIGHT_SCRIPT + extraScript, [extraScript])
  const [height, setHeight] = useState(HTML_EMBED_DEFAULT_HEIGHT)
  const frameEl = useRef<HTMLIFrameElement | null>(null)
  const frameRef = useCallback(
    (el: HTMLIFrameElement | null) => {
      frameEl.current = el
      const win = el?.contentWindow
      if (!win) return undefined
      const detach = onAttach?.(win)
      const unwatch = watchEmbedHeight(win, setHeight)
      return () => {
        unwatch()
        detach?.()
      }
    },
    [onAttach],
  )
  return { doc, ownScript, height, frameRef, frameEl }
}
