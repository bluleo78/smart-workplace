// apps/workplace-web/src/components/layout/SettingsSidebar.tsx
// 설정 앱 2차 사이드바 — 개인 설정(전체) + 워크스페이스 관리(어드민 전용) 2그룹.
import { Bot, FileText, KeyRound, Mail, Settings, Shield, User, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { useAuth } from '@/hooks/useAuth'

// 개인 설정 — 모든 로그인 사용자에게 노출.
const PERSONAL_ITEMS = [
  { label: '프로필', href: '/settings/profile', icon: User },
  { label: '메일 계정', href: '/settings/mail', icon: Mail },
  { label: 'AI 비서', href: '/settings/assistant', icon: Bot },
  { label: 'API 토큰', href: '/settings/tokens', icon: KeyRound },
]

// 워크스페이스 관리 — 어드민에게만 노출.
const ADMIN_ITEMS = [
  { label: '구성원', href: '/settings/users', icon: Users },
  { label: '에이전트', href: '/settings/agents', icon: Bot },
  { label: '역할', href: '/settings/roles', icon: Shield },
  { label: '감사 로그', href: '/settings/audit-logs', icon: FileText },
]

// 사이드바 그룹 헤더 — 섹션 구분용 소형 라벨.
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground/70">{children}</p>
  )
}

export function SettingsSidebar() {
  const { isAdmin } = useAuth()
  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
      data-testid="settings-sidebar"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일 아이콘+이름으로 "설정" 앱임을 명시(Slack 모델) */}
      <div className={sidebarTitleClass}>
        <Settings className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        설정
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <GroupLabel>개인 설정</GroupLabel>
        <nav className="space-y-1">
          {PERSONAL_ITEMS.map(({ label, href, icon: Icon }) => (
            <NavLink key={href} to={href} className={sidebarLinkClass}>
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>

        {/* 워크스페이스 관리 — 어드민에게만 렌더(라우트 가드와 이중 게이팅) */}
        {isAdmin && (
          <>
            <GroupLabel>워크스페이스 관리</GroupLabel>
            <nav className="space-y-1" data-testid="settings-admin-group">
              {ADMIN_ITEMS.map(({ label, href, icon: Icon }) => (
                <NavLink key={href} to={href} className={sidebarLinkClass}>
                  <Icon className="h-4 w-4" /> {label}
                </NavLink>
              ))}
            </nav>
          </>
        )}
      </div>
    </aside>
  )
}
