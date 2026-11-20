import { Archive, Check, ChevronDown, Clock, FilePen, Inbox, Mail, PenSquare, Send, Settings, Star, Tag, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { LoadErrorState } from '@/components/LoadErrorState'
import { useCloseSheetAfterMenu } from '@/components/mobile/MobileSidebarSheetContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { hasOpenMark } from '@/lib/historyParam'
import { buildMailFolderTree, TRASH_LABEL } from '@/lib/mailFolders'
import { FLAGGED_LABEL, mailClassificationActive, mailViewHref, resolveMailView } from '@/lib/mailView'
import { failedWithoutData } from '@/lib/queryFailure'
import { SELECTED_NAV_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import { MAIL_CATEGORIES } from '@/types/mailMessage'

import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import { useMailDraftCount } from '../../hooks/queries/useMailDrafts'
import { useMailFolders, useUnreadCounts } from '../../hooks/queries/useMailMessages'
import { useMailCompose } from './MailComposeContext'
import { MailFolderTree } from './MailFolderTree'

/**
 * 메일 모듈 2차 사이드바 — 공유 셸(타이틀 헤더) 보존 + 계정 스위처 + 편지쓰기
 * + 폴더 nav(받은편지함 + 하위 분류 + 별표(WP-1742) + 보낸편지함 + 임시보관함 + 보관 + 휴지통(WP-1681)) + 내 메일함 트리(WP-961) + 회신필요.
 * 폴더/계정 상태는 URL(:accountId, ?folder, ?box) 단일 소스. accountId 미지정 시 첫 계정을 현재로 본다.
 * WP-1761: 계정 목록 조회 실패는 「연결된 계정이 없습니다」와 구분해 오류 줄 + 다시 시도를 보인다.
 */
export function MailSidebar() {
  const { accountId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const accountsQuery = useMailAccounts()
  const { data: accounts, isLoading } = accountsQuery
  // WP-1761: 실패 뒤 재조회 동안 TanStack Query 는 data 없는 쿼리를 pending(isLoading)으로 되돌린다 — 앱 공용 판정(failedWithoutData)으로
  // 오류 줄을 유지하며, 한 번만 계산해 실패 분기를 로딩 분기보다 먼저 둔다. 이미 받은 목록이 있으면(백그라운드 재조회 실패) 거짓이라 화면을 덮지 않는다.
  const accountsFailed = failedWithoutData(accountsQuery)
  const { openCompose } = useMailCompose()
  // 계정 전환 메뉴 항목은 링크가 아니라 시트가 자동으로 닫히지 않는다 — 메뉴가 닫힌 뒤 시트를 닫는다(WP-578).
  const accountMenu = useCloseSheetAfterMenu()

  // 현재 계정: URL 파라미터 우선, 없으면 첫 계정(페이지의 /mail → 첫 계정 리다이렉트와 일치).
  const current = accounts?.find((a) => String(a.id) === accountId) ?? accounts?.[0] ?? null

  // WP-186: 안 읽은 수(회신필요 포함) + AI 분류 활성 여부. 로딩 중에는 활성으로 가정해 깜빡임을 줄인다.
  const { data: counts } = useUnreadCounts(current?.id)
  // WP-577 임시보관함 개수 — 앱 서버 임시저장(IMAP 폴더 아님).
  const { data: draftCount } = useMailDraftCount(current?.id)
  // WP-961 서버 메일함(보관·내 메일함) — 보관은 기본 메일함 줄, 나머지는 「내 메일함」 트리.
  const { data: folders } = useMailFolders(current?.id)
  // WP-1681 서버 휴지통 — 「보관」 아래 기본 메일함 줄. 서버가 목록에 줄 때만 보인다. 보관·휴지통은 트리 빌더가 이미 가려 주므로 거기서 받는다.
  const { archive, trash } = useMemo(() => buildMailFolderTree(folders ?? []), [folders])
  // 앱 안에서 연 메일(열림 마크)은 딥링크로 보지 않는다 — 페이지와 같은 판정이라 활성 표시가 어긋나지 않는다(WP-218).
  const location = useLocation()
  // 분류 상태는 메일함 화면과 같은 판정 — 계수가 오기 전에는 계정 목록 값(WP-1674).
  const classificationActive = mailClassificationActive(counts, current)
  const view = resolveMailView(params, classificationActive, {
    inAppSelection: hasOpenMark(location.state, 'messageId'),
    folders,
  })

  // 빈 새 메일 작성 도크 오픈(현재 계정으로). 새 작성이라 작성 방식 기본값(읽기 창·우측 하단·새 창, WP-1744)대로 연다.
  function onCompose() {
    if (!current) return
    openCompose(
      {
        mode: 'new',
        accountId: current!.id,
        to: [], cc: [], bcc: [], subject: '', initialHtml: '', inReplyToMessageId: null,
        quote: null,
      },
      { placement: 'default' },
    )
  }

  // WP-186: 안 읽은 수 pill(받은편지함·분류·회신필요 공용), 0 이면 숨김. 활성 항목은 primary 로 강조. label 은 스크린리더용.
  const count = (n: number | undefined, testId: string, strong = false, label = `안 읽은 메일 ${n}개`) =>
    n ? (
      <span
        data-testid={testId}
        aria-label={label}
        className={cn(
          'ml-auto rounded-full px-2 py-0.5 text-xs',
          // 활성 행(bg-selected) 위에서도 pill 형태가 보이도록 활성 pill 은 background 로.
          strong ? 'bg-background font-semibold text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        {n}
      </span>
    ) : null

  // 폴더 nav 항목 공통 클래스(active = 현재 폴더).
  const folderClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
      active ? SELECTED_NAV_CLASS : 'text-muted-foreground hover:bg-accent/50',
    )

  return (
    // 랜드마크 이름(WP-1774) — 같은 화면의 aside·nav 를 스크린리더가 구분하도록 접근 이름을 붙인다.
    <aside
      data-testid="mail-sidebar"
      aria-label="메일 사이드바"
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 아이콘 + 이름으로 "메일" 앱임을 명시(공유 셸, 불변) */}
      <div className={sidebarTitleClass}>
        <Mail className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        메일
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {accountsFailed ? (
          // WP-1761: 목록을 못 받았을 때(앱 공용 실패 안내) — 판정 설명은 위 accountsFailed 주석.
          <LoadErrorState variant="inline" title="계정을 불러오지 못했습니다" queries={[accountsQuery]} testId="mail-sidebar-accounts-error" />
        ) : isLoading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">불러오는 중…</div>
        ) : !accounts || accounts.length === 0 ? (
          <div data-testid="mail-no-account" className="px-3 py-2 text-sm text-muted-foreground">
            연결된 계정이 없습니다
          </div>
        ) : (
          <>
            {/* 계정 스위처 — 현재 계정 표시 + 드롭다운 전환(폴더는 INBOX 로 초기화) */}
            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="mail-account-switcher"
                className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium hover:bg-accent/50"
              >
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{current!.emailAddress}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-52"
                onCloseAutoFocus={accountMenu.onCloseAutoFocus}
              >
                {accounts.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    data-testid={`mail-account-${a.id}`}
                    onSelect={() => {
                      accountMenu.closeAfterMenu()
                      navigate(`/mail/${a.id}`)
                    }}
                    className="gap-2"
                  >
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{a.emailAddress}</span>
                    {String(a.id) === String(current!.id) && (
                      <Check className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 편지쓰기 — 빈 새 메일 도크 오픈(현재 계정) */}
            <button
              type="button"
              data-testid="mail-compose-new"
              // 모바일 시트가 남으면(z-50, body 포탈) 같은 z-50 인 작성 도크를 덮는다 — 누르면 시트를 닫는다(WP-578).
              data-sheet-dismiss
              onClick={onCompose}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <PenSquare className="h-4 w-4" /> 편지쓰기
            </button>

            {/* 폴더 nav — 받은편지함/보낸편지함(현재 계정 기준, URL ?folder 로 active) */}
            <nav aria-label="메일함" className="mt-4 space-y-1" data-testid="mail-folder-toggle">
              {/* 받은편지함 = 전체 보기(하위 분류와 상호배타로 active) */}
              <Link
                to={mailViewHref(current!.id, 'all', view.unreadOnly)}
                data-testid="mail-folder-inbox"
                aria-current={view.kind === 'all' ? 'page' : undefined}
                className={folderClass(view.kind === 'all')}
              >
                <Inbox className="h-4 w-4 shrink-0" /> 받은편지함
                {count(counts?.inbox, 'mail-count-inbox', view.kind === 'all')}
              </Link>
              {classificationActive && (
                // WP-186: 분류는 받은편지함의 하위 보기 — 들여 쓰고 안 읽은 수를 붙인다. 업무 = 업무 + 미분류(기본 보기).
                <div className="space-y-1" data-testid="mail-inbox-categories">
                  {MAIL_CATEGORIES.map((cat) => {
                    const active = view.activeCategory === cat
                    return (
                      <Link
                        key={cat}
                        to={mailViewHref(current!.id, cat, view.unreadOnly)}
                        data-testid={`mail-filter-category-${cat}`}
                        aria-current={active ? 'page' : undefined}
                        className={cn(folderClass(active), 'pl-9')}
                      >
                        <Tag className="h-4 w-4 shrink-0" /> {cat}
                        {count(counts?.byCategory[cat], `mail-count-category-${cat}`, active)}
                      </Link>
                    )
                  })}
                </div>
              )}
              {/* WP-1742 별표 — 모든 메일함(휴지통 제외)의 별표 메일 모아 보기. 받은편지함 묶음 바로 아래, 보낸편지함 위.
                  숫자는 안 읽은 수가 아니라 별표 메일 수라 이름표도 그렇게 읽힌다(0 이면 숨김). */}
              <Link
                to={mailViewHref(current!.id, 'flagged', view.unreadOnly)}
                data-testid="mail-folder-flagged"
                aria-current={view.kind === 'flagged' ? 'page' : undefined}
                className={folderClass(view.kind === 'flagged')}
              >
                <Star className="h-4 w-4 shrink-0" /> {FLAGGED_LABEL}
                {count(counts?.flagged, 'mail-count-flagged', view.kind === 'flagged', `별표한 메일 ${counts?.flagged}개`)}
              </Link>
              <Link
                to={`/mail/${current!.id}?folder=sent`}
                data-testid="mail-folder-sent"
                aria-current={view.kind === 'sent' ? 'page' : undefined}
                className={folderClass(view.kind === 'sent')}
              >
                <Send className="h-4 w-4 shrink-0" /> 보낸편지함
              </Link>
              {/* WP-577 임시보관함 — 쓰다가 닫은 메일. 배지는 안 읽은 수가 아니라 임시저장 개수라 이름표도 그렇게 읽힌다. */}
              <Link
                to={`/mail/${current!.id}?folder=drafts`}
                data-testid="mail-folder-drafts"
                aria-current={view.kind === 'drafts' ? 'page' : undefined}
                className={folderClass(view.kind === 'drafts')}
              >
                <FilePen className="h-4 w-4 shrink-0" /> 임시보관함
                {count(draftCount?.count, 'mail-count-drafts', view.kind === 'drafts', `임시저장 ${draftCount?.count}개`)}
              </Link>
              {/* WP-1787 예약됨 — 보낼 시각을 정해 둔 메일. 배지는 예약 개수. */}
              <Link
                to={`/mail/${current!.id}?folder=scheduled`}
                data-testid="mail-folder-scheduled"
                aria-current={view.kind === 'scheduled' ? 'page' : undefined}
                className={folderClass(view.kind === 'scheduled')}
              >
                <Clock className="h-4 w-4 shrink-0" /> 예약됨
                {count(draftCount?.scheduled, 'mail-count-scheduled', view.kind === 'scheduled', `예약 ${draftCount?.scheduled}개`)}
              </Link>
              {/* WP-961 보관 — 서버에 보관 메일함이 있을 때만. 이름은 서버 이름(Archive 등)과 무관하게 「보관」. */}
              {archive && (
                <Link
                  to={mailViewHref(current!.id, { folderId: archive.id }, view.unreadOnly)}
                  data-testid="mail-folder-archive"
                  aria-current={view.folderId === archive.id ? 'page' : undefined}
                  className={folderClass(view.folderId === archive.id)}
                >
                  <Archive className="h-4 w-4 shrink-0" /> 보관
                  {count(archive.unreadCount ?? undefined, 'mail-count-archive', view.folderId === archive.id)}
                </Link>
              )}
              {/* WP-1681 휴지통 — 이름은 서버 이름(Trash·Deleted Items 등)과 무관하게 「휴지통」. 지운 메일이라 안 읽은 수는 보이지 않는다.
                  안 읽음 거르기도 이어 가지 않는다 — 지운 메일을 찾으러 가는 곳이라 늘 거르지 않은 목록으로 연다. */}
              {trash && (
                <Link
                  to={mailViewHref(current!.id, { folderId: trash.id }, false)}
                  data-testid="mail-folder-trash"
                  aria-current={view.folderId === trash.id ? 'page' : undefined}
                  className={folderClass(view.folderId === trash.id)}
                >
                  <Trash2 className="h-4 w-4 shrink-0" /> {TRASH_LABEL}
                </Link>
              )}
            </nav>

            {/* WP-961 내 메일함 — 사용자가 만든 서버 메일함 트리. 하나도 없으면 구역째 숨는다. 계정이 바뀌면 접힘 상태를 새로 읽는다. */}
            {folders && (
              <MailFolderTree
                key={current!.id}
                accountId={current!.id}
                folders={folders}
                activeFolderId={view.folderId}
                unreadOnly={view.unreadOnly}
                countPill={count}
              />
            )}

            {/* P2·WP-146: AI 필터 — 회신필요(AI 판정 && 안 읽음) 건수. 건수 > 0 일 때만 표시. */}
            {(counts?.needsReply ?? 0) > 0 && (
              <>
                <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  AI 필터
                </div>
                <nav aria-label="AI 필터" className="mt-1 space-y-1">
                  <Link
                    to={`/mail/${current!.id}?needsReply=true`}
                    data-testid="mail-filter-needsreply"
                    // WP-146: 열면 빠진다는 규칙을 호버로 안내
                    title="안 읽은 메일 중 AI가 회신이 필요하다고 본 메일 (열면 빠져요)"
                    aria-current={view.kind === 'needsReply' ? 'page' : undefined}
                    className={folderClass(view.kind === 'needsReply')}
                  >
                    {/* 회신필요 강조 점 — primary 색상 */}
                    <span className="text-primary">●</span> 회신필요
                    {count(counts?.needsReply, 'mail-count-needsreply', false, `${counts?.needsReply}개`)}
                  </Link>
                </nav>
              </>
            )}
          </>
        )}

        {/* 계정 추가/관리 — 설정 > 메일 계정으로 */}
        <Link
          to="/settings/mail"
          data-testid="mail-manage-accounts"
          className="mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50"
        >
          <Settings className="h-4 w-4 shrink-0" /> 계정 관리
        </Link>
      </div>
    </aside>
  )
}
