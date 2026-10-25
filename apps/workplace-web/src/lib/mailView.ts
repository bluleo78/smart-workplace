// 메일 보기 해석(WP-186) — URL 파라미터를 "지금 무엇을 보는가"로 한 번만 해석한다.
// 사이드바 활성 표시·헤더 제목·툴바 토글·목록 API 파라미터가 모두 이 결과만 써서 화면마다 기준이 어긋나지 않게 한다.
// 원칙: "업무"는 어디서나 업무 + 미분류(백엔드 workViewCondition), AI 분류가 꺼진 계정은 받은편지함 = 전체.
import type { MailServerFolder } from '@/types/mailFolder'
import { MAIL_CATEGORIES, type MailCategory, type MailUnreadCounts } from '@/types/mailMessage'

import { ARCHIVE_LABEL, folderNamePath } from './mailFolders'

// drafts(WP-577) — 앱 서버 임시보관함. IMAP 폴더가 아니라 메시지 목록 API 를 쓰지 않는다.
// folder(WP-961) — 서버의 보관·내 메일함 하나(?box=<메일함 id>). 목록·안 읽은 수·모두 읽음 API 에 folderId 로 보낸다.
export type MailViewKind = 'work' | 'all' | 'category' | 'needsReply' | 'sent' | 'drafts' | 'folder'

/** 서버 메일함 보기 URL 파라미터 — ?folder=sent|drafts(고정 메일함)와 겹치지 않게 따로 둔다. */
export const MAIL_BOX_PARAM = 'box'

export interface MailView {
  kind: MailViewKind
  apiCategory: string
  activeCategory: MailCategory | null
  unreadOnly: boolean
  unreadToggleVisible: boolean
  title: string
  breadcrumb: string[]
  key: string
  /** 서버 메일함 보기일 때만 그 메일함 id — 그 외 null. */
  folderId: number | null
}

const INBOX = '받은편지함'

function isCategory(v: string | null): v is MailCategory {
  return v != null && (MAIL_CATEGORIES as readonly string[]).includes(v)
}

/**
 * URL → 보기. classificationActive=false 면 분류 보기를 모두 전체로 접는다(옛 링크로도 메일이 숨지 않게).
 * inAppSelection — ?messageId 가 앱 안 행 열기(히스토리 열림 마크)로 붙은 것인가. 그렇다면 딥링크가 아니다.
 */
