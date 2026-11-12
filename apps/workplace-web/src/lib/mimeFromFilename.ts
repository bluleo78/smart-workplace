// 첨부 형식 정규화·파일명 확장자 → 미리보기 형식 추론(WP-280).
// 왜: 메일 클라이언트가 첨부를 application/octet-stream·force-download 같은 범용 형식이나 빈 형식으로 보내는 일이 많아,
//     서버 형식만 믿으면 PDF·이미지·문서가 "미리 볼 수 없는 형식"으로 떨어진다. resolvePreviewKind 가 정확 일치로 고르는 소문자 형식만 돌려준다.
import { DOC_MIME, DOCX_MIME, HWP_MIME, HWPX_MIME, PPT_MIME, PPTX_MIME, XLS_MIME, XLSX_MIME } from './previewKind'

/**
 * 확장자(소문자) → 형식. 미리보기 렌더러가 있는 형식만 둔다.
 * - svg 는 넣지 않는다(보안): 범용 형식으로 온 임의 바이트를 SVG 로 바꿔 달면, blob URL 을 새 탭으로 열 때
 *   같은 출처에서 스크립트가 실행될 수 있다. SVG 는 서버가 형식을 명시한 경우에만 그린다.
 * - html·htm: 드라이브와 같은 HTML 미리보기(기본 스크립트 차단, 사용자가 「스크립트 실행」으로 허용 — WP-1260)로 그린다.
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
  xls: XLS_MIME,
  // 한글·오피스 변환 대상(WP-431) — 드라이브에서만 변환 PDF 로 보고, 그 밖의 화면은 정규형만 맞춰 둔다(미지원 안내).
  hwp: HWP_MIME,
  hwpx: HWPX_MIME,
  pptx: PPTX_MIME,
  ppt: PPT_MIME,
  doc: DOC_MIME,
  // 영상·오디오(WP-281) — resolvePreviewKind 가 video/·audio/ 계열로 받는다. 재생 가능 여부는 브라우저 코덱 몫(못 틀면 미지원 화면).
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  // 드라이브 동영상(WP-1519) — 서버 MimeNormalizer 의 동영상 확장자 표와 같은 목록·같은 값이다(바꾸면 함께 고친다).
  // 업로드 사전 검사(pages/drive/uploadLimit)와 동영상 아이콘이 이 표로 동영상을 알아본다.
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
}

/**
 * 내용을 말해 주지 않는 범용 형식 — 이 형식이면 파일명으로 추론한다.
 * API `PreviewTypes.GENERIC_MIMES`(workplace-api filepreview)와 같은 목록이어야 한다 — 다르면 웹은 변환 뷰어를 여는데 /preview 는 404 가 된다.
 */
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
  // 오디오 비표준 이름(일부 메일 클라이언트·구형 브라우저 업로드) — 공유 File 형식도 표준 이름이 되게(WP-281).
  'audio/x-wav': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  // 한글 문서 별칭(브라우저·한컴 오피스 업로드) → 변환 서비스가 받는 정규형(WP-431, API 와 같은 규칙).
  'application/haansofthwp': HWP_MIME,
  'application/vnd.hancom.hwp': HWP_MIME,
  'application/haansofthwpx': HWPX_MIME,
  'application/vnd.hancom.hwpx': HWPX_MIME,
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

/**
 * 첨부 형식 일반 규칙(WP-280 메일 → WP-279 채팅 공용) — 구체적인 형식은 정규화만, 비었거나 범용이면 파일명 확장자로 추론, 그래도 모르면 octet-stream.
 * 왜: 팀 채팅 업로드는 브라우저가 보낸 Content-Type 을 원문 저장해(MimeNormalizer 미적용) octet-stream·파라미터가 섞일 수 있다.
 * SVG 는 추론하지 않는다(mimeFromFilename 규칙 — 범용 바이트를 SVG 로 달지 않음).
 * 드라이브 업로드 사전 검사·동영상 아이콘(WP-1519)도 같은 규칙을 쓰려고 뷰어 모듈에서 이리로 옮겼다(뷰어 모듈은 다시 내보낸다).
 */
export function attachmentMime(contentType: string | null | undefined, filename: string | null | undefined): string {
  if (!isGenericMime(contentType)) return canonicalMime(contentType)
  return mimeFromFilename(filename) ?? 'application/octet-stream'
}

/** 동영상인지 — {@link attachmentMime} 으로 정한 형식이 video/ 로 시작하면(WP-1519). 서버 VIDEO 범주 판정(video/ 접두어)과 같다. */
export function isVideoFile(contentType: string | null | undefined, filename: string | null | undefined): boolean {
  return attachmentMime(contentType, filename).startsWith('video/')
}
