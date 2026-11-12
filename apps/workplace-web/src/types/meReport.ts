// 개인 보고(WP-1486) — /api/v1/me/report-settings·/api/v1/me/reports 응답·요청. 서버 DTO(wiki/report/dto/PersonalReport*)와 필드 이름이 같다.

/** 보고 종류 — 일일·주간·월간(월간은 주간 템플릿을 기간만 바꿔 쓴다). */
export type MeReportKind = 'DAILY' | 'WEEKLY' | 'MONTHLY'

/** 「보고서 설정」 창 — 행이 없으면 서버 기본값(꺼짐·09:00·건너뜀 켬). */
export interface MeReportSettings {
  dailyEnabled: boolean
  /** 자동 일일 시각(KST 정시, 「HH:00」) */
  timeOfDay: string
  /** 「한 일이 없는 날은 건너뜀」 */
  skipEmpty: boolean
  /** 일일 템플릿 노트 — 「보고」 바로 아래에 있을 때만(없으면 null → 「켜면 노트에 만들어요」) */
  dailyTemplatePageId: number | null
  /** 주간(·월간) 템플릿 노트 — 같은 규칙 */
  weeklyTemplatePageId: number | null
  /** 내 노트 「보고」 페이지(없으면 null) */
  reportsPageId: number | null
  /** 내 노트 공간(「보고」가 있을 때만) */
  spaceId: number | null
  /** 다음 자동 일일 생성 시각(꺼짐이면 null) */
  nextRunAt: string | null
  /** 보고를 쓸 AI 비서가 있는가(개인 비서 → 공용 비서) */
  assistantAvailable: boolean
  /** 자동 생성의 마지막 실패 한 줄(없으면 null) */
  lastError: string | null
}

/** 설정 저장 — 세 값을 모두 싣는다(바꾸는 즉시 저장). */
export interface UpdateMeReportSettingsRequest {
  dailyEnabled: boolean
  timeOfDay: string
  skipEmpty: boolean
}

/** 「보고서 만들기」 — 종류에 맞는 기간 값 하나만 쓴다(일일 date · 주간 weekStart(월요일) · 월간 month 「2026-10」). */
export interface CreateMeReportRequest {
  kind: MeReportKind
  date?: string
  weekStart?: string
  month?: string
  /** true 면 같은 회차 보고가 있어도 새 페이지(「(2)」) */
  force: boolean
}

/** 회차 상태(폴링) — pageId 가 있어도 노트가 지워졌으면 title 은 null 일 수 있다. */
export interface MeReportStatus {
  id: number
  status: 'PENDING' | 'GENERATED' | 'SKIPPED' | 'FAILED'
  pageId: number | null
  title: string | null
  error: string | null
}

/** 만들기 응답(202) — 예약한 회차 id, 상태는 언제나 PENDING. */
export type MeReportCreated = Pick<MeReportStatus, 'id' | 'status'>

/** 그 회차의 가장 최근 보고 노트 — 「일일 보고 보기」. */
export interface MeReportLookup {
  pageId: number
  title: string
  createdAt: string
}

/** 만들기 409 본문 — code 로 가른다(이미 있음은 pageId·title, 만드는 중은 id, 비서 없음은 message 만). */
export interface MeReportConflict {
  code: 'REPORT_EXISTS' | 'REPORT_IN_PROGRESS' | 'NO_ASSISTANT'
  pageId?: number
  title?: string
  id?: number
  message?: string
}
