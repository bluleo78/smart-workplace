import { describe, expect, it } from 'vitest'

import { isInlineImageType, isValidImageFile, MAX_IMAGE_BYTES } from './imageUpload'

// 채팅 첨부 썸네일 판정(WP-234 → 팀·이슈 채팅 공용 WP-260).
describe('isInlineImageType', () => {
  it('api INLINE_MIMES·mcp-tools-shared SENDABLE_IMAGE_MIMES 와 같은 4종만 이미지로 본다', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) expect(isInlineImageType(mime)).toBe(true);
  });

  it('그 외 image/*(SVG·HEIC·TIFF 등)와 비이미지는 문서로 본다 — SVG blob 새 탭 스크립트 실행·깨진 썸네일 방지', () => {
    for (const mime of ['image/svg+xml', 'image/heic', 'image/tiff', 'image/bmp', 'application/pdf', 'text/html', '']) {
      expect(isInlineImageType(mime)).toBe(false);
    }
  });
});

// 본문 이미지 업로드 사전 검사(WP-412 — 이슈 본문 이미지 E2E 에서 이관). 거부 시 토스트 배선은 E2E(드롭 경로)가 맡는다.
describe('isValidImageFile', () => {
  // size 만 흉내 낸 File — 실제로 10MB 버퍼를 만들지 않으려고 size 를 덮어쓴다.
  const file = (type: string, size = 4) => {
    const f = new File([new Uint8Array(4)], 'f', { type })
    Object.defineProperty(f, 'size', { value: size })
    return f
  }

  it('PNG·JPEG·GIF·WebP 는 10MB 까지 허용', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) expect(isValidImageFile(file(t))).toBe(true)
    expect(isValidImageFile(file('image/png', MAX_IMAGE_BYTES))).toBe(true)
  })

  it('비이미지·SVG·10MB 초과는 거부', () => {
    expect(isValidImageFile(file('application/pdf'))).toBe(false)
    expect(isValidImageFile(file('image/svg+xml'))).toBe(false)
    expect(isValidImageFile(file('image/png', MAX_IMAGE_BYTES + 1))).toBe(false)
  })
})
