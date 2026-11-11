// 프로젝트 「개요」 탭(WP-1478) 화면 판정 — 그래프 좌표, 진행 중 문구, 이슈 탭 링크, 최근 활동 문구. 렌더와 분리해 순수 함수 테스트로 고정한다.
// 이슈 상세 주소는 앱 공용 issuePath(lib/appUrl)를 쓴다 — 응답이 번호(number)를 함께 준다.
// 숫자 자체는 서버가 센다 — 여기서는 보이는 모양과 「같은 조건을 이슈 탭에서 여는 주소」만 정한다.
// 이슈 탭 주소는 늘 쿼리를 단다 — 조건 없는 /projects/:key 는 기억한 탭(개요)으로 되돌려져 이슈 탭이 열리지 않는다(useRememberedProjectTab).
import { projectPath } from '@/lib/appUrl'
import { addDays, daysBetween } from '@/lib/closedRange'
import { formatDateOnlyMonthDay, parseDateKey } from '@/lib/formatters'
import { filtersToParams, parseFilters } from '@/lib/issueFilters'
import type { IssueFilters, IssueHistoryEventType } from '@/types/issue'
import type {
  ProjectActivityGroup,
  ProjectOverviewAttention,
  ProjectOverviewProgress,
} from '@/types/projectOverview'

import { HISTORY_EVENT_LABEL } from '../components/issueHistoryLabels'

/** 열린 이슈 범주 — 개요의 「열린 이슈」 정의(할 일·진행 중)와 같은 이슈 탭 조건. */
const OPEN_STATUSES: Partial<IssueFilters> = { statuses: ['TODO', 'IN_PROGRESS'] }

/**
 * 이슈 탭 주소 — 빈 필터에 조건만 덧쓴 뒤 이슈 탭과 같은 직렬화(filtersToParams)로 쿼리를 만든다.
 * 손으로 잇지 않아 키 이름·값 모양(쉼표 목록·정렬 방향)이 이슈 탭이 읽는 모양과 갈라지지 않는다.
 */
function issueTab(key: string, ...over: Partial<IssueFilters>[]): string {
  const filters: IssueFilters = Object.assign(parseFilters(new URLSearchParams()), ...over)
  return `${projectPath(key)}?${filtersToParams(filters, 'list', null)}`
}

/** 숫자 카드 「마감 임박」 — 열린 이슈 중 마감이 오늘~6일 뒤(서버 정의와 같은 7일). */
export function dueSoonHref(key: string, today: string): string {
  return issueTab(key, OPEN_STATUSES, { dueFrom: today, dueTo: addDays(today, 6) })
}

/** 살펴볼 이슈 묶음 이름 — 타일·주소·일수 문구가 같은 키를 쓴다. */
export type AttentionKey = 'overdue' | 'stale' | 'waiting'

/** 「n건 더 — 이슈 탭에서 보기」 주소. 기한 지남은 마감이 어제까지인 열린 이슈, 오래 멈춤·기다리는 중은 서버 조건 필터. */
export function attentionHref(key: string, group: AttentionKey, today: string): string {
  if (group === 'overdue') return issueTab(key, OPEN_STATUSES, { dueTo: addDays(today, -1) })
  return issueTab(key, group === 'stale' ? { stale: true } : { waiting: true })
}

/** 살펴볼 이슈 한 줄의 오른쪽 일수 — 「21일 지남」「9일 멈춤」「3일 기다림」(오늘부터면 「오늘부터 기다림」). */
export function attentionDaysLabel(group: AttentionKey, days: number): string {
  if (group === 'overdue') return `${days}일 지남`
  if (group === 'stale') return `${days}일 멈춤`
  return days <= 0 ? '오늘부터 기다림' : `${days}일 기다림`
}

/** 처음 고를 타일 — 급한 순(기한 지남 → 오래 멈춤 → 기다리는 중)으로 건수가 있는 첫 묶음. 모두 0 이면 기한 지남. */
export function firstAttentionTile(a: ProjectOverviewAttention): AttentionKey {
  return (['overdue', 'stale', 'waiting'] as const).find((k) => a[k].total > 0) ?? 'overdue'
}

/** 열린 이슈 한 범주(할 일·진행 중)만 이슈 탭에서. */
export function statusHref(key: string, category: 'TODO' | 'IN_PROGRESS'): string {
  return issueTab(key, { statuses: [category] })
}

/** 담당자 없는 열린 이슈. */
export function unassignedHref(key: string): string {
  return issueTab(key, OPEN_STATUSES, { includeUnassigned: true })
}

/** 한 사람이 맡은 열린 이슈 — 작업량 줄. */
export function assigneeHref(key: string, userId: number): string {
  return issueTab(key, OPEN_STATUSES, { assigneeIds: [userId] })
}

/** 최근 활동 「모두 보기」 — 최근 수정 순 이슈 탭(조건 없는 주소는 개요로 되돌려지므로 정렬을 적는다). */
export function activityAllHref(key: string): string {
  return issueTab(key, { sort: 'updatedAt', direction: 'desc' })
}

