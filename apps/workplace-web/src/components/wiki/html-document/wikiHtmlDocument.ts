// 「HTML 문서」 페이지(WP-1307) 공용 판정·도우미 — 화면 없이 vitest 로 검증하는 순수 함수 모음.
import { toast } from 'sonner'

import { downloadBlob } from '@/lib/download'

import type { WikiHtmlLockStatus, WikiPageKind, WikiRole } from '../../../types/wiki'
import { htmlFileBaseName } from '../wikiHtmlImport'
import { HTML_IMPORT_MAX_BYTES } from '../wikiHtmlImportInsert'

/** 「HTML 문서」 원본 크기 상한(UTF-8 바이트) — 서버와 같은 5MB. 파일 들여오기 상한과 같은 값을 쓴다. */
export const HTML_DOCUMENT_MAX_BYTES = HTML_IMPORT_MAX_BYTES

/** 상한을 넘었을 때 알리는 문구 — 서버 413 메시지와 같다. */
export const HTML_DOCUMENT_TOO_LARGE = 'HTML 문서는 5MB 까지 올릴 수 있습니다'

/** 노트 제목 최대 길이 — 서버 요청의 @Size(max = 255). <title> 이 더 길면 잘라 400 을 피한다. */
const TITLE_MAX = 255

/** 「HTML 문서」 페이지인지 — kind 가 없거나(구버전 서버) NOTE 면 거짓. 화면 분기는 모두 이 함수로 판정한다. */
export function isHtmlPage(page: { kind?: WikiPageKind } | null | undefined): boolean {
  return page?.kind === 'HTML'
}

/** 원본의 UTF-8 바이트 수 — 서버 상한이 글자 수가 아니라 바이트라 한글 문서는 글자 수보다 크다. */
export function htmlByteLength(html: string): number {
  return new TextEncoder().encode(html).length
}

/** 원본이 상한을 넘으면 알리고 true — 붙여 넣은 소스·저장 전에 서버까지 보내지 않고 거른다. */
export function rejectOversizedHtmlSource(html: string): boolean {
  if (htmlByteLength(html) <= HTML_DOCUMENT_MAX_BYTES) return false
  toast.error(HTML_DOCUMENT_TOO_LARGE)
  return true
}

/** 원본의 <title> 글자(공백 정리) — 없거나 비면 null. 문서를 실행하지 않으려고 DOMParser 대신 정규식으로 읽는다. */
export function htmlDocumentTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!m) return null
  const text = decodeEntities(m[1]).replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, TITLE_MAX) : null
}

/** 자주 쓰는 HTML 엔티티만 푼다 — 제목에 &amp; 등이 그대로 보이지 않게. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** 올린 파일의 새 문서 제목 — <title>, 없으면 확장자를 뺀 파일 이름. */
export function htmlDocumentTitleForFile(html: string, fileName: string): string {
  return (htmlDocumentTitle(html) ?? htmlFileBaseName(fileName)).slice(0, TITLE_MAX)
}

/** 내려받을 파일 이름 — 파일 이름에 못 쓰는 글자를 바꾸고, 제목이 없으면 「제목 없음」. 확장자는 늘 .html. */
export function htmlDownloadFileName(title: string): string {
  // 제어 문자(코드 32 미만)도 파일 이름에 못 쓴다 — 정규식 제어 문자 규칙(no-control-regex)을 피해 코드로 거른다.
  const cleaned = Array.from(title, (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch)).join('')
  const base = cleaned.trim() || '제목 없음'
  return `${base}.html`
}

/**
 * 원본 내려받기 — 보안상 Blob 형식을 application/octet-stream 으로 둔다(text/html 이면 브라우저가 앱 출처에서 문서로 열 수 있다).
 * a[download] 클릭으로 저장만 시키고, 앱 창을 blob 주소로 옮기지 않는다. URL 해제는 downloadBlob 이 한다.
 */
export function downloadHtmlSource(title: string, html: string): void {
  downloadBlob(htmlDownloadFileName(title), new Blob([html], { type: 'application/octet-stream' }))
}

// ── 편집 잠금(WP-1308) ─────────────────────────────────────────────────

/** 잠금 없음 — 풀림 이벤트·내가 푼 뒤 잠금 캐시에 넣는다. */
export const UNLOCKED_HTML_LOCK: WikiHtmlLockStatus = {
  locked: false,
  mine: false,
  holderId: null,
  holderName: null,
  acquiredAt: null,
  expiresAt: null,
  canForceRelease: false,
}

/**
 * 잠금 상태의 mine·canForceRelease 를 내 id·스페이스 역할로 다시 가린다 — SSE(wiki.page.lock)는 쥔 사람만 싣고(받는 사람마다 다르다),
 * 서버 응답과 같은 규칙(mine = 내가 쥠, 강제 풀기 = 남의 잠금을 보는 스페이스 소유자)이라 어느 쪽에서 온 캐시든 같게 보인다.
 */
export function deriveHtmlLock(s: WikiHtmlLockStatus, userId: number | undefined, role: WikiRole | undefined): WikiHtmlLockStatus {
  if (!s.locked) return s
  const mine = userId != null && s.holderId === userId
  return { ...s, mine, canForceRelease: !mine && role === 'OWNER' }
}

/** 잠금을 쥔 사람 이름 — 모르면 「다른 사람」. 띠·확인 창·토스트가 같이 쓴다. */
export function holderLabel(lock: Pick<WikiHtmlLockStatus, 'holderName'> | null | undefined): string {
  return lock?.holderName ?? '다른 사람'
}

/** 위 띠 문구 — 「○○ 님이 편집 중입니다 — 저장될 때까지 보기만 할 수 있어요」. */
export function htmlLockBannerText(lock: Pick<WikiHtmlLockStatus, 'holderName'> | null | undefined): string {
  return `${holderLabel(lock)} 님이 편집 중입니다 — 저장될 때까지 보기만 할 수 있어요`
}

/** 저장·취소 없이 편집이 끝났을 때 안내 끝 — 고치던 내용은 임시 저장본으로 남았다. */
export const HTML_DRAFT_KEPT_TAIL = '고치던 내용은 다음에 「편집」을 누르면 이어서 고칠 수 있어요'

/** 두 시각 문자열이 같은 순간인지 — 서버 직렬화 모양(소수 자리·오프셋)이 달라도 같은 시각이면 같다. 둘 다 없으면 다르다. */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false
  return Date.parse(a) === Date.parse(b)
}
