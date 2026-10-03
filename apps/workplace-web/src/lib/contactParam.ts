// 연락처 상세 URL 키(?contact=member:<id> | external:<id>) 코덱(WP-206).
// 왜: 멤버·외부 연락처 id 공간이 달라 종류를 함께 실어야 하고, 기존 ?type 은 목록 필터라 재사용할 수 없다.
import type { ContactSelection } from '@/hooks/queries/useContactDetail'

export function encodeContactParam(sel: ContactSelection): string {
  return `${sel.type === 'MEMBER' ? 'member' : 'external'}:${sel.id}`
}

/** 형식이 틀리면 null — 상세를 열지 않고 목록을 그대로 보여 준다(자동으로 URL 을 고치지 않는다). */
export function decodeContactParam(raw: string | null): ContactSelection | null {
  const m = raw ? /^(member|external):(\d+)$/.exec(raw) : null
  if (!m) return null
  return { type: m[1] === 'member' ? 'MEMBER' : 'EXTERNAL', id: Number(m[2]) }
}
