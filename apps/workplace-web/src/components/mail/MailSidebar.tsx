import { Check, ChevronDown, Inbox, Mail, PenSquare, Send, Settings, Tag } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { useMailAccounts } from '../../hooks/queries/useMailAccounts'
import { useNeedsReplyCount } from '../../hooks/queries/useMailMessages'
import { useMailCompose } from './MailComposeContext'

/**
 * 메일 모듈 2차 사이드바 — 공유 셸(타이틀 헤더) 보존 + 계정 스위처 + 편지쓰기 + 폴더 nav.
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
  // 현재 폴더: ?folder=sent → SENT, 기본 INBOX(폴더 nav active 판정용).
  const folder = params.get('folder') === 'sent' ? 'SENT' : 'INBOX'

  // P2: 회신필요 건수(사이드바 배지 + AI 필터 섹션 표시 여부 판단).
  const { data: needsReplyCount } = useNeedsReplyCount(current?.id)
  // P2: URL 필터 상태 — needsReply > category > 받은편지함(plain) 우선순위.
  const activeNeedsReply = params.get('needsReply') === 'true'
  const activeCategory = params.get('category') ?? ''
  // 받은편지함 active = INBOX 이면서 필터 미적용일 때만(필터 적용 중엔 해제).
  const inboxPlain = folder === 'INBOX' && !activeCategory && !activeNeedsReply

  // P2: AI 분류 카테고리(고정 5종, 순서 유지). ⚠️ 백엔드 MailAiService.CATEGORIES 와 값·순서 일치 유지(분류 필터가 이 값으로 조회)
  const CATEGORIES = ['업무', '개인', '알림', '프로모션', '뉴스레터'] as const

  // 빈 새 메일 작성 도크 오픈(현재 계정으로).
  function onCompose() {
    if (!current) return
    openCompose({
      accountId: current.id,
      to: [], cc: [], bcc: [], subject: '', initialHtml: '', inReplyToMessageId: null,
    })
  }

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
                <span className="min-w-0 flex-1 truncate">{current?.emailAddress}</span>
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
                    {String(a.id) === String(current?.id) && (
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
              {/* 받은편지함: 필터 미적용 상태일 때만 active(필터 nav 와 상호배타) */}
              <Link
                to={`/mail/${current?.id}`}
                data-testid="mail-folder-inbox"
                aria-current={inboxPlain ? 'page' : undefined}
                className={folderClass(inboxPlain)}
              >
                <Inbox className="h-4 w-4 shrink-0" /> 받은편지함
              </Link>
              <Link
                to={`/mail/${current?.id}?folder=sent`}
                data-testid="mail-folder-sent"
                aria-current={folder === 'SENT' ? 'page' : undefined}
                className={folderClass(folder === 'SENT')}
              >
                <Send className="h-4 w-4 shrink-0" /> 보낸편지함
              </Link>
            </nav>

            {/* P2: AI 필터 — 회신필요 미처리 건수. 건수 > 0 일 때만 표시. */}
            {needsReplyCount != null && needsReplyCount > 0 && (
              <>
                <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  AI 필터
                </div>
                <nav className="mt-1 space-y-1">
                  <Link
                    to={`/mail/${current?.id}?needsReply=true`}
                    data-testid="mail-filter-needsreply"
                    aria-current={activeNeedsReply ? 'page' : undefined}
                    className={folderClass(activeNeedsReply)}
                  >
                    {/* 회신필요 강조 점 — primary 색상 */}
                    <span className="text-primary">●</span> 회신필요
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {needsReplyCount}
                    </span>
                  </Link>
                </nav>
              </>
            )}

            {/* P2: 분류 — AI 분류별 좁혀보기(라벨만, 건수 없음). 고정 5종, 순서 유지. */}
            <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              분류
            </div>
            <nav className="mt-1 space-y-1">
              {CATEGORIES.map((cat) => (
                <Link
                  key={cat}
                  to={`/mail/${current?.id}?category=${encodeURIComponent(cat)}`}
                  data-testid={`mail-filter-category-${cat}`}
                  aria-current={activeCategory === cat ? 'page' : undefined}
                  className={folderClass(activeCategory === cat)}
                >
                  <Tag className="h-4 w-4 shrink-0" /> {cat}
                </Link>
              ))}
            </nav>
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
