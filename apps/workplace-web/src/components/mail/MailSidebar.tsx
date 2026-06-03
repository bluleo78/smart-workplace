import { Mail, Settings } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { cn } from '@/lib/utils'

import { useMailAccounts } from '../../hooks/queries/useMailAccounts'

/**
 * 메일 모듈 2차 사이드바 — 연결된 메일 계정 목록(선택 시 /mail/:accountId). 계정 추가/관리는 프로필 페이지로 연결(계정 연동은 #68 영역).
 */
export function MailSidebar() {
  const { accountId } = useParams()
  const { data: accounts, isLoading } = useMailAccounts()

  return (
    <aside
      data-testid="mail-sidebar"
      className="hidden w-60 shrink-0 flex-col border-r bg-sidebar p-3 md:flex"
    >
      <div className="mb-2 px-1 text-xs font-semibold text-muted-foreground/70">메일 계정</div>

      {isLoading ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">불러오는 중…</div>
      ) : !accounts || accounts.length === 0 ? (
        <div data-testid="mail-no-account" className="px-3 py-2 text-sm text-muted-foreground">
          연결된 계정이 없습니다
        </div>
      ) : (
        <nav className="space-y-1">
          {accounts.map((a) => {
            const active = String(a.id) === accountId
            return (
              <Link
                key={a.id}
                to={`/mail/${a.id}`}
                data-testid={`mail-account-${a.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                <Mail className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{a.emailAddress}</span>
              </Link>
            )
          })}
        </nav>
      )}

      {/* 계정 추가/관리 — 프로필 설정으로 */}
      <Link
        to="/profile"
        data-testid="mail-manage-accounts"
        className="mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted-foreground hover:bg-accent/50"
      >
        <Settings className="h-4 w-4 shrink-0" />
        계정 관리
      </Link>
    </aside>
  )
}
