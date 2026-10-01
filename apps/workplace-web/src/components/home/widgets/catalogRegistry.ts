import {
  Bell,
  CalendarDays,
  ClipboardList,
  Contact,
  Folder,
  Hash,
  ListTodo,
  type LucideIcon,
  Mail,
} from 'lucide-react'

import {
  ActivitySummary,
  CalendarSummary,
  ChannelsSummary,
  ContactsSummary,
  DriveSummary,
  IssueListSummary,
  MailListSummary,
  ProjectsSummary,
  WikiSummary,
} from './mobile/summaries/catalogSummaries'
import type { MobileWidgetDef } from './mobile/types'

// ---------------------------------------------------------------------------
// 카탈로그 위젯 레지스트리 — 대시보드에 다중 인스턴스로 추가 가능한 위젯 메타데이터.
// 렌더링은 신규 컴포넌트를 만들지 않고 chatWidgetRegistry(AI 챗 위젯)를 그대로 재사용한다.
// 시스템 위젯(registry.ts)과 분리: 이쪽은 params 기반 + 동일 타입 다중 추가 허용.
// 키는 chatWidgetRegistry 의 WidgetType, 백엔드 DashboardService.CATALOG_WIDGETS 와 일치해야 한다.
// ---------------------------------------------------------------------------

/** 설정 폼 필드 하나 — select/text/boolean 세 종류만 지원(YAGNI, 엔티티 피커는 범위 밖). */
export type CatalogFieldDef =
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: 'text'; placeholder?: string }
  | { key: string; label: string; kind: 'boolean' }

export interface CatalogWidget {
  type: string
  title: string
  /** 위젯 추가 모달 프리뷰 패널에 노출되는 1줄 용도 설명. */
  description: string
  icon: LucideIcon
  category: string
  /** 그리드 크기 표기(카드 갤러리 UI 전용, row-span 미연동). */
  size: '1×1' | '1×2'
  /** 추가 즉시 적용되는 기본 params — 필터 없이 바로 위젯이 렌더된다. */
  defaultParams: Record<string, unknown>
  /** 설정 팝오버에 렌더할 필드 목록. 빈 배열이면 "필터 없음" 위젯(예: 채널/프로젝트/드라이브). */
  fields: CatalogFieldDef[]
  /**
   * 헤더 딥링크 생성기(#807) — 고정 문자열이 아니라 위젯 params 를 받아 "위젯이 보고 있는 것과 같은 화면"의
   * URL 을 만든다. 대상 화면 URL 쿼리에 대응이 없는 params 는 조용히 버리고 모듈 루트로 폴백한다.
   */
  deepLink: (params: CatalogParams) => string
  /** 모바일 표시(WP-142) — 카탈로그 위젯은 좁은 화면에서 모두 타일형(한 줄, 탭하면 deepLink). */
  mobile: MobileWidgetDef
}

/** 위젯 params — 저장 레이아웃의 params 는 null/undefined 일 수 있어 느슨하게 받는다. */
type CatalogParams = Record<string, unknown> | null | undefined

