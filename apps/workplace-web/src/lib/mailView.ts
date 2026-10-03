// 메일 보기 해석(WP-186) — URL 파라미터를 "지금 무엇을 보는가"로 한 번만 해석한다.
// 사이드바 활성 표시·헤더 제목·툴바 토글·목록 API 파라미터가 모두 이 결과만 써서 화면마다 기준이 어긋나지 않게 한다.
// 원칙: "업무"는 어디서나 업무 + 미분류(백엔드 workViewCondition), AI 분류가 꺼진 계정은 받은편지함 = 전체.
import { MAIL_CATEGORIES, type MailCategory, type MailUnreadCounts } from '@/types/mailMessage'

export type MailViewKind = 'work' | 'all' | 'category' | 'needsReply' | 'sent'

export interface MailView {
  kind: MailViewKind
  apiCategory: string
  activeCategory: MailCategory | null
  unreadOnly: boolean
  unreadToggleVisible: boolean
  title: string
  breadcrumb: string[]
  key: string
}

const INBOX = '받은편지함'

function isCategory(v: string | null): v is MailCategory {
  return v != null && (MAIL_CATEGORIES as readonly string[]).includes(v)
}

/** URL → 보기. classificationActive=false 면 분류 보기를 모두 전체로 접는다(옛 링크로도 메일이 숨지 않게). */
export function resolveMailView(params: URLSearchParams, classificationActive: boolean): MailView {
  const unread = params.get('unread') === 'true'
  if (params.get('folder') === 'sent') {
    return { kind: 'sent', apiCategory: '', activeCategory: null, unreadOnly: false, unreadToggleVisible: false, title: '보낸편지함', breadcrumb: ['보낸편지함'], key: 'sent' }
  }
  if (params.get('needsReply') === 'true') {
    return { kind: 'needsReply', apiCategory: '', activeCategory: null, unreadOnly: false, unreadToggleVisible: false, title: '회신필요', breadcrumb: ['회신필요'], key: 'needsReply' }
  }
  const raw = params.get('category')
  // 딥링크(?messageId=N, category 없음)는 홈 위젯·알림 등 외부 진입이라 메일의 분류를 알 수 없다.
  // 행 선택은 URL 을 바꾸지 않으므로(로컬 상태) messageId 는 외부 딥링크에서만 온다 → 전체 보기로 열어 어떤 분류의 메일이든 목록에 보이게 한다.
  const deepLink = raw == null && Number(params.get('messageId')) > 0
  const base = { unreadOnly: unread, unreadToggleVisible: true }
  if (!classificationActive || raw === 'all' || deepLink) {
    return { ...base, kind: 'all', apiCategory: '', activeCategory: null, title: INBOX, breadcrumb: [INBOX], key: `all:${unread}` }
  }
  if (isCategory(raw) && raw !== '업무') {
    return { ...base, kind: 'category', apiCategory: raw, activeCategory: raw, title: raw, breadcrumb: [INBOX, raw], key: `cat:${raw}:${unread}` }
  }
  return { ...base, kind: 'work', apiCategory: '업무', activeCategory: '업무', title: '업무', breadcrumb: [INBOX, '업무'], key: `work:${unread}` }
}

/** 보기 링크 — 업무(기본)는 쿼리 없이, 그 외는 category, 토글 상태는 유지한다. */
export function mailViewHref(accountId: number, view: 'work' | 'all' | MailCategory, unreadOnly: boolean): string {
  const q = new URLSearchParams()
  if (view !== 'work' && view !== '업무') q.set('category', view)
  if (unreadOnly) q.set('unread', 'true')
  const s = q.toString()
  return s ? `/mail/${accountId}?${s}` : `/mail/${accountId}`
}

/**
 * WP-187 보기에 해당하는 안 읽은 수 — 모두 읽음 버튼 비활성 판단용.
 * work=업무 버킷, all=받은편지함 전체, category=해당 분류, needsReply=회신필요. 보낸편지함은 안 읽음 개념이 없어 0.
 */
export function unreadCountForView(view: MailView, counts: MailUnreadCounts): number {
  switch (view.kind) {
    case 'work':
      return counts.byCategory['업무'] ?? 0
    case 'all':
      return counts.inbox
    case 'category':
      return view.activeCategory ? (counts.byCategory[view.activeCategory] ?? 0) : 0
    case 'needsReply':
      return counts.needsReply
    case 'sent':
      return 0
  }
}