/** 에픽 「모두 보기」 — 닫히지 않은 에픽(개요 「전체 n」과 같은 범위). 에픽 유형 id 는 응답(progress.epics.epicTypeId) — 없으면 열린 이슈 전체. */
export function epicsHref(key: string, epicTypeId: number | null): string {
  return issueTab(key, OPEN_STATUSES, epicTypeId == null ? {} : { typeIds: [epicTypeId] })
}

/** 진행 중 오른쪽 위 링크 — 사이클은 그 사이클의 이슈, 버전은 버전 상세, 전체 추이는 열린 이슈. */
export function progressLink(key: string, p: ProjectOverviewProgress): { label: string; href: string } {
  if (p.kind === 'CYCLE' && p.target) return { label: '사이클 보기', href: issueTab(key, { cycleIds: [p.target.id] }) }
  if (p.kind === 'VERSION' && p.target) return { label: '버전 보기', href: `${projectPath(key)}/versions/${p.target.id}` }
  return { label: '이슈 탭에서 보기', href: issueTab(key, OPEN_STATUSES) }
}

/** 날짜 키 → 「11월 21일」(올해가 아니면 연도까지). now 는 「올해」 기준. */
function md(key: string, now?: Date): string {
  return formatDateOnlyMonthDay(key, now ?? parseDateKey(key))
}

/**
 * 진행 중 제목 줄 — 이름·종류 배지·남은 날.
 * 사이클: 「D-13」(오늘 끝나면 「D-day」, 끝났는데 아직 진행 중이면 「종료일 3일 지남」, 종료일이 없으면 「종료일 없음」).
 * 버전: 「11월 24일 출시 · 14일 남음」(오늘이면 「오늘 출시」, 지났으면 「11월 24일 출시 예정 · 3일 지남」).
 * 전체 추이: 「최근 8주 · 열린 이슈」.
 */
export function progressHeading(p: ProjectOverviewProgress, today: string): { name: string; badge: string | null; meta: string } {
  if (!p.target || p.kind === 'TREND') return { name: '프로젝트 전체', badge: null, meta: '최근 8주 · 열린 이슈' }
  // 종료일 없는 진행 중 사이클 — 남은 날을 셀 수 없어 「종료일 없음」.
  if (p.target.end == null) return { name: p.target.name, badge: p.kind === 'CYCLE' ? '사이클' : '버전', meta: '종료일 없음' }
  const left = daysBetween(today, p.target.end)
  if (p.kind === 'CYCLE') {
    const meta = left > 0 ? `D-${left}` : left === 0 ? 'D-day' : `종료일 ${-left}일 지남`
    return { name: p.target.name, badge: '사이클', meta }
  }
  const day = md(p.target.end, parseDateKey(today))
  const meta = left > 0 ? `${day} 출시 · ${left}일 남음` : left === 0 ? '오늘 출시' : `${day} 출시 예정 · ${-left}일 지남`
  return { name: p.target.name, badge: '버전', meta }
}

/** 진행 중 오른쪽 숫자 — 사이클·버전 「18 / 41」(완료/범위), 전체 추이 「열림 38」. */
export function progressCount(p: ProjectOverviewProgress): string {
  return p.kind === 'TREND' ? `열림 ${p.total}` : `${p.done ?? 0} / ${p.total}`
}

/** 그래프 아래 오른쪽 문구의 색 — success(제때·줄어듦) / warning(늦음·늘어남) / muted(예상 없음). */
export type ProjectionTone = 'success' | 'warning' | 'muted'

/**
 * 그래프 아래 오른쪽 문구.
 * - 전체 추이: 「8주 동안 +14 · 늘어나는 중」(warning) / 「8주 동안 -9 · 줄어드는 중」(success) / 「8주 동안 그대로」.
 * - 사이클·버전: 「예상 완료 11월 21일 · 종료 전 가능」(success) / 「예상 완료 11월 28일 · 출시일보다 4일 늦음」(warning).
 *   범위가 비었거나 모두 끝났거나 최근 14일 완료가 없어 예상할 수 없으면 그 사실을 말한다.
 */
export function projectionText(p: ProjectOverviewProgress, today: string): { text: string; tone: ProjectionTone } {
  if (p.kind === 'TREND') {
    const d = p.trendDelta ?? 0
    if (d > 0) return { text: `8주 동안 +${d} · 늘어나는 중`, tone: 'warning' }
    if (d < 0) return { text: `8주 동안 ${d} · 줄어드는 중`, tone: 'success' }
    return { text: '8주 동안 그대로', tone: 'muted' }
  }
  if (p.total === 0) return { text: '아직 범위에 이슈가 없어요', tone: 'muted' }
  if ((p.done ?? 0) >= p.total) return { text: '모두 완료했어요', tone: 'success' }
  if (!p.projectedDate) return { text: '최근 완료한 이슈가 없어 예상할 수 없어요', tone: 'muted' }
  const when = `예상 완료 ${md(p.projectedDate, parseDateKey(today))}`
  // 종료일이 없으면 비교할 날이 없다 — 예상일만.
  if (!p.target?.end) return { text: when, tone: 'muted' }
  const endWord = p.kind === 'CYCLE' ? '종료일' : '출시일'
  if (p.lateDays != null && p.lateDays > 0) return { text: `${when} · ${endWord}보다 ${p.lateDays}일 늦음`, tone: 'warning' }
  return { text: `${when} · ${p.kind === 'CYCLE' ? '종료 전 가능' : '출시 전 가능'}`, tone: 'success' }
}