export function resolveMailView(
  params: URLSearchParams,
  classificationActive: boolean,
  opts: { inAppSelection?: boolean; folders?: readonly MailServerFolder[] } = {},
): MailView {
  const unread = params.get('unread') === 'true'
  if (params.get('folder') === 'sent') {
    return { kind: 'sent', apiCategory: '', activeCategory: null, unreadOnly: false, unreadToggleVisible: false, title: '보낸편지함', breadcrumb: ['보낸편지함'], key: 'sent', folderId: null }
  }
  if (params.get('folder') === 'drafts') {
    return { kind: 'drafts', apiCategory: '', activeCategory: null, unreadOnly: false, unreadToggleVisible: false, title: '임시보관함', breadcrumb: ['임시보관함'], key: 'drafts', folderId: null }
  }
  // 서버 메일함 — 딥링크 판정보다 먼저 본다(?box=5&messageId=9 는 그 메일함에서 연 메일). 분류·회신필요는 쓰지 않는다.
  const boxId = Number(params.get(MAIL_BOX_PARAM))
  if (Number.isInteger(boxId) && boxId > 0) {
    // 제목·경로는 메일함 목록이 오면 채운다. key 는 이름·목록 로딩과 무관하게 id 로만 — 바뀌면 유지 행이 비워진다.
    const f = opts.folders?.find((x) => x.id === boxId)
    const path = opts.folders ? folderNamePath(opts.folders, boxId) : []
    const title = f ? (f.role === 'ARCHIVE' ? ARCHIVE_LABEL : f.displayName) : '메일함'
    const breadcrumb = f?.role === 'ARCHIVE' ? [ARCHIVE_LABEL] : ['내 메일함', ...(path.length ? path : [title])]
    return {
      kind: 'folder', apiCategory: '', activeCategory: null, unreadOnly: unread, unreadToggleVisible: true,
      title, breadcrumb, key: `folder:${boxId}:${unread}`, folderId: boxId,
    }
  }
  if (params.get('needsReply') === 'true') {
    return { kind: 'needsReply', apiCategory: '', activeCategory: null, unreadOnly: false, unreadToggleVisible: false, title: '회신필요', breadcrumb: ['회신필요'], key: 'needsReply', folderId: null }
  }
  const raw = params.get('category')
  // 딥링크(?messageId=N, category 없음)는 홈 위젯·알림 등 외부 진입이라 메일의 분류를 알 수 없다 → 전체 보기로 열어
  // 어떤 분류의 메일이든 목록에 보이게 한다. 행 열기도 ?messageId 를 push 하므로(WP-206) 앱 안 선택은 제외한다 —
  // 제외하지 않으면 업무 보기에서 행을 누르는 순간 보기·목록 쿼리가 전체로 바뀌어 목록이 갈리고 스크롤이 사라진다(WP-218).
  const deepLink = raw == null && Number(params.get('messageId')) > 0 && !opts.inAppSelection
  const base = { unreadOnly: unread, unreadToggleVisible: true, folderId: null }
  if (!classificationActive || raw === 'all' || deepLink) {
    return { ...base, kind: 'all', apiCategory: '', activeCategory: null, title: INBOX, breadcrumb: [INBOX], key: `all:${unread}` }
  }
  if (isCategory(raw) && raw !== '업무') {
    return { ...base, kind: 'category', apiCategory: raw, activeCategory: raw, title: raw, breadcrumb: [INBOX, raw], key: `cat:${raw}:${unread}` }
  }
  return { ...base, kind: 'work', apiCategory: '업무', activeCategory: '업무', title: '업무', breadcrumb: [INBOX, '업무'], key: `work:${unread}` }
}

/** 보기 링크 — 업무(기본)는 쿼리 없이, 그 외는 category, 서버 메일함은 ?box=<id>. 토글 상태는 유지한다. */
export function mailViewHref(
  accountId: number,
  view: 'work' | 'all' | MailCategory | { folderId: number },
  unreadOnly: boolean,
): string {
  const q = new URLSearchParams()
  if (typeof view === 'object') q.set(MAIL_BOX_PARAM, String(view.folderId))
  else if (view !== 'work' && view !== '업무') q.set('category', view)
  if (unreadOnly) q.set('unread', 'true')
  const s = q.toString()
  return s ? `/mail/${accountId}?${s}` : `/mail/${accountId}`
}

/**
 * WP-187 보기에 해당하는 안 읽은 수 — 모두 읽음 버튼 비활성 판단용.
 * work=업무 버킷, all=받은편지함 전체, category=해당 분류, needsReply=회신필요. 보낸편지함·임시보관함은 안 읽음 개념이 없어 0.
 * folder=그 메일함의 서버 안 읽은 수 — 목록을 아직 못 받았거나 서버가 모르면(null) null(모름 — 0 으로 보고 버튼을 끄지 않는다).
 */
export function unreadCountForView(
  view: MailView,
  counts: MailUnreadCounts,
  folders?: readonly MailServerFolder[],
): number | null {
  switch (view.kind) {
    case 'folder':
      return folders?.find((f) => f.id === view.folderId)?.unreadCount ?? null
    case 'work':
      return counts.byCategory['업무'] ?? 0
    case 'all':
      return counts.inbox
    case 'category':
      return view.activeCategory ? (counts.byCategory[view.activeCategory] ?? 0) : 0
    case 'needsReply':
      return counts.needsReply
    case 'sent':
    case 'drafts':
      return 0
  }
}
