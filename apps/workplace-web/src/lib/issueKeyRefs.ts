// 본문의 이슈 키 찾기(WP-1237) — 채팅·코멘트 본문에 평문으로 쓴 「WP-1201」을 이슈 링크로 바꾸기 위해 키 자리를 나눈다. DOM 비의존 순수 함수.
// 코드·링크·URL·멘션 안의 글자는 렌더러가 이 함수에 넘기지 않는다(넘기는 것은 그 밖의 평문 조각뿐). 보이는 프로젝트인지는 링크를 그릴 때 정한다.

import type { ReactNode } from 'react'

/** 평문 조각 하나 — 글자 그대로이거나, 이슈 키 하나. */
export type IssueKeySegment =
  | { type: 'text'; text: string }
  | { type: 'issue'; text: string; projectKey: string; number: number }

/**
 * 이슈 키 후보.
 *   - 프로젝트 키는 PROJECT_KEY_RE(대문자 시작, 대문자·숫자 2~10자)와 같은 모양 — 소문자(`wp-12`)는 키가 아니다.
 *   - 번호는 앱 링크(lib/appLinks ISSUE_NUMBER)와 같이 0 으로 시작하지 않는 9자리까지(서버가 int 로 받는다).
 *   - 앞: 영문·숫자·`_`·`-`·`@` 가 붙어 있으면 키로 보지 않는다 — `XWP-12`(긴 낱말의 끝), 메일 `me@WP-12.com`.
 *     `/`·`.` 은 경계로 본다 — 「WP-12/WP-13」·「WP-12.WP-13」·「완료.WP-12」처럼 붙여 쓴 키도 다 링크가 된다.
 *     URL·경로는 렌더러가 URL 찾기·코드 조각으로 먼저 빼므로 여기까지 오지 않는다(맨 글자 `src/WP-12` 는 링크가 된다 — 받아들인다).
 *     한글은 경계로 본다(「이슈WP-12」·「WP-12에서」처럼 조사를 붙여 쓴다).
 *   - 뒤: 영문·숫자·`_`·`-` 가 이어지면 키가 아니다(`WP-12a`, `WP-12-3`). 끝 문장부호(`.` `,` `)`)는 키에서 뺀다.
 *     `.` 뒤에 숫자가 이어지면(`WP-12.5`) 키가 아니다 — 버전 번호의 일부다. `.` 뒤 영문(`WP-12.WP-13`)은 문장 이어 쓰기로 본다.
 */
const ISSUE_KEY_RE = /(?<![A-Za-z0-9_\-@])([A-Z][A-Z0-9]{1,9})-([1-9][0-9]{0,8})(?![A-Za-z0-9_-]|\.[0-9])/g

// 느슨한 후보 — 프로젝트 키 모양(대문자 시작 2~10자, ISSUE_KEY_RE 와 같다) 뒤 「-숫자」. 마크다운 원문처럼 서식 기호(`_WP-12_`)·이스케이프(`WP\-12`)가 섞인 글에서도
// 놓치지 않도록 경계는 보지 않는다(거짓 양성은 괜찮고 거짓 음성은 안 된다). 정확한 판정은 글자 조각마다 splitIssueKeys 가 한다.
const ISSUE_KEY_HINT = /[A-Z][A-Z0-9]{1,9}\\?-[1-9]/

/** 본문에 이슈 키가 있을 수도 있는지(느슨한 미리 보기) — 없으면 나누기 단계를 통째로 건너뛴다(대부분의 메시지). */
export function mayContainIssueKey(text: string): boolean {
  return ISSUE_KEY_HINT.test(text)
}

/**
 * 평문을 글자·이슈 키 조각으로 나눈다. 줄바꿈 등 글자는 그대로 남는다(렌더 쪽 whitespace-pre-wrap).
 * 키가 하나도 없으면 null — 호출처가 「키 없음 → 원래 글자·노드 그대로」를 따로 판정하지 않게 여기서 한 번만 가른다.
 */
export function splitIssueKeys(text: string): IssueKeySegment[] | null {
  const out: IssueKeySegment[] = []
  let last = 0
  for (const m of text.matchAll(ISSUE_KEY_RE)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    out.push({ type: 'issue', text: m[0], projectKey: m[1], number: Number(m[2]) })
    last = m.index + m[0].length
  }
  if (last === 0) return null
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** 이슈 키 조각을 그리는 함수 — 렌더러(ChatMarkdownText·MarkdownMessage)가 받는다. 링크·미리보기·보이는 프로젝트 판정은 호출처가 준다. */
export type RenderIssueRef = (seg: Extract<IssueKeySegment, { type: 'issue' }>, key: string) => ReactNode

/** 평문을 글자·이슈 키 그리기로 바꾼다. 키가 없으면 글자 하나 그대로(대부분의 메시지 — DOM 이 예전과 같다). */
export function renderIssueKeys(text: string, render: RenderIssueRef, key: string): ReactNode[] {
  const segs = splitIssueKeys(text)
  if (!segs) return [text]
  return segs.map((seg, i) => (seg.type === 'text' ? seg.text : render(seg, `${key}i${i}`)))
}
