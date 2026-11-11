// 프로젝트 개요(WP-1478) 화면 판정 — 이슈 탭 링크, 진행 중 제목·숫자·예상 문구, 그래프 좌표, 막대 폭, 최근 활동 문구.
import { describe, expect, it } from 'vitest'

import type { ProjectOverviewProgress } from '@/types/projectOverview'

import { createCycleProgress, createTrendProgress } from '../../../../e2e/factories/projectOverview.factory'
import {
  activityAllHref,
  activityText,
  assigneeHref,
  attentionDaysLabel,
  attentionHref,
  barPct,
  dueSoonHref,
  epicsHref,
  firstAttentionTile,
  progressChart,
  progressCount,
  progressHeading,
  progressLink,
  projectionText,
  slashDay,
  statusHref,
  unassignedHref,
} from './overviewModel'

const TODAY = '2026-11-11'

/** 버전(출시일 11/24) 진행 — 예상 11/28 · 4일 늦음. */
const version = (over: Partial<ProjectOverviewProgress> = {}): ProjectOverviewProgress =>
  createCycleProgress({
    kind: 'VERSION',
    target: { id: 12, name: '베타 1.0', start: '2026-10-28', end: '2026-11-24' },
    total: 4,
    done: 2,
    projectedDate: '2026-11-28',
    lateDays: 4,
    ...over,
  })

// 쿼리는 이슈 탭과 같은 직렬화(filtersToParams)라 쉼표는 %2C 로 인코딩되고 키 순서도 그 함수의 순서다.
const OPEN = 'status=TODO%2CIN_PROGRESS'

describe('이슈 탭 링크 — 늘 쿼리를 단다(조건 없는 주소는 개요로 되돌려진다)', () => {
  it('살펴볼 이슈 「n건 더」 — 기한 지남은 마감이 어제까지인 열린 이슈, 나머지는 조건 필터', () => {
    expect(attentionHref('WP', 'overdue', TODAY)).toBe(`/projects/WP?${OPEN}&dueTo=2026-11-10`)
    expect(attentionHref('WP', 'stale', TODAY)).toBe('/projects/WP?stale=true')
    expect(attentionHref('WP', 'waiting', TODAY)).toBe('/projects/WP?waiting=true')
    // 달 경계.
    expect(attentionHref('WP', 'overdue', '2026-12-01')).toBe(`/projects/WP?${OPEN}&dueTo=2026-11-30`)
  })

  it('마감 임박 — 오늘부터 6일 뒤까지(7일)', () => {
    expect(dueSoonHref('WP', '2026-12-28')).toBe(`/projects/WP?${OPEN}&dueFrom=2026-12-28&dueTo=2027-01-03`)
  })

  it('열린 이슈·작업량·최근 활동·에픽', () => {
    expect(statusHref('WP', 'IN_PROGRESS')).toBe('/projects/WP?status=IN_PROGRESS')
    expect(unassignedHref('WP')).toBe(`/projects/WP?${OPEN}&assignee=null`)
    expect(assigneeHref('WP', 5)).toBe(`/projects/WP?${OPEN}&assignee=5`)
    expect(activityAllHref('WP')).toBe('/projects/WP?sort=updatedAt&direction=desc')
    expect(epicsHref('WP', 7)).toBe(`/projects/WP?${OPEN}&type=7`)
    expect(epicsHref('WP', null)).toBe(`/projects/WP?${OPEN}`)
  })

  it('진행 중 링크 — 사이클 이슈 / 버전 상세 / 열린 이슈', () => {
    expect(progressLink('WP', createCycleProgress())).toEqual({ label: '사이클 보기', href: '/projects/WP?cycle=3' })
    expect(progressLink('WP', version())).toEqual({ label: '버전 보기', href: '/projects/WP/versions/12' })
    expect(progressLink('WP', createTrendProgress())).toEqual({ label: '이슈 탭에서 보기', href: `/projects/WP?${OPEN}` })
  })
})

