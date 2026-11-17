// 개요 카드 리포트 줄(WP-1483) — GET /projects/{key}/reports 응답. 노트 공간 멤버가 아니거나 리포트가 없으면 latest=null, past=[].
import type { ProjectStatusBadge } from './projectOverview'

/** 최신 리포트 — 배지·한 줄은 서버가 페이지 본문에서 그때 읽는다(사람이 고치면 바뀐다). */
export interface ProjectReportCard {
  pageId: number
  title: string
  /** 회차 시작·끝(KST 날짜, 끝 포함) */
  periodStart: string
  periodEnd: string
  /** 만든 시각(실행 시각) — 줄의 「11월 16일 (월) 09:00」 */
  createdAt: string
  /** 배지를 본문에서도 저장값에서도 못 얻으면 null(칩 없이 그린다) */
  badge: ProjectStatusBadge | null
  /** 「상태와 한 줄」 첫 문단(최대 200자), 없으면 null */
  line: string | null
  /** AI 가 쓴 뒤 사람이 고쳤는지 */
  edited: boolean
}

/** 「지난 리포트」 목록 한 줄 — 배지는 생성 때 저장한 값. */
export interface ProjectReportListItem {
  pageId: number
  title: string
  periodStart: string
  badge: ProjectStatusBadge | null
  edited: boolean
}

export interface ProjectReportCardResponse {
  latest: ProjectReportCard | null
  /** 최신 회차부터 최대 10개(최신 포함) */
  past: ProjectReportListItem[]
  /** 「리포트」 노트 페이지 — 「노트에서 모두 보기」. 없으면 null */
  reportsPageId: number | null
  /** 최신 리포트의 주기 이름(주간|격주|월간), 최신이 없으면 null */
  cadenceLabel: string | null
}

/** 리포트 주기(WP-1483) — 매주·격주·매월. */
export type ReportCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'

/** 리포트 요일 — java DayOfWeek 이름 그대로. 매월은 그 달 첫 번째 고른 요일. */
export type ReportWeekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

/** PUT /projects/{key}/report-settings 바디 — 바꾸면 네 값을 모두 싣는다. */
export interface UpdateProjectReportSettingsRequest {
  enabled: boolean
  cadence: ReportCadence
  weekday: ReportWeekday
  /** 정시 「HH:00」 */
  timeOfDay: string
}

/** GET·PUT·되돌리기·위치 바꾸기 공통 응답 — 프로젝트 설정 「리포트」 정기 리포트 줄. */
export interface ProjectReportSettings extends UpdateProjectReportSettingsRequest {
  /** 「정기 리포트」 템플릿 노트 페이지 — 프로젝트 노트 공간 안에 실제로 있을 때만(아직 없거나 지워졌거나 다른 공간이면 null) */
  templatePageId: number | null
  /** 다음 실행 예정(꺼져 있으면 null) */
  nextRunAt: string | null
  /** 이 사용자가 고칠 수 있는지(OWNER·ADMIN, 개인 프로젝트는 false) */
  canManage: boolean
  /** 프로젝트 노트 공간(WP-1654) — 저장 위치 고르기 창이 이 공간 트리를 읽는다. 없으면 null */
  noteSpaceId: number | null
  /** 맨 위 「템플릿」 페이지(WP-1654) — 고르기 창에서 그 갈래를 뺀다. 없으면 null */
  templateRootPageId: number | null
  /** 템플릿 경로 제목(예 ['템플릿', '정기 리포트']) — 템플릿 링크 글자. 템플릿이 없으면 빈 목록 */
  templatePath: string[]
  /** 없어진 템플릿을 다시 만든 시각 — 설정에 「템플릿을 다시 만들었어요」 한 줄. 없으면 null */
  templateRecreatedAt: string | null
  /** 지금 유효한 리포트 저장 위치(고른 페이지, 아니면 「리포트」, 그것도 없으면 null) */
  reportLocationPageId: number | null
  /** 저장 위치 경로 제목 — 기본 ['리포트'](「리포트」가 아직 없어도 다음 생성 때 만든다) */
  reportLocationPath: string[]
}

/** PUT /projects/{key}/report-settings/location 바디(WP-1654) — 새 리포트를 둘 프로젝트 노트 페이지. 「최상위」는 위치가 될 수 없어 필수다. */
export interface UpdateProjectReportLocationRequest {
  pageId: number
}

/** POST /projects/{key}/reports/generate 응답(WP-1630) — 「지금 생성」으로 만든(또는 새 판을 쓴) 리포트 페이지. */
export interface ProjectReportGenerateResult {
  pageId: number
  /** 「11월 3주차 주간 리포트」 */
  title: string
  /** 같은 회차 리포트가 있어 그 페이지에 새 판을 썼으면 true(직전 판은 노트 수정 기록에) */
  replaced: boolean
}
