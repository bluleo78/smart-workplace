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
