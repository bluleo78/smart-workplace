import { useMemo, useSyncExternalStore } from 'react'

import { applyMailDarkMode } from '@/lib/mailDarkMode'

/**
 * <html> 의 class 변화(next-themes 가 .dark 를 붙이고 뗌)를 구독한다.
 * next-themes 의 resolvedTheme 은 class 적용 effect 보다 먼저 렌더에 반영돼, 그 시점에 CSS 토큰을 읽으면
 * 이전 테마 값이 나온다 — 실제 class 변경을 관찰해 토큰 계산값과 항상 일치시킨다.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** 렌더마다 불리므로 class 확인만 한다 — 토큰 계산값(getComputedStyle)은 다크 전환 시 useMemo 에서 한 번 읽는다 */
function isDarkClass(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * WP-103 다크 테마일 때 HTML 메일 본문을 어두운 배경으로 변환한다. 라이트 테마거나 변환 대상이 아니면 입력을 그대로 돌려준다.
 * cid 인라인 이미지 치환(useInlineMailHtml) **이전**의 원문을 넘긴다 — 치환 후엔 base64 이미지로 수 MB 가 돼 파싱 비용이 커진다.
 */
export function useMailDarkHtml(html: string | null): string | null {
  const dark = useSyncExternalStore(subscribe, isDarkClass)
  return useMemo(() => {
    if (!html || !dark) return html
    const css = getComputedStyle(document.documentElement)
    const token = (name: string) => css.getPropertyValue(name).trim()
    return applyMailDarkMode(html, {
      background: token('--background'),
      foreground: token('--foreground'),
      link: token('--primary'),
    })
  }, [html, dark])
}
