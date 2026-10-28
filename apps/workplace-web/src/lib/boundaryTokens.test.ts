import { describe, expect, it } from 'vitest'

import { BRAND_THEMES, contrast, css, luminance, oklchOf, stackedLuminance } from './test/cssContrast'

// 영역 경계 단계(WP-1051) — 카드·패널·목록 행·입력이 한 면에 붙어 보이지 않게 index.css 원본 값으로 단계 사이 대비를 고정한다.
// 배경 3단: 페이지(background) < 패널·카드(card) < 머리 띠(muted). 테두리 3단: 행 구분선(divider) < 덩어리 외곽(border) < 입력(input).
// 다크 card·muted·border·divider·input 은 반투명이라 바탕부터 차례로 겹쳐 잰다. 예전 값(카드 1.03~1.04 · 외곽 1.19~1.28)은 여기서 실패한다.
describe.each(Object.entries(BRAND_THEMES))('boundary tokens (%s)', (_theme, body) => {
  const bg = stackedLuminance(body, ['background'])
  const card = stackedLuminance(body, ['background', 'card'])
  /** 카드 위에 겹친 선·면과 카드의 대비 */
  const onCard = (token: string) => contrast(stackedLuminance(body, ['background', 'card', token]), card)

  it('card stands out from the page (≥1.04:1)', () => {
    expect(contrast(card, bg)).toBeGreaterThanOrEqual(1.04)
  })
  it('card header band (muted) stands out from the card (≥1.12:1)', () => {
    expect(onCard('muted')).toBeGreaterThanOrEqual(1.12)
  })
  it('outline border is visible on the card and on the page (≥1.4:1 · ≥1.3:1)', () => {
    expect(onCard('border')).toBeGreaterThanOrEqual(1.4)
    expect(contrast(stackedLuminance(body, ['background', 'border']), bg)).toBeGreaterThanOrEqual(1.3)
  })
  it('row divider stays visible but lighter than the outline', () => {
    expect(onCard('divider')).toBeGreaterThanOrEqual(1.2)
    expect(onCard('divider')).toBeLessThan(onCard('border'))
  })
  // 표면을 진하게 해도 보조 글자는 4.5:1 — 카드가 두 겹 깔린 곳(홈 요약 칸)의 머리 띠·hover, 입력 칸 채움(다크 bg-input/30) 위 placeholder.
  it.each<[string, (string | [string, number])[]]>([
    ['muted band over two cards', ['background', 'card', 'card', 'muted']],
    ['hover over two cards', ['background', 'card', 'card', 'accent']],
    ['input fill (input/30) on a card', ['background', 'card', ['input', 0.3]]],
  ])('muted-foreground on %s keeps 4.5:1', (_where, layers) => {
    expect(contrast(luminance(oklchOf(body, 'muted-foreground')), stackedLuminance(body, layers))).toBeGreaterThanOrEqual(4.5)
  })
  it('input border is the strongest step (≥1.6:1 and above the outline)', () => {
    expect(onCard('input')).toBeGreaterThanOrEqual(1.6)
    expect(onCard('input')).toBeGreaterThan(onCard('border'))
  })
})

// 목록 행 사이 선(divide-y·divide-x)의 기본 색이 divider 인지 — 화면마다 divide-* 색을 따로 주지 않아도 옅은 구분선이 되게 한다.
// 행 아래 선은 row-divider 유틸리티 하나로 쓴다(divide-y 를 못 쓰는 표 tr 등).
it('divide-* children and the row-divider utility use the divider token', () => {
  expect(css).toMatch(/:where\(\.divide-y\) > :not\(:last-child\) \{\s*border-block-color: var\(--divider\);/)
  expect(css).toMatch(/:where\(\.divide-x\) > :not\(:last-child\) \{\s*border-inline-color: var\(--divider\);/)
  expect(css).toMatch(/@utility row-divider \{\s*border-bottom-width: 1px;\s*border-bottom-color: var\(--divider\);/)
})