/** 그래프 그리기 값 — SVG viewBox 좌표의 polyline 점 문자열과 종료 세로선 x. 없는 선은 null(점이 없으면 — 시작 전 사이클 — 모두 null). */
export interface ProgressChart {
  width: number
  height: number
  /** 범위(사이클·버전, 회색) 또는 열린 이슈 수(전체 추이, 파란 선). */
  scope: string | null
  /** 완료(파란 선) — 전체 추이는 null. */
  done: string | null
  /** 오늘 → 예상 완료일 점선(마지막 완료 점 → 예상일의 범위). */
  projected: string | null
  /** 종료일(출시일) 세로선 x — 전체 추이·기간 밖이면 null. */
  endX: number | null
}

/** 그래프 여백 — 선 끝 점과 종료선이 상자 가장자리에 붙지 않게. */
const PAD = 4

/**
 * 진행 중 그래프 좌표. 가로는 기간 시작(첫 점) ~ max(종료일, 예상 완료일, 마지막 점), 세로는 0 ~ 가장 큰 값.
 * 점은 서버가 오늘까지만 주므로 실선은 오늘에서 끝나고, 점선이 오늘 → 예상 완료일(범위에 닿는 곳)로 이어진다.
 */
export function progressChart(p: ProjectOverviewProgress, width = 600, height = 120): ProgressChart {
  const pts = p.points
  if (pts.length === 0) return { width, height, scope: null, done: null, projected: null, endX: null }
  const start = p.target?.start ?? pts[0].date
  const targetEnd = p.target?.end ?? null
  const candidates = [pts[pts.length - 1].date, ...(targetEnd ? [targetEnd] : []), ...(p.projectedDate ? [p.projectedDate] : [])]
  const end = candidates.reduce((a, b) => (b > a ? b : a))
  const span = Math.max(1, daysBetween(start, end))
  const yMax = Math.max(1, p.total, ...pts.map((x) => Math.max(x.scope, x.done ?? 0)))
  const round = (n: number) => Math.round(n * 10) / 10
  const x = (date: string) => round(PAD + (daysBetween(start, date) / span) * (width - PAD * 2))
  const y = (v: number) => round(height - PAD - (v / yMax) * (height - PAD * 2))
  const line = (vals: { date: string; v: number }[]) => vals.map((q) => `${x(q.date)},${y(q.v)}`).join(' ')

  const scope = line(pts.map((q) => ({ date: q.date, v: q.scope })))
  if (p.kind === 'TREND') return { width, height, scope, done: null, projected: null, endX: null }
  const done = line(pts.map((q) => ({ date: q.date, v: q.done ?? 0 })))
  const last = pts[pts.length - 1]
  const projected = p.projectedDate && (p.done ?? 0) < p.total
    ? line([{ date: last.date, v: last.done ?? 0 }, { date: p.projectedDate, v: p.total }])
    : null
  return { width, height, scope, done, projected, endX: targetEnd ? x(targetEnd) : null }
}

/** 날짜 키 → 「11/23」 — 그래프 종료선 위 짧은 글. */
export function slashDay(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${m}/${d}`
}

/** 막대 폭(%) — max 0 이면 0. 0 보다 크면 아주 작아도 2% 는 보이게 한다(있는데 안 보이는 막대가 없게). */
export function barPct(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0
  return Math.max(2, Math.round((value / max) * 100))
}

/**
 * 최근 활동 한 줄 — 한 건이면 「WP-12 상태 변경」(제목은 옆에 따로 보인다), 여러 건이면 「이슈 4건 상태 변경」.
 * 서버는 한 건일 때만 issue 를 싣는다 — issue 가 있는지만 본다. 종류 이름은 이슈 상세 활동 기록과 같은 표(HISTORY_EVENT_LABEL),
 * 모르는 종류는 「수정」. 활동 기록 표의 이름이 명사 하나라 한 줄로 읽히지 않는 종류만 아래에서 바꿔 쓴다.
 */
const ACTIVITY_PHRASE_OVERRIDE: Partial<Record<IssueHistoryEventType, string>> = {
  // 활동 기록은 「필드」 옆에 바뀐 값을 함께 보이지만, 개요 한 줄은 종류만 보여 「이슈 2건 필드」가 된다.
  CUSTOM_FIELD_CHANGED: '필드 변경',
}

export function activityText(g: Pick<ProjectActivityGroup, 'eventType' | 'count' | 'issue'>): string {
  const type = g.eventType as IssueHistoryEventType
  const phrase = ACTIVITY_PHRASE_OVERRIDE[type] ?? HISTORY_EVENT_LABEL[type] ?? '수정'
  if (g.issue) return `${g.issue.issueKey} ${phrase}`
  return `이슈 ${g.count}건 ${phrase}`
}
