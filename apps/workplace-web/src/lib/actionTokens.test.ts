import { describe, expect, it } from 'vitest'

import { TOGGLE_ON_CLASS } from './selectionStyles'
import { BRAND_THEMES, compositeLuminance, contrast, luminance, oklchOf, tokenContrast } from './test/cssContrast'

// 채움 버튼·배지 글자 대비(WP-322)를 index.css 원본 값으로 고정한다 — 기본(primary)·사이드바 선택·삭제(destructive) 채움 위 글자 4.5:1(WCAG AA).
// 브랜드 테마(ocean·sunset)는 primary 만 덮으므로 기본 라이트/다크 위에 덮어 6조합을 모두 잰다.
// hover 는 bg-x/90(반투명)이라 바탕(background·popover) 위에 합성한 색으로 잰다.
const fgOn = (body: string, fg: string, fill: string, alpha: number, under: string) =>
  contrast(luminance(oklchOf(body, fg)), compositeLuminance(body, fill, alpha, under))

describe.each(Object.entries(BRAND_THEMES))('filled action tokens (%s)', (_theme, body) => {
  it.each([
    ['primary-foreground', 'primary'],
    ['sidebar-primary-foreground', 'sidebar-primary'],
    ['destructive-foreground', 'destructive'],
  ])('%s on %s keeps 4.5:1', (text, bg) => {
    expect(tokenContrast(body, text, bg)).toBeGreaterThanOrEqual(4.5)
  })

  // primary·삭제 채움 버튼 hover(hover:bg-x/90) — 반투명이라 바탕 위에 합성해 잰다.
  it.each([
    ['destructive-foreground', 'destructive', 'background'],
    ['destructive-foreground', 'destructive', 'popover'],
    ['primary-foreground', 'primary', 'background'],
    ['primary-foreground', 'primary', 'popover'],
  ])('%s on %s hover(/90 over %s) keeps 4.5:1', (text, fill, under) => {
    expect(fgOn(body, text, fill, 0.9, under)).toBeGreaterThanOrEqual(4.5)
  })

  // 모바일 탭바 AI 캡슐(활성) — ai-accent → primary 그라데이션 위 primary-foreground 글리프. 양 끝 모두 4.5:1.
  it('mobile AI capsule glyph keeps 4.5:1 at both gradient ends', () => {
    expect(tokenContrast(body, 'primary-foreground', 'ai-accent')).toBeGreaterThanOrEqual(4.5)
    expect(tokenContrast(body, 'primary-foreground', 'primary')).toBeGreaterThanOrEqual(4.5)
  })
})

// 선택 상태 표시(WP-368) — 선택 배경(--selected) 위 글자 4.5:1, 왼쪽 primary 막대는 비텍스트 3:1(WCAG 1.4.11),
// 선택 배경은 hover(accent 반투명)보다 확실히 진해야 하므로 바탕 대비도 잰다. 켜진 토글은 TOGGLE_ON_CLASS 의 채움(평소·hover) 위 primary 글자.

/** TOGGLE_ON_CLASS 의 bg-primary/N 채움 투명도(중복 제거) — 라이트(변형 없음·hover:)와 다크(dark:·dark:hover:)로 나눈다. 상수를 바꾸면 테스트가 따라간다. */
const toggleFillAlphas = (dark: boolean) => [
  ...new Set(
    TOGGLE_ON_CLASS.split(' ').flatMap((t) => {
      const m = /^(dark:)?(?:hover:)?bg-primary\/(\d+)$/.exec(t)
      return m && Boolean(m[1]) === dark ? [Number(m[2]) / 100] : []
    }),
  ),
]
describe.each(Object.entries(BRAND_THEMES))('selection tokens (%s)', (theme, body) => {
  const dark = theme.endsWith('dark')
  it('foreground on selected keeps 4.5:1', () => {
    expect(tokenContrast(body, 'foreground', 'selected')).toBeGreaterThanOrEqual(4.5)
  })
  it('primary bar on selected keeps 3:1', () => {
    expect(tokenContrast(body, 'primary', 'selected')).toBeGreaterThanOrEqual(3)
  })
  // 페이지 바탕뿐 아니라 떠 있는 패널(popover — 이슈 유형·기간 선택 등) 위에서도 선택 행이 구분돼야 한다.
  it.each(['background', 'popover'])('selected stands out from %s (≥1.2:1)', (under) => {
    expect(tokenContrast(body, 'selected', under)).toBeGreaterThanOrEqual(1.2)
  })
  it.each(['background', 'popover'])('primary text on every toggle-on fill over %s keeps 4.5:1', (under) => {
    const alphas = toggleFillAlphas(dark)
    expect(alphas.length).toBeGreaterThan(0)
    for (const alpha of alphas) {
      expect(fgOn(body, 'primary', 'primary', alpha, under), `bg-primary/${alpha * 100}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
