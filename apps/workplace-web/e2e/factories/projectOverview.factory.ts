// 프로젝트 「개요」(WP-1478) 응답 팩토리 — vitest 화면 테스트(src/pages/projects/projectOverview.test.tsx·projectTabs.page.test.tsx)가 쓴다.
// 기본값은 시안(사이클 11/10~11/23 진행 중, 에픽 있음, 살펴볼 이슈 세 묶음)과 같은 모양이다. 오늘은 2026-11-11.
import type {
  ProjectActivityGroup,
  ProjectAttentionItem,
  ProjectOverviewProgress,
  ProjectOverviewResponse,
  ProjectOverviewUser,
} from '../../src/types/projectOverview'

export const overviewHuman = (id: number, name: string): ProjectOverviewUser => ({ id, name, kind: 'HUMAN', active: true })
export const overviewAgent = (id: number, name: string): ProjectOverviewUser => ({ id, name, kind: 'AGENT', active: true })

/** 살펴볼 이슈 한 줄 — WP-{number}. */
export const createAttentionItem = (number: number, title: string, days: number, assignees: ProjectOverviewUser[] = []): ProjectAttentionItem => ({
  issueKey: `WP-${number}`,
  number,
  title,
  days,
  assignees,
})

/** 진행 중 — 사이클 11/10~11/23, 오늘(11/11)까지 두 점, 예상 완료 11/21(종료 전). */
export function createCycleProgress(over: Partial<ProjectOverviewProgress> = {}): ProjectOverviewProgress {
  return {
    kind: 'CYCLE',
    target: { id: 3, name: '11/10~11/23', start: '2026-11-10', end: '2026-11-23' },
    total: 41,
    done: 18,
    points: [
      { date: '2026-11-10', scope: 38, done: 10 },
      { date: '2026-11-11', scope: 41, done: 18 },
    ],
    projectedDate: '2026-11-21',
    lateDays: -2,
    trendDelta: null,
    epics: {
      epicTypeId: 7,
      inProgress: 9,
      total: 31,
      items: [
        { issueKey: 'WP-1', number: 1, title: '통합 검색', done: 6, total: 9 },
        { issueKey: 'WP-2', number: 2, title: 'AI 계정 목록·사용량', done: 1, total: 4 },
      ],
    },
    ...over,
  }
}

/** 프로젝트 전체 추이(사이클·버전 없음) — 8주 점, 열린 이슈 +14. 에픽 없음. */
export function createTrendProgress(over: Partial<ProjectOverviewProgress> = {}): ProjectOverviewProgress {
  return {
    kind: 'TREND',
    target: null,
    total: 38,
    done: null,
    points: ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-11'].map((date, i) => ({
      date,
      scope: 24 + i * 2,
      done: null,
    })),
    projectedDate: null,
    lateDays: null,
    trendDelta: 14,
    epics: { epicTypeId: 7, inProgress: 0, total: 0, items: [] },
    ...over,
  }
}

export function createActivityGroup(over: Partial<ProjectActivityGroup> = {}): ProjectActivityGroup {
  return {
    actor: overviewAgent(5, 'AI 개발자1'),
    eventType: 'STATUS_CHANGED',
    count: 4,
    latestAt: '2026-11-11T04:36:00Z',
    issue: null,
    ...over,
  }
}

/** 시안과 같은 개요 한 화면. */
export function createProjectOverview(over: Partial<ProjectOverviewResponse> = {}): ProjectOverviewResponse {
  return {
    today: '2026-11-11',
    canManage: true,
    statusSummary: null,
    cards: {
      completed: { current: 96, previous: 81 },
      created: { current: 118, previous: 92 },
      dueSoon: { count: 9, unassigned: 2 },
      overdue: { count: 14, oldestDays: 21 },
    },
    progress: createCycleProgress(),
    openIssues: { total: 162, todo: 71, inProgress: 91, unassigned: 24 },
    attention: {
      total: 46,
      overdue: {
        total: 14,
        items: [
          createAttentionItem(1188, '매뉴얼 그림 재촬영 — 드라이브 장', 21, [overviewHuman(1, '양동희')]),
          createAttentionItem(1347, '메일 분류 재시도가 사용 한도 초과 뒤 멈춤', 12, [overviewAgent(6, 'AI 개발자2')]),
        ],
      },
      stale: { total: 23, items: [createAttentionItem(1300, '오래 멈춘 작업', 9, [])] },
      waiting: { total: 9, items: [createAttentionItem(1400, 'AI 가 답을 기다리는 작업', 3, [overviewAgent(5, 'AI 개발자1')])] },
    },
    workload: {
      top: [
        { ...overviewHuman(1, '양동희'), count: 31 },
        { ...overviewAgent(6, 'AI 개발자2'), count: 17 },
      ],
      unassigned: 24,
      others: { people: 6, issues: 59 },
    },
    activity: [
      createActivityGroup(),
      createActivityGroup({ actor: overviewHuman(1, '양동희'), eventType: 'LABELS_CHANGED', count: 1, issue: { issueKey: 'WP-77', number: 77, title: '검색 결과 정렬' } }),
    ],
    ...over,
  }
}

/** 빈 프로젝트 — 숫자 0, 목록 비움, 진행 중은 전체 추이(평평). */
export function createEmptyProjectOverview(over: Partial<ProjectOverviewResponse> = {}): ProjectOverviewResponse {
  return createProjectOverview({
    cards: {
      completed: { current: 0, previous: 0 },
      created: { current: 0, previous: 0 },
      dueSoon: { count: 0, unassigned: 0 },
      overdue: { count: 0, oldestDays: null },
    },
    progress: createTrendProgress({ total: 0, trendDelta: 0, points: [{ date: '2026-11-11', scope: 0, done: null }] }),
    openIssues: { total: 0, todo: 0, inProgress: 0, unassigned: 0 },
    attention: { total: 0, overdue: { total: 0, items: [] }, stale: { total: 0, items: [] }, waiting: { total: 0, items: [] } },
    workload: { top: [], unassigned: 0, others: { people: 0, issues: 0 } },
    activity: [],
    ...over,
  })
}
