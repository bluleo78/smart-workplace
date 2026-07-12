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
  | 'UNSUPPORTED'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** mimeType → 프리뷰 종류. 매핑에 없으면 UNSUPPORTED. */
export function resolvePreviewKind(mimeType: string): PreviewKind {
  if (mimeType.startsWith('image/')) return 'IMAGE'
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType === 'text/markdown') return 'MARKDOWN'
  // HTML 은 범용 text/ 분기보다 먼저 잡아 소스 덤프가 아닌 렌더로 보낸다(#732).
  if (mimeType === 'text/html') return 'HTML'
  if (mimeType === 'text/csv' || mimeType === 'application/csv') return 'CSV'
  if (mimeType === XLSX_MIME) return 'XLSX'
  if (mimeType === DOCX_MIME) return 'DOCX'
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml'
  )
    return 'TEXT'
  return 'UNSUPPORTED'
}
