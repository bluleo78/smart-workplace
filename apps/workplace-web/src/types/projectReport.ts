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

/** GET·PUT·되돌리기 공통 응답 — 프로젝트 설정 「리포트」 주간 리포트 줄. */
export interface ProjectReportSettings extends UpdateProjectReportSettingsRequest {
  /** 「템플릿 · 주간 리포트」 노트 페이지 — 한 번도 켠 적 없으면 null */
  templatePageId: number | null
  /** 다음 실행 예정(꺼져 있으면 null) */
  nextRunAt: string | null
  /** 이 사용자가 고칠 수 있는지(OWNER·ADMIN, 개인 프로젝트는 false) */
  canManage: boolean
}
