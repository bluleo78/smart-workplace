// 위키 본문 멘션 토큰 ↔ 세그먼트 변환. 에디터/DOM 비의존 순수 함수.
// 토큰 스킴: 유저 <@id>, 페이지 <#page:id>, 이슈 <#issue:id>.
// chat 의 mentionSerialize 패턴을 위키(3종 멘션)로 확장.

import type { WikiMentionType } from '../../types/wiki'

// 본문 한 조각 — 일반 텍스트 또는 멘션 토큰 하나.
export type WikiSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; mtype: WikiMentionType; id: number }

// 멘션 종류·id → 저장 본문에 쓰이는 클린 토큰 문자열.
export function tokenFor(mtype: WikiMentionType, id: number): string {
  switch (mtype) {
    case 'USER':
      return `<@${id}>`
    case 'PAGE':
      return `<#page:${id}>`
    case 'ISSUE':
      return `<#issue:${id}>`
  }
}

// 본문 문자열을 텍스트/멘션 세그먼트로 분해. 토큰 사이 텍스트는 보존하되
// 인접 토큰 사이의 빈 텍스트(zero-length)는 만들지 않는다.
export function parseWikiSegments(body: string): WikiSegment[] {
  const segments: WikiSegment[] = []
  // 유저 <@id> | 페이지·이슈 <#(page|issue):id> 를 한 정규식으로 매칭.
  const re = /<@(\d+)>|<#(page|issue):(\d+)>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    // 직전 토큰 끝 ~ 현재 토큰 시작 사이의 텍스트 보존(비어있지 않을 때만).
    if (m.index > last) segments.push({ type: 'text', value: body.slice(last, m.index) })
    if (m[1] !== undefined) {
      segments.push({ type: 'mention', mtype: 'USER', id: Number(m[1]) })
    } else {
      // m[2] = 'page' | 'issue', m[3] = id.
      const mtype: WikiMentionType = m[2] === 'page' ? 'PAGE' : 'ISSUE'
      segments.push({ type: 'mention', mtype, id: Number(m[3]) })
    }
    last = m.index + m[0].length
  }
  // 마지막 토큰 이후 잔여 텍스트.
  if (last < body.length) segments.push({ type: 'text', value: body.slice(last) })
  return segments
}
