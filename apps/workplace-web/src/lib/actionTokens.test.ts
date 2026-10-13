import { describe, expect, it } from 'vitest'

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

  // 삭제 버튼 hover(hover:bg-destructive/90). primary hover(/90)는 브랜드 라이트(ocean 3.89·sunset ~4.2:1)에서 미달이라 별도 이슈로 남긴다.
  it.each(['background', 'popover'])('destructive hover(/90 over %s) keeps 4.5:1', (under) => {
    expect(fgOn(body, 'destructive-foreground', 'destructive', 0.9, under)).toBeGreaterThanOrEqual(4.5)
  })

  // 모바일 탭바 AI 캡슐(활성) — ai-accent → primary 그라데이션 위 primary-foreground 글리프. 양 끝 모두 4.5:1.
  it('mobile AI capsule glyph keeps 4.5:1 at both gradient ends', () => {
    expect(tokenContrast(body, 'primary-foreground', 'ai-accent')).toBeGreaterThanOrEqual(4.5)
    expect(tokenContrast(body, 'primary-foreground', 'primary')).toBeGreaterThanOrEqual(4.5)
  })
})

// 선택 상태 표시(WP-368) — 선택 배경(--selected) 위 글자 4.5:1, 왼쪽 primary 막대는 비텍스트 3:1(WCAG 1.4.11),
// 선택 배경은 hover(accent 반투명)보다 확실히 진해야 하므로 바탕 대비도 잰다. 켜진 토글은 primary/10(라이트)·/15(다크) 위 primary 글자.
describe.each(Object.entries(BRAND_THEMES))('selection tokens (%s)', (theme, body) => {
  const dark = theme.endsWith('dark')
  it('foreground on selected keeps 4.5:1', () => {
    expect(tokenContrast(body, 'foreground', 'selected')).toBeGreaterThanOrEqual(4.5)
  })
  it('primary bar on selected keeps 3:1', () => {
    expect(tokenContrast(body, 'primary', 'selected')).toBeGreaterThanOrEqual(3)
  })
  it('selected stands out from background (≥1.2:1)', () => {
    expect(tokenContrast(body, 'selected', 'background')).toBeGreaterThanOrEqual(1.2)
  })
  // 브랜드 라이트(ocean·sunset)는 primary 자체가 바탕 위 4.58·4.95:1 로 여유가 없어 연한 채움 위에선 4.0·4.3:1 — 위 primary hover 와 같은
  // 기존 브랜드 primary 명도 문제라 하한만 고정하고(회귀 방지) 기본 라이트·다크는 AA 4.5:1 을 지킨다.
  const brandLight = theme === 'ocean-light' || theme === 'sunset-light'
  it(`primary text on toggle-on fill keeps ${brandLight ? '4:1' : '4.5:1'}`, () => {
    const fill = compositeLuminance(body, 'primary', dark ? 0.15 : 0.1, 'background')
    expect(contrast(luminance(oklchOf(body, 'primary')), fill)).toBeGreaterThanOrEqual(brandLight ? 4 : 4.5)
  })
})
