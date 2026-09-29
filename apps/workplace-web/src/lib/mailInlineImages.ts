// 메일 본문 인라인 이미지(cid:) 해석 순수 함수.
// HTML 메일은 본문의 <img src="cid:xxx"> 로 MIME 파트(첨부)를 참조한다. 본문은 sandbox iframe(srcDoc)으로
// 렌더되고 첨부 다운로드 API 는 Bearer 인증이 필요하므로, 브라우저가 cid: 를 직접 불러올 수 없다.
// → 참조를 첨부와 매칭해 바이너리를 받아 data URI 로 치환한 HTML 을 렌더한다(WP-65).
import type { EmailAttachmentMeta } from '../types/mailMessage'

// src 속성의 cid: 참조(따옴표 "…" / '…' / 없음) — 캡처 2·3·4 중 하나에 cid 값이 들어간다.
// (?<![\w-]) 로 data-src 같은 다른 속성을 제외하고, 따옴표 없는 값은 self-closing `/` 를 포함하지 않는다.
const CID_SRC_RE = /((?<![\w-])src\s*=\s*)(?:"cid:([^"]*)"|'cid:([^']*)'|cid:([^\s>/]+))/gi

// 인라인 치환 대상 상한 — 파일명 매칭은 임의 첨부와 맞을 수 있어 이미지·크기로 한정(base64 로 메모리 1.33배)
const MAX_INLINE_BYTES = 5 * 1024 * 1024

// 발송 가능한 Content-ID — 백엔드 MailComposeService.CONTENT_ID 와 동일(출력 가능 ASCII, 공백·꺾쇠·따옴표 제외, 250자)
const SENDABLE_CONTENT_ID = /^[\x21\x23-\x3B\x3D\x3F-\x7E]{1,250}$/

/** cid 값 디코딩 — 꺾쇠 제거·URL 디코딩(대소문자 보존). 발송 Content-ID 는 이 값을 그대로 쓴다(WP-69). */
export function decodeCid(raw: string): string {
  const v = raw.trim().replace(/^<|>$/g, '')
  try {
    return decodeURIComponent(v)
  } catch {
    // 잘못된 % 시퀀스는 원문 유지
    return v
  }
}

/** cid 비교용 정규화 — decodeCid + 소문자화. 헤더(`<a@b>`)와 본문 참조(`a%40b`) 표기 차이를 흡수한다. */
export function normalizeCid(raw: string): string {
  return decodeCid(raw).toLowerCase()
}

/** 본문 HTML 에서 참조하는 cid 집합(정규화 값). */
export function extractCidRefs(html: string): Set<string> {
  const refs = new Set<string>()
  for (const m of html.matchAll(CID_SRC_RE)) {
    const raw = m[2] ?? m[3] ?? m[4]
    if (raw) refs.add(normalizeCid(raw))
  }
  return refs
}

/**
 * cid 에 대응하는 첨부 찾기.
 * 1) MIME Content-ID 일치(IMAP 경로는 저장됨)
 * 2) 파일명 일치 — Graph 경로는 contentId 를 저장하지 않지만 발신 클라이언트가 cid 를 파일명으로 쓰는 경우가 많다
 *    (예: 하나비로 `7dc8….png`, Outlook `image001.png@01D….` → `@` 앞부분이 파일명)
 * 이미지(image/*)이면서 MAX_INLINE_BYTES 이하인 첨부만 대상으로 한다.
 */
export function findCidAttachment(
  cid: string,
  attachments: EmailAttachmentMeta[],
): EmailAttachmentMeta | undefined {
  const inlinable = attachments.filter(
    (a) => a.contentType?.toLowerCase().startsWith('image/') && a.sizeBytes <= MAX_INLINE_BYTES,
  )
  const local = cid.split('@')[0]
  const byName = (a: EmailAttachmentMeta) => {
    const name = a.filename?.toLowerCase()
    return name === cid || name === local
  }
  return (
    inlinable.find((a) => a.contentId && normalizeCid(a.contentId) === cid) ?? inlinable.find(byName)
  )
}

/** cid 참조를 치환 맵(정규화 cid → URL)의 값으로 교체. 맵에 없는 참조는 그대로 둔다. */
export function replaceCidRefs(html: string, urls: Map<string, string>): string {
  return html.replace(CID_SRC_RE, (whole, prefix: string, dq?: string, sq?: string, bare?: string) => {
    const url = urls.get(normalizeCid(dq ?? sq ?? bare ?? ''))
    return url ? `${prefix}"${url}"` : whole
  })
}

/**
 * 본문의 cid 참조 중 첨부와 매칭된 것(정규화 cid → 첨부). 본문 렌더 치환(useInlineMailHtml)과 첨부 목록 숨김(WP-70)이 같은 매칭을
 * 공유한다.
 */
export function resolveCidTargets(
  html: string,
  attachments: EmailAttachmentMeta[],
): { cid: string; att: EmailAttachmentMeta }[] {
  return [...extractCidRefs(html)].flatMap((cid) => {
    const att = findCidAttachment(cid, attachments)
    return att ? [{ cid, att }] : []
  })
}

/** 답장·전달 인용문의 인라인 이미지 — 발송 시 서버가 원본 첨부를 같은 Content-ID 로 다시 붙인다(WP-69). */
export interface QuoteInlineImage {
  /** 발송 파트 Content-ID — 본문 cid: 값을 디코딩(대소문자 보존)한 값 */
  contentId: string
  /** 원본 첨부 — 발송 요청 attachmentId 는 attachment.id, 미리보기 치환에도 사용 */
  attachment: EmailAttachmentMeta
}

/**
 * 인용문 DOM 의 cid 이미지를 정리한다(DOM 을 직접 수정).
 * - 첨부와 매칭되고 발송 가능한 Content-ID 면 재첨부 대상으로 수집(같은 Content-ID 는 1회)
 * - 매칭되지 않으면 <img> 를 제거 — 그대로 보내면 수신자에게 깨진 이미지로 보인다(보낸편지함 메일에 답장 등)
 */
export function collectQuoteInlineImages(
  root: Element,
  attachments: EmailAttachmentMeta[],
): QuoteInlineImage[] {
  const out = new Map<string, QuoteInlineImage>()
  root.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') ?? '').trim()
    if (!/^cid:/i.test(src)) return
    const raw = src.slice(4)
    const contentId = decodeCid(raw)
    const att = findCidAttachment(normalizeCid(raw), attachments)
    if (!att || !SENDABLE_CONTENT_ID.test(contentId)) {
      img.remove()
      return
    }
    if (!out.has(contentId)) out.set(contentId, { contentId, attachment: att })
  })
  return [...out.values()]
}
