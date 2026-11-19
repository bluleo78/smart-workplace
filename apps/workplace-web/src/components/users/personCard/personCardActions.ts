// 사람 카드 단추 동작(WP-1767) — 화면(PersonCardBody)과 분리한 순수 조립 함수들.
import type { ComposeDraft } from '@/components/mail/MailComposeContext'
import { encodeContactParam } from '@/lib/contactParam'

/** 일정 잡기 — 새 일정 창을 그 사람을 참석자로 채워 연다. */
export function newEventPath(username: string): string {
  return `/calendar?new=true&attendee=${encodeURIComponent(username)}`
}

/** 연락처에서 보기 — 구성원 상세로 가는 주소. */
export function contactPath(userId: number): string {
  return `/contacts?contact=${encodeContactParam({ type: 'MEMBER', id: userId })}`
}

/** DM 화면 주소. */
export function dmPath(dmId: number): string {
  return `/chat/dms/${dmId}`
}

export const PROFILE_PATH = '/settings/profile'

/** 빈 새 메일을 그 사람에게 쓰는 초안 — 사이드바 「새 메일」 과 같은 모양에 받는 사람만 채운다. */
export function composeDraftTo(accountId: number, email: string): ComposeDraft {
  return {
    mode: 'new',
    accountId,
    to: [email],
    cc: [],
    bcc: [],
    subject: '',
    initialHtml: '',
    inReplyToMessageId: null,
    quote: null,
  }
}
