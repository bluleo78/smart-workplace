import { Check, ChevronDown, Inbox, Mail, PenSquare, Send, Settings, Tag } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { mailViewHref, resolveMailView } from '@/lib/mailView'
import { cn } from '@/lib/utils'
import { MAIL_CATEGORIES } from '@/types/mailMessage'

import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import { useUnreadCounts } from '../../hooks/queries/useMailMessages'
import { useMailCompose } from './MailComposeContext'

/**
 * 메일 모듈 2차 사이드바 — 공유 셸(타이틀 헤더) 보존 + 계정 스위처 + 편지쓰기
 * + 폴더 nav(받은편지함 + 하위 분류 + 보낸편지함) + 회신필요.
 * 폴더/계정 상태는 URL(:accountId, ?folder) 단일 소스. accountId 미지정 시 첫 계정을 현재로 본다.
 */
export function MailSidebar() {
  const { accountId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { data: accounts, isLoading } = useMailAccounts()
  const { openCompose } = useMailCompose()

  // 현재 계정: URL 파라미터 우선, 없으면 첫 계정(페이지의 /mail → 첫 계정 리다이렉트와 일치).
  const current = accounts?.find((a) => String(a.id) === accountId) ?? accounts?.[0] ?? null

  // WP-186: 안 읽은 수(회신필요 포함) + AI 분류 활성 여부. 로딩 중에는 활성으로 가정해 깜빡임을 줄인다.
  const { data: counts } = useUnreadCounts(current?.id)
  const view = resolveMailView(params, counts?.classificationActive ?? true)

  // 빈 새 메일 작성 도크 오픈(현재 계정으로).
  function onCompose() {
    if (!current) return
    openCompose({
      accountId: current!.id,
      to: [], cc: [], bcc: [], subject: '', initialHtml: '', inReplyToMessageId: null,
      quote: null,
    })
  }

  // WP-186: 안 읽은 수 pill(받은편지함·분류·회신필요 공용), 0 이면 숨김. 활성 항목은 primary 로 강조. label 은 스크린리더용.
  const count = (n: number | undefined, testId: string, strong = false, label = `안 읽은 메일 ${n}개`) =>
    n ? (
      <span
        data-testid={testId}
        aria-label={label}
        className={cn(
          'ml-auto rounded-full bg-muted px-2 py-0.5 text-xs',
          strong ? 'font-semibold text-primary' : 'text-muted-foreground',
        )}
      >
        {n}
      </span>
    ) : null

  // 폴더 nav 항목 공통 클래스(active = 현재 폴더).
  const folderClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
    )

  return (
    <aside
      data-testid="mail-sidebar"
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 아이콘 + 이름으로 "메일" 앱임을 명시(공유 셸, 불변) */}
      <div className={sidebarTitleClass}>
        <Mail className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        메일
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
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
              <DropdownMenuContent align="start" className="w-52">
                {accounts.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    data-testid={`mail-account-${a.id}`}
                    onSelect={() => navigate(`/mail/${a.id}`)}
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
              onClick={onCompose}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <PenSquare className="h-4 w-4" /> 편지쓰기
            </button>

            {/* 폴더 nav — 받은편지함/보낸편지함(현재 계정 기준, URL ?folder 로 active) */}
            <nav className="mt-4 space-y-1" data-testid="mail-folder-toggle">
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
              {counts?.classificationActive !== false && (
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
              <Link
                to={`/mail/${current!.id}?folder=sent`}
                data-testid="mail-folder-sent"
                aria-current={view.kind === 'sent' ? 'page' : undefined}
                className={folderClass(view.kind === 'sent')}
              >
                <Send className="h-4 w-4 shrink-0" /> 보낸편지함
              </Link>
            </nav>

            {/* P2·WP-146: AI 필터 — 회신필요(AI 판정 && 안 읽음) 건수. 건수 > 0 일 때만 표시. */}
            {(counts?.needsReply ?? 0) > 0 && (
              <>
                <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  AI 필터
                </div>
                <nav className="mt-1 space-y-1">
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
                    {count(counts?.needsReply, 'mail-count-needsreply', false, `회신필요 ${counts?.needsReply}개`)}
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
