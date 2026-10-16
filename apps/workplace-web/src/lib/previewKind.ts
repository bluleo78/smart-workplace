/**
 * 드라이브 파일 프리뷰 디스패치의 단일 원본.
 *
 * file.category(IMAGE/PDF/TEXT/DATA/DOCUMENT)는 입자가 거칠어(CSV·XLSX 둘 다 DATA,
 * MD·JSON 둘 다 TEXT) 렌더러를 고르기 어렵다. mimeType 기준으로 세분한 프리뷰 종류를 돌려준다.
 */
export type PreviewKind =
  | 'IMAGE'
  | 'PDF'
  | 'MARKDOWN'
  | 'HTML'
  | 'TEXT'
  | 'CSV'
  | 'XLSX'
  | 'DOCX'
  /** 서버가 PDF 로 변환해 주는 문서(HWP·HWPX·PPTX·PPT·DOC, WP-431) — 드라이브 항목(previewPath)에서만 나온다(itemPreviewKind). */
  | 'CONVERTED_PDF'
  | 'VIDEO'
  | 'AUDIO'
  | 'UNSUPPORTED'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** 구형 엑셀(XLS) — SheetJS 가 XLSX 와 같이 읽으므로 시트 미리보기로 연다(WP-431). */
export const XLS_MIME = 'application/vnd.ms-excel'

/** 변환 대상 정규형 mime(WP-431) — API 가 변환 서비스에 보내는 형식과 같다. 별칭은 canonicalMime 이 여기로 모은다. */
export const HWP_MIME = 'application/x-hwp'
export const HWPX_MIME = 'application/hwp+zip'
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export const PPT_MIME = 'application/vnd.ms-powerpoint'
export const DOC_MIME = 'application/msword'

/**
 * 서버 변환 PDF 로 미리 보는 형식(WP-431). resolvePreviewKind 는 이 형식을 UNSUPPORTED 로 둔다 —
 * 변환 경로는 드라이브 파일에만 있어서, 항목이 previewPath 를 가질 때만 CONVERTED_PDF 로 판정한다(itemPreviewKind).
 */
export const CONVERTIBLE_MIMES: ReadonlySet<string> = new Set([HWP_MIME, HWPX_MIME, PPTX_MIME, PPT_MIME, DOC_MIME])

/** 발표 자료(pptx·ppt)인지 — 변환 PDF 를 슬라이드처럼 보여 줄지 고를 때 쓴다. */
export function isPresentationMime(mime: string): boolean {
  return mime === PPTX_MIME || mime === PPT_MIME
}

/** mimeType → 프리뷰 종류. 매핑에 없으면 UNSUPPORTED. mime 만 본다 — 변환 대상(CONVERTIBLE_MIMES)도 여기선 UNSUPPORTED. */
export function resolvePreviewKind(mimeType: string): PreviewKind {
  if (mimeType.startsWith('image/')) return 'IMAGE'
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType === 'text/markdown') return 'MARKDOWN'
  // HTML 은 범용 text/ 분기보다 먼저 잡아 소스 덤프가 아닌 렌더로 보낸다(#732).
  if (mimeType === 'text/html') return 'HTML'
  if (mimeType === 'text/csv' || mimeType === 'application/csv') return 'CSV'
  if (mimeType === XLSX_MIME || mimeType === XLS_MIME) return 'XLSX'
  if (mimeType === DOCX_MIME) return 'DOCX'
  // 영상·오디오는 형식 계열 전체를 받는다(WP-281) — 실제 재생 가능 여부(코덱)는 브라우저만 알므로
  // .avi·.mkv·HEVC .mov 처럼 못 트는 것은 플레이어의 error 이벤트에서 미지원 화면으로 바꾼다.
  if (mimeType.startsWith('video/')) return 'VIDEO'
  if (mimeType.startsWith('audio/')) return 'AUDIO'
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml'
  )
    return 'TEXT'
  return 'UNSUPPORTED'
}
