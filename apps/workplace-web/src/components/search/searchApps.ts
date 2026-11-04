// 통합 검색(WP-1353)의 앱·탭 정의 — 어떤 앱을 어떤 순서로 찾고, 지금 화면이 어느 앱인지.
// 순수 모듈(아이콘 참조만)이라 브라우저 없이 테스트한다.
import {
  BookOpen,
  Bot,
  Calendar,
  CircleDot,
  FolderOpen,
  type LucideIcon,
  Mail,
  MessageSquare,
  Search,
  Users,
} from 'lucide-react'

/** 검색 대상 앱. */
export type SearchAppId = 'ai' | 'chat' | 'mail' | 'calendar' | 'issues' | 'drive' | 'wiki' | 'contacts'

/** 팔레트 탭 — 전체 또는 앱 하나. */
export type SearchTabId = 'all' | SearchAppId

/** 탭 순서는 고정(전체·AI 대화·대화·메일·캘린더·작업·드라이브·노트·연락처). */
export const SEARCH_TABS: { id: SearchTabId; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: '전체', icon: Search },
  { id: 'ai', label: 'AI 대화', icon: Bot },
  { id: 'chat', label: '대화', icon: MessageSquare },
  { id: 'mail', label: '메일', icon: Mail },
  { id: 'calendar', label: '캘린더', icon: Calendar },
  { id: 'issues', label: '작업', icon: CircleDot },
  { id: 'drive', label: '드라이브', icon: FolderOpen },
  { id: 'wiki', label: '노트', icon: BookOpen },
  { id: 'contacts', label: '연락처', icon: Users },
]

/** 경로 첫 마디 → 앱. 홈·알림·설정 같은 곳은 없다. */
const APP_BY_SEGMENT: Record<string, SearchAppId> = {
  wiki: 'wiki',
  projects: 'issues',
  drive: 'drive',
  mail: 'mail',
  chat: 'chat',
  contacts: 'contacts',
  calendar: 'calendar',
}

/** 지금 화면이 속한 앱 — 「전체」 탭에서 그 앱 결과를 맨 위에 두려고 쓴다. 앱 밖이면 null. */
export function currentAppFromPath(pathname: string): SearchAppId | null {
  const segment = pathname.split('/')[1] ?? ''
  return APP_BY_SEGMENT[segment] ?? null
}

/** 「전체」 탭의 그룹 순서 — 탭 순서에서 현재 앱을 맨 앞으로(나머지 상대 순서는 유지). */
export function groupOrder(current: SearchAppId | null): SearchAppId[] {
  const all = SEARCH_TABS.filter((t): t is (typeof SEARCH_TABS)[number] & { id: SearchAppId } => t.id !== 'all').map((t) => t.id)
  return current ? [current, ...all.filter((id) => id !== current)] : all
}
