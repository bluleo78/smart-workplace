// 평문을 텍스트·링크 조각으로 나누는 공용 분리기 — 채팅 자동 링크(WP-874)와 캘린더 설명 링크가 같이 쓴다. DOM 비의존 순수 함수.
// 화면마다 규칙이 달라 규칙 묶음(LinkRules)만 바꿔 끼운다. 다듬기(끝 문장부호·짝 없는 닫는 괄호)·조각 조립은 한 벌.
import { hashString } from '@/lib/project-color'

export type TextSegment = { type: 'text'; text: string } | { type: 'link'; text: string; href: string }

/** 한 화면의 링크 규칙. */
export interface LinkRules {
  /** URL 후보 정규식(g 플래그). 시작 경계·URL 문자 집합을 여기서 정한다. */
  re: RegExp
  /** 끝에서 늘 떼어 내는 문장부호. */
  trailing: string
  /** 짝이 없으면 끝에서 떼어 내는 닫는 괄호 → 여는 괄호. */
  brackets: Record<string, string>
  /** `<https://…>` 꼴이면 꺾쇠를 화면에서 빼고 다듬기를 하지 않는다(꺾쇠가 경계를 확정). */
  unwrapAngle: boolean
}

/**
 * 채팅 규칙(WP-874) — 서버 LinkUrlExtractor(미리보기 대상 URL)와 같아야 한다. 바꾸면 workplace-api 쪽도 같이 바꾼다.
 *   - `http://`·`https://`·`www.`(대소문자 무관) 시작, 바로 앞이 ASCII 단어 문자([A-Za-z0-9_])면 시작으로 보지 않는다.
 *   - URL 문자는 RFC 3986 ASCII 집합만 — 공백·`<`·`>`·`"`·비-ASCII(한글 등)에서 끝난다.
 *   - 끝의 `.,!?;:'"` 와 짝 없는 `)` `]` 는 뺀다. `www.` 시작은 href 에 `https://` 를 붙인다.
 */
export const CHAT_LINK_RULES: LinkRules = {
  re: /(?<![A-Za-z0-9_])(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*/gi,
  trailing: `.,!?;:'"`,
  brackets: { ')': '(', ']': '[' },
  unwrapAngle: false,
}

/**
 * 캘린더 설명 규칙 — http(s) 만(javascript: 등 차단). 공백·꺾쇠·따옴표·한글에서 끊는다. 「…/doc에서 확인」처럼 URL 뒤에 조사를 붙여 쓰는 일이
 * 흔하고, 메일·Teams 본문의 한글 경로는 퍼센트 인코딩돼 들어온다. M365 가 텍스트로 바꾼 본문은 링크를 `글자<https://…>` 로 준다.
 */
export const CALENDAR_LINK_RULES: LinkRules = {
  re: /https?:\/\/[^\s<>"'ᄀ-ᇿ㄰-㆏가-힯]+/g,
  trailing: '.,;:!?',
  brackets: { ')': '(', ']': '[', '}': '{' },
  unwrapAngle: true,
}

/** 문자열 안의 ch 개수. */
function count(s: string, ch: string): number {
  return s.split(ch).length - 1
}

/** URL 끝의 문장 부호와, URL 안에 짝이 없는 닫는 괄호를 더 뗄 것이 없을 때까지 뗀다 — 「(https://a.b/c).」 → https://a.b/c, 「Foo_(bar)」는 유지. */
function trimUrlEnd(url: string, rules: LinkRules): string {
  let u = url
  for (;;) {
    const last = u.at(-1)
    if (!last) return u
    if (rules.trailing.includes(last)) {
      u = u.slice(0, -1)
      continue
    }
    const open = rules.brackets[last]
    if (open && count(u, open) < count(u, last)) {
      u = u.slice(0, -1)
      continue
    }
    return u
  }
}

/** 접두사(`https://`·`www.`)만 남았으면 링크가 아니다 — 다듬기로 접두사가 깎인 경우(`www.` → `www`)도 아니다. */
function hasBody(url: string): boolean {
  const prefix = /^(?:https?:\/\/|www\.)/i.exec(url)?.[0]
  return prefix !== undefined && url.length > prefix.length
}

/** 링크 텍스트에서 href 를 만든다 — `www.` 시작은 https 를 붙인다. */
function toHref(url: string): string {
  return /^www\./i.test(url) ? `https://${url}` : url
}

/** 평문을 text/link 조각으로 나눈다. 줄바꿈은 text 조각에 그대로 남는다(렌더 쪽 whitespace-pre-wrap). */
export function splitLinks(text: string, rules: LinkRules): TextSegment[] {
  const out: TextSegment[] = []
  let last = 0
  for (const m of text.matchAll(rules.re)) {
    const start = m.index
    const wrapped = rules.unwrapAngle && start > 0 && text[start - 1] === '<' && text[start + m[0].length] === '>'
    const url = wrapped ? m[0] : trimUrlEnd(m[0], rules)
    if (!hasBody(url)) continue
    const textEnd = wrapped ? start - 1 : start
    if (textEnd > last) out.push({ type: 'text', text: text.slice(last, textEnd) })
    out.push({ type: 'link', text: url, href: toHref(url) })
    last = start + url.length + (wrapped ? 1 : 0)
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** 채팅 본문 평문 조각 → 조각 배열(WP-874). 멘션 토큰은 호출처가 먼저 떼어 낸다. */
export function linkifyText(text: string): TextSegment[] {
  return splitLinks(text, CHAT_LINK_RULES)
}

/**
 * 링크의 짧은 버전 값 — 미리보기 썸네일 캐시 무효화용(WP-874). 썸네일은 메시지·자리(position)로만 주소가 정해지고 하루 캐시되므로,
 * 수정으로 같은 자리에 다른 링크가 오면 이 값으로 주소를 바꾼다.
 */
export function linkVersion(url: string): string {
  return hashString(url).toString(36)
}
