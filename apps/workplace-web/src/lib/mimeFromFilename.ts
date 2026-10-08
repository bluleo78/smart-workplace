// 파일명 확장자 → 미리보기 형식 추론(WP-280).
// 왜: 메일 클라이언트가 첨부를 application/octet-stream 이나 빈 형식으로 보내는 일이 많아, 서버 형식만 믿으면
//     PDF·이미지·문서가 "미리 볼 수 없는 형식"으로 떨어진다. resolvePreviewKind 가 정확 일치로 고르는 소문자 형식만 돌려준다.

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * 확장자(소문자) → 형식. 미리보기 렌더러가 있는 형식만 둔다.
 * - svg: 뷰어는 이미지를 <img>(blob URL)로 그려 스크립트가 실행되지 않는다.
 * - html·htm: 드라이브와 같은 SandboxedHtmlFrame(스크립트 차단)으로 그린다.
 */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  html: 'text/html',
  htm: 'text/html',
  xlsx: XLSX_MIME,
  docx: DOCX_MIME,
}

/** 파일명의 마지막 확장자로 형식을 고른다. 확장자가 없거나 모르는 형식이면 null. */
export function mimeFromFilename(filename: string | null | undefined): string | null {
  const m = filename ? /\.([^./\\]+)$/.exec(filename.trim()) : null
  return m ? (EXT_MIME[m[1].toLowerCase()] ?? null) : null
}
