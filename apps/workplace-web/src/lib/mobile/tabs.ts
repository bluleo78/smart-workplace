// 모바일 하단 탭 레지스트리 — 탭바·더보기 그리드·탭 편집이 공유하는 단일 정의.
// match 는 해당 탭이 "활성"으로 보일 경로 범위(상세 경로 포함).
import {
  Bell, BookOpen, CalendarDays, HardDrive, Home, LayoutList, type LucideIcon, Mail, MessageSquare, Users,
} from 'lucide-react'

export type MobileTabId =
  | 'home' | 'chat' | 'mail' | 'calendar' | 'tasks' | 'drive' | 'wiki' | 'contacts' | 'notifications'

export interface MobileTabDef {
  id: MobileTabId
  label: string
  icon: LucideIcon
  path: string
  match: (pathname: string) => boolean
}

/** 접두 경로 매칭 헬퍼 — '/chat' 은 '/chat', '/chat/…' 만('/chatx' 제외). 탭 match·경로 판정·더보기 활성 판정이 공유. */
export const under = (...prefixes: string[]) => (p: string) =>
  prefixes.some((x) => p === x || p.startsWith(`${x}/`))

/** 탭바·더보기 그리드에 노출 가능한 앱 레지스트리 — match 는 현재 경로가 이 탭에 속하는지 판정. */
export const MOBILE_TABS: Record<MobileTabId, MobileTabDef> = {
  home: { id: 'home', label: '홈', icon: Home, path: '/', match: (p) => p === '/' },
  chat: { id: 'chat', label: '채팅', icon: MessageSquare, path: '/chat', match: under('/chat') },
  mail: { id: 'mail', label: '메일', icon: Mail, path: '/mail', match: under('/mail') },
  calendar: { id: 'calendar', label: '캘린더', icon: CalendarDays, path: '/calendar', match: under('/calendar') },
  tasks: { id: 'tasks', label: '작업', icon: LayoutList, path: '/tasks', match: under('/tasks', '/projects', '/me') },
  drive: { id: 'drive', label: '드라이브', icon: HardDrive, path: '/drive', match: under('/drive') },
  wiki: { id: 'wiki', label: '노트', icon: BookOpen, path: '/wiki', match: under('/wiki') },
  contacts: { id: 'contacts', label: '연락처', icon: Users, path: '/contacts', match: under('/contacts') },
  notifications: { id: 'notifications', label: '알림', icon: Bell, path: '/notifications', match: under('/notifications') },
}

export const ALL_TAB_IDS = Object.keys(MOBILE_TABS) as MobileTabId[]
