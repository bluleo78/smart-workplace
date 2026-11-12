// 굵은 글자(화면 문구) 호버 강조의 수명 관리 훅(WP-1511) — 도움말 본문(HighlightStrong)과 AI 답(ScreenPhrase)이 함께 쓴다.
// 같은 이름의 화면 컨트롤에 강조 표식을 달고, 올린 채 글이 사라지거나 마우스가 떠나면 거두는 release ref·정리 effect 를 한 곳에 둔다.
import { useCallback, useEffect, useRef } from 'react'

import { type ControlScanOptions, findScreenControls, highlightScreenControls } from './helpScreenControls'

/**
 * text 와 같은 이름의 화면 컨트롤을 강조하는 enter 와, 강조를 거두는 stop 을 돌려준다.
 * enter 는 먼저 이전 강조를 거두고 지금 화면에서 다시 찾아(화면은 언제든 바뀐다) 강조한 뒤 찾은 컨트롤을 돌려준다.
 * scan.excludeAiSurface 는 AI 답 쪽만 켠다(helpScreenControls). 호출 때 글자를 넘기면(그려진 글자 등) 그것을 쓴다. 언마운트하면 올린 채여도 강조를 거둔다.
 */
export function useScreenHighlight(text: string, scan: ControlScanOptions = {}): { enter: (override?: string) => HTMLElement[]; stop: () => void } {
  const { excludeAiSurface } = scan
  const release = useRef<(() => void) | null>(null)
  const stop = useCallback(() => {
    release.current?.()
    release.current = null
  }, [])
  const enter = useCallback(
    (override?: string) => {
      stop()
      const found = findScreenControls(override ?? text, { excludeAiSurface })
      release.current = highlightScreenControls(found)
      return found
    },
    [stop, text, excludeAiSurface],
  )
  // 올린 채 사라져도(절 이동·답이 바뀜) 강조를 거둔다.
  useEffect(() => stop, [stop])
  return { enter, stop }
}
