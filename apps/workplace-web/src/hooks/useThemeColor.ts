// 열려 있는 동안 브라우저 크롬 색(meta theme-color)을 덮어쓰고, 닫히면 원래 값으로 돌린다.
// 왜: 모바일 몰입형 뷰어(WP-278)는 검정 화면인데 상태바가 앱 색(보라)으로 남으면 위쪽 띠가 떠 보인다(스펙 §4.2).
import { useEffect } from 'react'

/** active 인 동안 모든 theme-color 메타를 color 로 바꾸고, 꺼지거나 언마운트되면 각자의 원래 값으로 복원한다. */
export function useThemeColor(color: string, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    const prev = metas.map((m) => m.content)
    for (const m of metas) m.content = color
    return () => metas.forEach((m, k) => (m.content = prev[k]))
  }, [color, active])
}