describe('진행 중 제목·숫자', () => {
  it('사이클 — D-n, 오늘 끝나면 D-day, 지났는데 진행 중이면 「종료일 n일 지남」, 종료일 없으면 「종료일 없음」', () => {
    expect(progressHeading(createCycleProgress(), TODAY)).toEqual({ name: '11/10~11/23', badge: '사이클', meta: 'D-12' })
    expect(progressHeading(createCycleProgress(), '2026-11-23').meta).toBe('D-day')
    expect(progressHeading(createCycleProgress(), '2026-11-26').meta).toBe('종료일 3일 지남')
    const noEnd = createCycleProgress({ target: { id: 3, name: '무기한', start: '2026-11-10', end: null } })
    expect(progressHeading(noEnd, TODAY).meta).toBe('종료일 없음')
  })

  it('버전 — 출시일·남은 날 / 오늘 출시 / 지남', () => {
    expect(progressHeading(version(), TODAY)).toEqual({ name: '베타 1.0', badge: '버전', meta: '11월 24일 출시 · 13일 남음' })
    expect(progressHeading(version(), '2026-11-24').meta).toBe('오늘 출시')
    expect(progressHeading(version(), '2026-11-26').meta).toBe('11월 24일 출시 예정 · 2일 지남')
  })

  it('전체 추이 — 이름·숫자', () => {
    expect(progressHeading(createTrendProgress(), TODAY)).toEqual({ name: '프로젝트 전체', badge: null, meta: '최근 8주 · 열린 이슈' })
    expect(progressCount(createTrendProgress())).toBe('열림 38')
    expect(progressCount(createCycleProgress())).toBe('18 / 41')
  })
})

describe('projectionText', () => {
  it('종료 전 가능 / 늦음 / 종료일 없음', () => {
    expect(projectionText(createCycleProgress(), TODAY)).toEqual({ text: '예상 완료 11월 21일 · 종료 전 가능', tone: 'success' })
    expect(projectionText(version(), TODAY)).toEqual({ text: '예상 완료 11월 28일 · 출시일보다 4일 늦음', tone: 'warning' })
    expect(projectionText(version({ lateDays: 0, projectedDate: '2026-11-24' }), TODAY)).toEqual({ text: '예상 완료 11월 24일 · 출시 전 가능', tone: 'success' })
    expect(projectionText(createCycleProgress({ lateDays: 3, projectedDate: '2026-11-26' }), TODAY).text).toBe('예상 완료 11월 26일 · 종료일보다 3일 늦음')
    const noEnd = createCycleProgress({ target: { id: 3, name: '무기한', start: '2026-11-10', end: null }, lateDays: null })
    expect(projectionText(noEnd, TODAY)).toEqual({ text: '예상 완료 11월 21일', tone: 'muted' })
  })

  it('예상할 수 없을 때 — 속도 0 · 범위 없음 · 모두 완료', () => {
    expect(projectionText(createCycleProgress({ projectedDate: null, lateDays: null }), TODAY)).toEqual({ text: '최근 완료한 이슈가 없어 예상할 수 없어요', tone: 'muted' })
    expect(projectionText(createCycleProgress({ total: 0, done: 0 }), TODAY).text).toBe('아직 범위에 이슈가 없어요')
    expect(projectionText(createCycleProgress({ total: 5, done: 5 }), TODAY)).toEqual({ text: '모두 완료했어요', tone: 'success' })
  })

  it('전체 추이 — 늘어남·줄어듦·그대로', () => {
    expect(projectionText(createTrendProgress({ trendDelta: 14 }), TODAY)).toEqual({ text: '8주 동안 +14 · 늘어나는 중', tone: 'warning' })
    expect(projectionText(createTrendProgress({ trendDelta: -9 }), TODAY)).toEqual({ text: '8주 동안 -9 · 줄어드는 중', tone: 'success' })
    expect(projectionText(createTrendProgress({ trendDelta: 0 }), TODAY)).toEqual({ text: '8주 동안 그대로', tone: 'muted' })
  })
})

