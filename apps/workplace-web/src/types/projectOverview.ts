// 프로젝트 「개요」 탭(WP-1478) — 백엔드 GET /projects/{key}/overview 응답과 1:1. 날짜는 서울 날짜 키(YYYY-MM-DD), 시각은 ISO.
// 숫자는 모두 서버가 센다 — 화면은 받은 값을 그리기만 한다(개요와 이슈 탭이 같은 조건 함수를 써 어긋나지 않게).

/** 사람·AI 구분 — AI(AGENT)는 아바타에 AI 표식을 단다. */
export type ProjectOverviewUserKind = 'HUMAN' | 'AGENT'

/**
 * 담당자·활동한 사람 한 명. 아바타 이미지는 앱 전체 아바타 주소 표(AvatarsProvider·useAvatarUrl)가 id 로 찾는다 — 응답에 주소를 싣지 않는다.
 * active false 면 정지·비활성 계정(WP-1080) — 아바타를 회색·점선으로 그린다.
 */
export interface ProjectOverviewUser {
  id: number
  name: string
  kind: ProjectOverviewUserKind
  active: boolean
}

/** 지난 7일과 그 전 7일 — 완료·새로 생김 카드(지표 모듈 값). */
export interface ProjectOverviewCompare {
  current: number
  previous: number
}

export interface ProjectOverviewCards {
  completed: ProjectOverviewCompare
  created: ProjectOverviewCompare
  /** 마감 임박 — 열린 이슈 중 마감이 오늘~6일 뒤, 그중 담당자 없음. */
  dueSoon: { count: number; unassigned: number }
  /** 기한 지남 — 열린 이슈 중 마감이 오늘보다 전. count 0 이면 oldestDays null. */
  overdue: { count: number; oldestDays: number | null }
}

/** 진행 중 그래프 대상 — 진행 중 사이클 → 가장 가까운 미출시 버전 → 프로젝트 전체 추이(TREND). */
export type ProjectProgressKind = 'CYCLE' | 'VERSION' | 'TREND'

/** 그래프 한 점 — TREND 면 scope = 그 시점 열린 이슈 수, done null. */
export interface ProjectProgressPoint {
  date: string
  scope: number
  done: number | null
}

/** 진행 중 아래 칸의 에픽 한 줄 — 자식 완료/전체. */
export interface ProjectOverviewEpic {
  issueKey: string
  /** 이슈 번호 — 상세 주소(issuePath)에 쓴다. */
  number: number
  title: string
  done: number
  total: number
}

export interface ProjectOverviewProgress {
  kind: ProjectProgressKind
  /** 사이클·버전 — TREND 면 null. 버전의 end 는 출시일. 종료일 없는 진행 중 사이클은 end null(그때 lateDays 도 null). */
  target: { id: number; name: string; start: string; end: string | null } | null
  /** 범위 이슈 수 — TREND 면 지금 열린 이슈 수. */
  total: number
  done: number | null
  points: ProjectProgressPoint[]
  /** 지금 속도로 예상한 완료일 — 속도 0·TREND 면 null. */
  projectedDate: string | null
  /** 종료일(출시일)보다 늦는 날수 — 0 이하·null 이면 늦지 않음. */
  lateDays: number | null
  /** TREND 만 — 8주 동안 열린 이슈 수 변화. */
  trendDelta: number | null
  /**
   * 닫히지 않은 에픽 — 진행 중 수 / 전체 수, 최근 움직인 순 4개.
   * epicTypeId 는 이 프로젝트의 에픽 유형 id — 「모두 보기」가 이슈 탭 유형 필터(type=id)에 쓴다. 에픽 유형이 없으면 null.
   */
  epics: { epicTypeId: number | null; inProgress: number; total: number; items: ProjectOverviewEpic[] }
}

export interface ProjectOverviewOpenIssues {
  total: number
  todo: number
  inProgress: number
  unassigned: number
}

/** 살펴볼 이슈 한 줄 — days 는 지난/멈춘/기다린 일수. */
export interface ProjectAttentionItem {
  issueKey: string
  number: number
  title: string
  days: number
  assignees: ProjectOverviewUser[]
}

/** 살펴볼 이슈 한 묶음 — 전체 수와 상위 5건. */
export interface ProjectAttentionGroup {
  total: number
  items: ProjectAttentionItem[]
}

export interface ProjectOverviewAttention {
  /** 세 묶음의 서로 다른 이슈 수(제목 옆 숫자). */
  total: number
  overdue: ProjectAttentionGroup
  stale: ProjectAttentionGroup
  waiting: ProjectAttentionGroup
}

export interface ProjectOverviewWorkload {
  /** 열린 이슈를 많이 맡은 순 5명(담당자가 여럿이면 각자 센다). */
  top: (ProjectOverviewUser & { count: number })[]
  unassigned: number
  /** 다섯 명 밖 — 사람 수와 그들이 맡은 이슈 수. */
  others: { people: number; issues: number }
}

/** 최근 활동 한 묶음 — 같은 사람·같은 종류가 이어진 이력. 서버는 1건일 때만 issue 를 싣는다(여러 건이면 null). 묶음은 서버가 6개까지 준다. */
export interface ProjectActivityGroup {
  actor: ProjectOverviewUser
  eventType: string
  count: number
  latestAt: string
  issue: { issueKey: string; number: number; title: string } | null
}

/** 프로젝트 상태 배지(WP-1479) — 시스템이 규칙으로 정한다. 화면 「순조로움」「주의」「위험」. */
export type ProjectStatusBadge = 'ON_TRACK' | 'WARN' | 'RISK'

/**
 * 맨 위 「프로젝트 상태」 AI 요약(WP-1479) — 배지는 시스템, 글은 AI.
 * checkedAt 은 마지막 점검(입력이 그대로라 AI 를 부르지 않은 점검 포함), nextRunAt 은 다음 점검 예정 시각.
 */
export interface ProjectStatusSummary {
  badge: ProjectStatusBadge
  summary: string
  checkedAt: string
  nextRunAt: string
}

export interface ProjectOverviewResponse {
  today: string
  /** 사이클을 만들 수 있는 사람(프로젝트 OWNER·ADMIN, 워크스페이스 관리자) — 빈 진행 중 안내를 이 사람에게만. */
  canManage: boolean
  /** AI 를 못 쓰는 워크스페이스이거나 아직 요약이 없으면 null — 카드를 숨긴다. */
  statusSummary: ProjectStatusSummary | null
  cards: ProjectOverviewCards
  progress: ProjectOverviewProgress
  openIssues: ProjectOverviewOpenIssues
  attention: ProjectOverviewAttention
  workload: ProjectOverviewWorkload
  activity: ProjectActivityGroup[]
}
