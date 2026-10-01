// 테마 전환 — 현재 적용된 테마(resolvedTheme)의 반대로 바꾼다(시스템 테마 사용 중이어도 실제 보이는 테마 기준).
// 데스크톱 레일 유저 메뉴와 모바일 계정 시트가 공유한다.
import { useTheme } from 'next-themes'

export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return { dark, toggle: () => setTheme(dark ? 'light' : 'dark') }
}