describe('progressChart', () => {
  it('사이클 — 가로는 시작 ~ max(종료일, 예상일), 세로는 0 ~ 범위. 점선은 오늘 완료 점 → 예상일의 범위', () => {
    // 11/10 시작 ~ 11/23 종료(13일), 너비 600 → 안쪽 592(여백 4).
    const c = progressChart(createCycleProgress(), 600, 120)
    expect(c.scope).toBe('4,12.2 49.5,4')
    expect(c.done).toBe('4,88.7 49.5,66.8')
    // 예상일 11/21 은 11일째 → x = 4 + 11/13*592.
    expect(c.projected).toBe('49.5,66.8 504.9,4')
    expect(c.endX).toBe(596)
  })

  it('예상일이 종료일보다 늦으면 가로가 예상일까지 늘고 종료선은 안쪽에 선다', () => {
    const c = progressChart(version(), 600, 120)
    expect(c.endX).toBeLessThan(596)
    expect(c.projected?.split(' ')[1].startsWith('596,')).toBe(true)
  })

  it('전체 추이는 선 하나(열린 이슈 수)뿐, 종료선·점선 없음', () => {
    const c = progressChart(createTrendProgress(), 600, 120)
    expect(c.scope?.split(' ')).toHaveLength(8)
    expect(c.done).toBeNull()
    expect(c.projected).toBeNull()
    expect(c.endX).toBeNull()
  })

  it('점이 없으면(시작 전 사이클) 아무 선도 없다, 모두 끝났으면 점선이 없다, 종료일이 없으면 종료선이 없다', () => {
    expect(progressChart(createCycleProgress({ points: [] }))).toMatchObject({ scope: null, done: null, projected: null, endX: null })
    expect(progressChart(createCycleProgress({ done: 41 })).projected).toBeNull()
    expect(progressChart(createCycleProgress({ target: { id: 3, name: 'x', start: '2026-11-10', end: null } })).endX).toBeNull()
  })
})

describe('작은 판정', () => {
  it('살펴볼 이슈 일수 문구', () => {
    expect(attentionDaysLabel('overdue', 21)).toBe('21일 지남')
    expect(attentionDaysLabel('stale', 9)).toBe('9일 멈춤')
    expect(attentionDaysLabel('waiting', 3)).toBe('3일 기다림')
    expect(attentionDaysLabel('waiting', 0)).toBe('오늘부터 기다림')
  })

  it('처음 고를 타일 — 건수 있는 첫 묶음, 모두 0 이면 기한 지남', () => {
    const g = (total: number) => ({ total, items: [] })
    expect(firstAttentionTile({ total: 3, overdue: g(0), stale: g(0), waiting: g(3) })).toBe('waiting')
    expect(firstAttentionTile({ total: 0, overdue: g(0), stale: g(0), waiting: g(0) })).toBe('overdue')
  })

  it('막대 폭 — 0 이면 0, 아주 작아도 2%', () => {
    expect(barPct(0, 10)).toBe(0)
    expect(barPct(5, 0)).toBe(0)
    expect(barPct(1, 1000)).toBe(2)
    expect(barPct(71, 162)).toBe(44)
  })

  it('짧은 날짜', () => {
    expect(slashDay('2026-11-03')).toBe('11/3')
  })

  it('최근 활동 문구 — 여러 건 / 한 건(이슈 키) / 모르는 종류 — 종류 이름은 이슈 상세 활동 기록과 같은 표', () => {
    expect(activityText({ eventType: 'STATUS_CHANGED', count: 4, issue: null })).toBe('이슈 4건 상태 변경')
    expect(activityText({ eventType: 'ASSIGNEES_CHANGED', count: 1, issue: { issueKey: 'WP-3', number: 3, title: 't' } })).toBe('WP-3 담당자 변경')
    expect(activityText({ eventType: 'DEPENDENCY_ADDED', count: 2, issue: null })).toBe('이슈 2건 의존성 추가')
    expect(activityText({ eventType: 'NEW_KIND', count: 1, issue: null })).toBe('이슈 1건 수정')
    // 활동 기록 표의 「필드」는 한 줄로 읽히지 않아 개요에서만 「필드 변경」으로 쓴다
    expect(activityText({ eventType: 'CUSTOM_FIELD_CHANGED', count: 2, issue: null })).toBe('이슈 2건 필드 변경')
  })
})
