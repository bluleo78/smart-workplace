import { expect, type Locator, type Page } from '@playwright/test'

export type Theme = 'light' | 'dark'

/** next-themes 저장키('theme')를 로드 전에 심어 해당 테마로 렌더한다 — page.goto 전에 호출. */
export async function withTheme(page: Page, theme: Theme) {
  await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme)
}

/** 테마가 실제로 적용됐는지(라이트 = html 에 dark 클래스 없음) — 대비를 재기 전에 확인한다. */
export async function expectTheme(page: Page, theme: Theme) {
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
}

/**
 * 요소 글자색과 "실제로 그 아래 깔린" 배경색 사이의 WCAG 대비비를 브라우저에서 계산한다(WP-303).
 *
 * 왜 브라우저에서 재는가: 색 토큰이 oklch()·color-mix(반투명 bg-x/10) 라 계산값 문자열을 직접 파싱하기 어렵다.
 * 캔버스 fillStyle 에 계산값을 그대로 넣어 sRGB 픽셀로 바꾸면 브라우저가 해석한 색 그대로 얻는다.
 * 배경은 요소부터 조상으로 올라가며 불투명 배경을 만날 때까지 반투명 배경을 겹쳐(알파 합성) 구한다.
 * 한계: background-image(그라데이션) 는 무시한다 — 배지 대비 검증 용도로는 단색 배경만 대상이다.
 */
export async function textContrast(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    // CSS 색 문자열 → [r,g,b(0~255), a(0~1)]
    const toRgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2], d[3] / 255]
    }
    // fg(알파 포함)를 불투명 bg 위에 합성
    const over = (fg: number[], bg: number[]) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]))

    // 조상 배경 수집 — 불투명 배경을 만나면 멈춘다. 끝까지 없으면 흰 캔버스로 본다.
    const layers: number[][] = []
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = toRgba(getComputedStyle(n).backgroundColor)
      if (c[3] === 0) continue
      layers.push(c)
      if (c[3] === 1) break
    }
    let bg = [255, 255, 255]
    for (const layer of layers.reverse()) bg = over(layer, bg)
    const fg = over(toRgba(getComputedStyle(el).color), bg)

    // WCAG 2.x 상대 휘도·대비비
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a)
    return (hi + 0.05) / (lo + 0.05)
  })
}
