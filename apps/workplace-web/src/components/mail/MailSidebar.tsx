import { Check, ChevronDown, Inbox, Mail, PenSquare, Send, Settings } from 'lucide-react'
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
      'flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
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
                className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] font-medium hover:bg-accent/50"
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
              <Link
                to={`/mail/${current?.id}`}
                data-testid="mail-folder-inbox"
                aria-current={folder === 'INBOX' ? 'page' : undefined}
                className={folderClass(folder === 'INBOX')}
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
          </>
        )}

        {/* 계정 추가/관리 — 설정 > 메일 계정으로 */}
        <Link
          to="/settings/mail"
          data-testid="mail-manage-accounts"
          className="mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-accent/50"
        >
          <Settings className="h-4 w-4 shrink-0" /> 계정 관리
        </Link>
      </div>
    </aside>
  )
}
