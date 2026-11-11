// 앱 레일(AppRail)의 모듈(앱) 표와 활성 판별 — 레일 컴포넌트와 도움말 브레드크럼(앱 이름 칸, WP-1505)이 함께 쓴다.
// 컴포넌트 파일은 컴포넌트만 export 하는 규칙(react-refresh)이라 표·판별 함수를 이 파일로 꺼냈다.
import {
  BookOpen,
  CalendarDays,
  HardDrive,
  Home,
  LayoutList,
  type LucideIcon,
  Mail,
  MessageSquare,
  Settings,
  Users,
} from 'lucide-react'

import type { UnreadKind } from '@/hooks/useAppUnreadCounts'

export interface RailItem {
  label: string
  href: string
  icon: LucideIcon
  // 활성 판별용 prefix(들). 없으면 href 로 판별한다.
  // (예: 관리 모듈은 href='/admin/users'(실제 라우트)지만 '/admin/*' 전체에서 활성,
  //  이슈 모듈은 '/projects' 와 '/me'(내 태스크) 양쪽에서 활성)
  match?: string | string[]
  // 안 읽은 수 배지 출처 — 모바일 탭바와 같은 집계(useAppUnreadCounts)를 쓴다(WP-796).
  badge?: UnreadKind
}

// 활성화된 모듈 런처 항목 — 일일 사용 빈도 우선 순서.
// 소통 묶음(대화·메일)을 앞에 인접 배치, 작업관리는 그 다음, 파일/노트, 연락처는 설정 직전.
export const RAIL_MODULES: RailItem[] = [
  { label: '홈', href: '/', icon: Home },
  { label: '대화', href: '/chat', icon: MessageSquare, badge: 'chat' },
  { label: '메일', href: '/mail', icon: Mail, badge: 'mail' },
  { label: '캘린더', href: '/calendar', icon: CalendarDays },
  { label: '작업 관리', href: '/projects', icon: LayoutList, match: ['/projects', '/me'] },
  { label: '드라이브', href: '/drive', icon: HardDrive },
  { label: '노트', href: '/wiki', icon: BookOpen },
  { label: '연락처', href: '/contacts', icon: Users },
  { label: '설정', href: '/settings/profile', icon: Settings, match: ['/settings', '/admin'] },
]

// 현재 경로가 해당 모듈에 속하는지 판별. 홈('/')은 정확히 일치할 때만 활성.
// 활성 판별 prefix 는 item.match(문자열/배열) 우선, 없으면 href.
// (관리 모듈이 /admin/* 전체에서, 이슈 모듈이 /projects·/me 전체에서 활성이 되도록)
export function isRailItemActive(pathname: string, item: RailItem): boolean {
  const matchPaths = item.match
    ? Array.isArray(item.match)
      ? item.match
      : [item.match]
    : [item.href]
  return matchPaths.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)))
}

/** 주소가 속한 앱 이름(레일에서 활성으로 보이는 첫 모듈의 label) — 도움말 브레드크럼 첫 칸. 어느 모듈에도 속하지 않으면 null. */
export function appLabelForPath(pathname: string): string | null {
  return RAIL_MODULES.find((item) => isRailItemActive(pathname, item))?.label ?? null
}
