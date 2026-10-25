// apps/workplace-web/src/components/layout/SettingsSidebar.tsx
// 설정 앱 2차 사이드바 — 개인 설정(전체) + 워크스페이스 관리·앱 설정(어드민 전용) 3그룹.
// 앱 설정(WP-887): 앱마다 항목 하나(시안 A) — 들어가면 그 앱의 설정 묶음. 앱 설정이 늘어도 사이드바는 앱 수만큼만 는다.
import { Bell, BookOpen, Bot, FileText, KeyRound, LayoutList, Link2, LogIn, Mail, Settings, Shield, User, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'
import { useAuth } from '@/hooks/useAuth'

// 개인 설정 — 모든 로그인 사용자에게 노출.
const PERSONAL_ITEMS = [
  { label: '프로필', href: '/settings/profile', icon: User },
  { label: '메일 계정', href: '/settings/mail', icon: Mail },
  { label: '알림', href: '/settings/notifications', icon: Bell },
  { label: 'AI 비서', href: '/settings/assistant', icon: Bot },
  { label: 'API 토큰', href: '/settings/tokens', icon: KeyRound },
  // WP-579 내가 만든 노트 공유 링크.
  { label: '내 공유', href: '/settings/my-shares', icon: Link2 },
]

// 워크스페이스 관리 — 어드민에게만 노출. 앱마다 다른 설정은 아래 「앱 설정」으로 간다.
const ADMIN_ITEMS = [
  { label: '구성원', href: '/settings/users', icon: Users },
  { label: '에이전트', href: '/settings/agents', icon: Bot },
  { label: '역할', href: '/settings/roles', icon: Shield },
  { label: 'SSO', href: '/settings/sso', icon: LogIn },
  { label: '감사 로그', href: '/settings/audit-logs', icon: FileText },
]

// 앱 설정 — 어드민에게만 노출. 아이콘은 사이드 레일(AppRail)의 앱 아이콘과 같게 둔다.
const APP_ITEMS = [
  // WP-887 이슈 관계 유형.
  { label: '작업 관리', href: '/settings/apps/work', icon: LayoutList },
  // WP-579 외부 공유 정책·전체 공유 목록(옛 「워크스페이스 관리 › 노트 공유」).
  { label: '노트', href: '/settings/apps/wiki', icon: BookOpen },
]

// 사이드바 그룹 헤더 — 섹션 구분용 소형 라벨.
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">{children}</p>
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

        {/* 워크스페이스 관리·앱 설정 — 어드민에게만 렌더(라우트 가드와 이중 게이팅) */}
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
            <GroupLabel>앱 설정</GroupLabel>
            <nav className="space-y-1" data-testid="settings-apps-group">
              {APP_ITEMS.map(({ label, href, icon: Icon }) => (
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