/** 문자열 param 하나를 trim 해 읽는다. 비문자열·빈 값은 undefined. */
function str(params: CatalogParams, key: string): string | undefined {
  const v = params?.[key]
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

/** 값이 있는 항목만 URL 쿼리(`?a=b&c=d`)로 직렬화. 비면 빈 문자열. */
function qs(entries: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(entries)) if (v !== undefined) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const CATALOG_CATEGORIES = [
  '이슈',
  '메일',
  '캘린더',
  '노트',
  '연락처',
  '프로젝트',
  '드라이브',
  '채널·활동',
] as const

const catalogRegistry: Record<string, CatalogWidget> = {
  issue_list: {
    type: 'issue_list',
    title: '이슈 목록',
    description: '내가 담당한 이슈를 우선순위 순으로 보여줍니다.',
    icon: ListTodo,
    category: '이슈',
    size: '1×1',
    defaultParams: { assignee: 'me' },
    fields: [
      {
        key: 'assignee',
        label: '담당자',
        kind: 'select',
        options: [
          { value: 'me', label: '나' },
          { value: 'all', label: '전체' },
        ],
      },
      // 플레이스홀더는 앱 이슈 상태 enum(TODO/IN_PROGRESS/DONE/CANCELED)과 일치해야 딥링크 대상 화면이 인식한다.
      { key: 'status', label: '상태', kind: 'text', placeholder: '예: TODO,IN_PROGRESS' },
      { key: 'priority', label: '우선순위', kind: 'text', placeholder: '예: HIGH' },
    ],
    // assignee=me → 내 작업(할당) 탭. status/priority 는 CSV 그대로 전달(대상 화면 parseFilters 가 미지원 토큰을
    // 걸러낸다). assignee=all 은 전역 이슈 목록 화면이 없어 /projects 로 폴백(필터 폐기).
    deepLink: (params) => {
      if (str(params, 'assignee') === 'all') return '/projects'
      return `/me/tasks/assigned${qs({
        status: str(params, 'status'),
        priority: str(params, 'priority'),
      })}`
    },
    mobile: { body: false, Summary: IssueListSummary },
  },
  mail_list: {
    type: 'mail_list',
    title: '메일 목록',
    description: '선택한 폴더의 최근 메일을 보여줍니다.',
    icon: Mail,
    category: '메일',
    size: '1×1',
    // 계정(accountId) 선택은 엔티티 피커가 필요해 범위 밖 — 미지정 시 위젯이 첫 계정으로 기본 처리(알려진 한계).
    defaultParams: { folder: 'INBOX' },
    fields: [
      {
        key: 'folder',
        label: '폴더',
        kind: 'select',
        options: [
          { value: 'INBOX', label: '받은편지함' },
          { value: 'SENT', label: '보낸편지함' },
        ],
      },
      { key: 'unreadOnly', label: '읽지 않음만', kind: 'boolean' },
    ],
    // 메일함은 ?folder=sent(소문자)만 인식. unreadOnly 는 URL 대응이 없어 폐기(폴백).
    deepLink: (params) =>
      `/mail${qs({ folder: str(params, 'folder') === 'SENT' ? 'sent' : undefined })}`,
    mobile: { body: false, Summary: MailListSummary },
  },
  calendar: {
    type: 'calendar',
    title: '캘린더',
    description: '오늘 또는 이번 주 일정을 보여줍니다.',
    icon: CalendarDays,
    category: '캘린더',
    size: '1×1',
    defaultParams: {},
    fields: [
      {
        key: 'range',
        label: '기간',
        kind: 'select',
        options: [
          { value: 'today', label: '오늘' },
          { value: 'week', label: '이번 주' },
        ],
      },
    ],
    // 캘린더 화면은 URL 로 뷰/기간을 받지 않는다 → range 폐기, 모듈 루트 폴백.
    deepLink: () => '/calendar',
    mobile: { body: false, Summary: CalendarSummary },
  },
  activity: {
    type: 'activity',
    title: '활동 피드',
    description: '이슈 생성·변경 등 최근 활동을 보여줍니다.',
    icon: Bell,
    category: '채널·활동',
    size: '1×2',
    defaultParams: {},
    fields: [
      {
        key: 'actorKind',
        label: '작성자',
        kind: 'select',
        options: [
          { value: '', label: '전체' },
          { value: 'AGENT', label: 'AI만' },
        ],
      },
    ],
    // 전용 활동 피드 화면이 없다 — 활동 행이 이슈로 링크되므로 프로젝트 루트로 폴백(actorKind 폐기).
    deepLink: () => '/projects',
    mobile: { body: false, Summary: ActivitySummary },
  },
  wiki: {
    type: 'wiki',
    title: '노트',
    description: '접근 가능한 노트 스페이스 목록을 보여줍니다.',
    icon: ClipboardList,
    category: '노트',
    size: '1×1',
    // 스페이스(spaceId) 선택은 엔티티 피커가 필요해 범위 밖 — 미지정 시 전체 스페이스 대상 검색(알려진 한계).
    defaultParams: {},
    fields: [{ key: 'query', label: '검색어', kind: 'text', placeholder: '페이지 제목 검색' }],
    // 노트 화면은 검색어 URL 쿼리를 받지 않는다 → query 폐기, 모듈 루트 폴백.
    deepLink: () => '/wiki',
    mobile: { body: false, Summary: WikiSummary },
  },
  contacts: {
    type: 'contacts',
    title: '연락처',
    description: '구성원·외부 연락처를 검색하고 보여줍니다.',
    icon: Contact,
    category: '연락처',
    size: '1×1',
    defaultParams: {},
    fields: [
      { key: 'search', label: '검색어', kind: 'text' },
      {
        // ContactsWidget 이 읽는 ContactTypeFilter('ALL'|'MEMBER'|'EXTERNAL'|'FAVORITE')와 값 일치 필수.
        key: 'type',
        label: '유형',
        kind: 'select',
        options: [
          { value: 'ALL', label: '전체' },
          { value: 'MEMBER', label: '구성원' },
          { value: 'EXTERNAL', label: '외부' },
          { value: 'FAVORITE', label: '즐겨찾기' },
        ],
      },
    ],
    // 연락처 화면 URL 쿼리와 1:1 — search→q, type 은 값 동일(ALL 은 기본값이라 생략).
    deepLink: (params) => {
      const type = str(params, 'type')
      return `/contacts${qs({
        q: str(params, 'search'),
        type: type && type !== 'ALL' ? type : undefined,
      })}`
    },
    mobile: { body: false, Summary: ContactsSummary },
  },
  projects: {
    type: 'projects',
    title: '프로젝트',
    description: '참여 중인 프로젝트 목록을 보여줍니다.',
    icon: Folder,
    category: '프로젝트',
    size: '1×1',
    defaultParams: {},
    fields: [],
    deepLink: () => '/projects',
    mobile: { body: false, Summary: ProjectsSummary },
  },
  drive: {
    type: 'drive',
    title: '드라이브',
    description: '접근 가능한 드라이브 스페이스 목록을 보여줍니다.',
    icon: Folder,
    category: '드라이브',
    size: '1×1',
    defaultParams: {},
    fields: [],
    deepLink: () => '/drive',
    mobile: { body: false, Summary: DriveSummary },
  },
  channels: {
    type: 'channels',
    title: '채널',
    description: '내가 속한 채널 목록을 보여줍니다.',
    icon: Hash,
    category: '채널·활동',
    size: '1×1',
    defaultParams: {},
    fields: [],
    deepLink: () => '/chat',
    mobile: { body: false, Summary: ChannelsSummary },
  },
}

/** 키로 카탈로그 위젯 정의 조회. 미등록 키는 null. */
export function getCatalogWidget(type: string): CatalogWidget | null {
  return catalogRegistry[type] ?? null
}

/** 등록된 전체 카탈로그 위젯(레지스트리 선언 순서). 위젯 추가 모달의 카드 그리드가 사용. */
export function allCatalogWidgets(): CatalogWidget[] {
  return Object.values(catalogRegistry)
}
