import { describe, expect, it } from 'vitest'

import { COMPOSER_PREVIEW_STYLE, withComposerPreviewStyle } from './composerPreviewHtml'

describe('withComposerPreviewStyle (WP-404)', () => {
  it('에디터 기본 스타일을 앞에 붙이고 본문은 그대로 둔다', () => {
    expect(withComposerPreviewStyle('<p>a</p><p></p><p><strong>b</strong></p>')).toBe(
      `${COMPOSER_PREVIEW_STYLE}<p>a</p><p></p><p><strong>b</strong></p>`,
    )
  })

  it('공백만 든 단락은 빈 단락으로 맞춘다 — p:empty 한 줄 높이 규칙을 타게', () => {
    expect(withComposerPreviewStyle('<p>a</p><p> </p><p>\n</p><p>b</p>')).toBe(
      `${COMPOSER_PREVIEW_STYLE}<p>a</p><p></p><p></p><p>b</p>`,
    )
  })
})
