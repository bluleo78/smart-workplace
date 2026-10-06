// 본문 이미지 업로드 공용 규칙 — 위키(useWikiImageUpload)와 이슈(useIssueImageUpload, WP-199)가 같은 기준으로 사전 검사하도록 한 곳에 둔다.
// 클라이언트 검사는 UX 용이고 최종 판정은 서버 매직바이트가 한다.

/** 허용 이미지 MIME — 서버 ImageSniffer 화이트리스트와 같다(SVG 는 스크립트 벡터라 제외). */
export const ACCEPTED_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * 채팅 첨부를 썸네일(<img>·새 탭 원본)로 그려도 되는 이미지인지 — 위 4종만. 그 외 image/*(SVG·HEIC·TIFF…)는 다운로드 카드로 보낸다.
 * SVG 를 앱 출처 blob URL 로 새 탭에 열면 그 안의 스크립트가 앱 권한으로 돌고(서버 Content-Disposition 은 fetch→blob 경로에 무력),
 * HEIC 는 브라우저가 못 그려 깨진다. api HomeAttachmentController.INLINE_MIMES·ai-agent HOME_IMAGE_MIMES 와도 같은 4종이다. (WP-234, WP-260)
 */
export function isInlineImageType(mimeType: string): boolean {
  return ACCEPTED_IMAGE_TYPES.has(mimeType)
}

/** 업로드 크기 상한(10MB) — 서버 max-file-size-bytes 기본값과 같다. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** 형식·크기 거부 안내 문구 — 위키·이슈가 같은 문구를 쓴다. */
export const INVALID_IMAGE_MSG = 'PNG·JPEG·GIF·WebP 이미지만 10MB 까지 올릴 수 있습니다.'

/** 허용 형식이고 크기 상한 이하인 파일인지. */
export function isValidImageFile(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(file.type) && file.size <= MAX_IMAGE_BYTES
}

/**
 * 클립보드에 기본 붙여넣기가 넣을 텍스트가 있는지 — 있으면 이미지만 가로채지 않고 기본 붙여넣기를 살린다
 * (엑셀·워드 셀 복사는 렌더 이미지와 텍스트가 함께 실린다). ProseMirror getText 와 같은 폴백 순서
 * `text/plain` → `Text`(구 IE) → `text/uri-list` 를 따른다.
 */
export function clipboardHasText(data: DataTransfer): boolean {
  return data.getData('text/plain') !== '' || data.getData('Text') !== '' || data.getData('text/uri-list') !== ''
}
