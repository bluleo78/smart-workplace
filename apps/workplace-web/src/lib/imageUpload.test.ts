import { describe, expect, it } from 'vitest'

import { isInlineImageType } from './imageUpload'

// 채팅 첨부 썸네일 판정(WP-234 → 팀·이슈 채팅 공용 WP-260).
describe('isInlineImageType', () => {
  it('api INLINE_MIMES·ai-agent HOME_IMAGE_MIMES 와 같은 4종만 이미지로 본다', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) expect(isInlineImageType(mime)).toBe(true);
  });

  it('그 외 image/*(SVG·HEIC·TIFF 등)와 비이미지는 문서로 본다 — SVG blob 새 탭 스크립트 실행·깨진 썸네일 방지', () => {
    for (const mime of ['image/svg+xml', 'image/heic', 'image/tiff', 'image/bmp', 'application/pdf', 'text/html', '']) {
      expect(isInlineImageType(mime)).toBe(false);
    }
  });
});
