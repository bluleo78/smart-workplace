import { describe, expect, it } from 'vitest'

import { BRAND_THEMES, contrast, luminance, oklchOf, stackedLuminance, THEMES, tokenContrast } from './test/cssContrast'

// 노트 버전 비교(WP-282) 추가·삭제 문구 토큰의 대비를 index.css 원본 값으로 검증한다 — 연한 바탕 위 글자 4.5:1(WCAG AA).
describe.each(Object.entries(THEMES))('diff text tokens (%s)', (_theme, body) => {
  it.each([
    ['success-text', 'success-subtle'],
    ['destructive-text', 'destructive-subtle'],
  ])('%s on %s keeps 4.5:1', (text, bg) => {
    expect(tokenContrast(body, text, bg)).toBeGreaterThanOrEqual(4.5)
  })
})

// 진행 중 뱃지 등 info 글자색(WP-1430) — --info(L 0.55)는 채움·아이콘용이라 자기 색 10% 틴트(bg-info/10) 위 글자로는 3.55:1 이었다.
// 글자 전용 --info-text 가 실제로 놓이는 바탕 위에서 4.5:1(WCAG AA)을 지키는지 index.css 원본 값으로 검증한다:
// 바탕(background·card·muted·accent·selected, 목록 선택 행·hover 행 포함) 위 bg-info/10 틴트, 뱃지 hover 틴트(bg-info/15), --info-subtle.
// 브랜드 테마(ocean·sunset)까지 6조합을 돈다 — 브랜드가 accent·selected 를 덮어쓰므로.
describe.each(Object.entries(BRAND_THEMES))('info text token (%s)', (_theme, body) => {
  // 다크의 card·muted·accent 는 반투명이라 background 위에 먼저 깔아 합성한다(첫 층의 투명도는 stackedLuminance 가 무시).
  const stack = (base: string, tint: number): number =>
    stackedLuminance(body, base === 'background' ? ['background', ['info', tint]] : ['background', base, ['info', tint]])
  const text = () => luminance(oklchOf(body, 'info-text'))

  it('info-text on info-subtle keeps 4.5:1', () => {
    expect(tokenContrast(body, 'info-text', 'info-subtle')).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['background', 'card', 'muted', 'accent', 'selected'])('info-text on %s + bg-info/10 keeps 4.5:1', (base) => {
    expect(contrast(text(), stack(base, 0.1))).toBeGreaterThanOrEqual(4.5)
  })

  it('info-text on background + bg-info/15 (뱃지 hover) keeps 4.5:1', () => {
    expect(contrast(text(), stack('background', 0.15))).toBeGreaterThanOrEqual(4.5)
  })
})
