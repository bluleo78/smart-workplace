// 첨부 형식 정규화·파일명 확장자 → 미리보기 형식 추론(WP-280).
// 왜: 메일 클라이언트가 첨부를 application/octet-stream·force-download 같은 범용 형식이나 빈 형식으로 보내는 일이 많아,
//     서버 형식만 믿으면 PDF·이미지·문서가 "미리 볼 수 없는 형식"으로 떨어진다. resolvePreviewKind 가 정확 일치로 고르는 소문자 형식만 돌려준다.
import { DOCX_MIME, XLSX_MIME } from './previewKind'

/**
 * 확장자(소문자) → 형식. 미리보기 렌더러가 있는 형식만 둔다.
 * - svg 는 넣지 않는다(보안): 범용 형식으로 온 임의 바이트를 SVG 로 바꿔 달면, blob URL 을 새 탭으로 열 때
 *   같은 출처에서 스크립트가 실행될 수 있다. SVG 는 서버가 형식을 명시한 경우에만 그린다.
 * - html·htm: 드라이브와 같은 SandboxedHtmlFrame(스크립트 차단)으로 그린다.
 */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
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

/** 내용을 말해 주지 않는 범용 형식 — 이 형식이면 파일명으로 추론한다. */
const GENERIC_MIMES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/force-download',
  'application/x-download',
  'application/unknown',
])

/** 같은 형식의 다른 이름 → 미리보기가 정확 일치로 고르는 표준 이름. */
const MIME_ALIASES: Record<string, string> = {
  'application/x-pdf': 'application/pdf',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
}

/** `;` 뒤 파라미터를 떼고 소문자·별칭 정규화. 비면 ''. */
export function canonicalMime(contentType: string | null | undefined): string {
  const base = (contentType ?? '').split(';')[0].trim().toLowerCase()
  return MIME_ALIASES[base] ?? base
}

/** 비었거나 범용(octet-stream 등) 형식인지 — 파라미터·대소문자 무관. */
export function isGenericMime(contentType: string | null | undefined): boolean {
  const base = canonicalMime(contentType)
  return !base || GENERIC_MIMES.has(base)
}

/** 파일명의 마지막 확장자로 형식을 고른다. 확장자가 없거나 모르는 형식(svg 포함)이면 null. */
export function mimeFromFilename(filename: string | null | undefined): string | null {
  const m = filename ? /\.([^./\\]+)$/.exec(filename.trim()) : null
  return m ? (EXT_MIME[m[1].toLowerCase()] ?? null) : null
}
