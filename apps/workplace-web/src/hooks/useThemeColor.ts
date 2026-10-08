// 열려 있는 동안 브라우저 크롬 색(meta theme-color)을 덮어쓰고, 닫히면 원래 값으로 돌린다.
// 왜: 모바일 몰입형 뷰어(WP-278)는 어두운 화면인데 상태바가 앱 색(보라)으로 남으면 위쪽 띠가 떠 보인다(스펙 §4.2).
import { useEffect } from 'react'

/**
 * 요소의 실제 배경색을 theme-color 에 넣을 rgb() 문자열로 — 색을 리터럴로 박지 않고 토큰(bg-background)에서 가져오려고.
 * 왜 캔버스로 한 번 칠해 읽나: 토큰이 oklch 라 getComputedStyle 이 "oklch(...)" 를 돌려주는데,
 * theme-color 는 브라우저마다 지원하는 색 문법이 달라(구형 iOS Safari 등) 가장 넓게 통하는 rgb 로 바꿔 넣는다.
 * 캔버스가 없는 환경(jsdom 등)이나 배경이 비어 있으면 계산값을 그대로(비어 있으면 null).
 */
export function elementBackgroundRgb(el: Element): string | null {
  const css = getComputedStyle(el).backgroundColor
  if (!css) return null
  try {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx) return css
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  } catch {
    return css
  }
}

/** active 이고 color 가 있는 동안 모든 theme-color 메타를 color 로 바꾸고, 꺼지거나 언마운트되면 각자의 원래 값으로 복원한다. */
export function useThemeColor(color: string | null, active: boolean): void {
  useEffect(() => {
    if (!active || !color) return
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    const prev = metas.map((m) => m.content)
    for (const m of metas) m.content = color
    return () => metas.forEach((m, k) => (m.content = prev[k]))
  }, [color, active])
}
