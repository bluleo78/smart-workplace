// 모바일 타임라인 아젠다(WP-197·WP-247·WP-251·WP-938) — 페이지 테스트(WP-981).
// 행 탭 이동, 차단 표시, 칩(일정 미정 수·마일스톤 시트·필터·기간) 문구와 시트 동작, 날짜 문구(연도), 멤버 권한,
// 합성 에픽 진행률, 빈 상태 분기, 완료·취소 에픽 표시, 상태 목록 관문(로딩·실패·다시 시도)은 브라우저 없이 판정되므로
// e2e/pages/mobile/timeline.spec.ts 에서 옮겼다. 들여쓰기·막대·오늘 선·가운데 정렬·스크롤(@layout),
// 새로고침 뒤 펼침 유지(@platform), 화면 배선(@wiring)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 타임라인 화면만 renderScreen 으로 띄운다 — 행 탭 뒤 상세는 그리지 않고 이동 주소만 본다(WP-1002).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'
import type { CycleResponse } from '@/types/cycle'
import type { IssueResponse } from '@/types/issue'
import type { MilestoneResponse } from '@/types/milestone'
import type { VersionResponse } from '@/types/version'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { inServerOrder, withCustomStatuses } from '../../../e2e/factories/projectStatus.factory'
import { createVersion } from '../../../e2e/factories/version.factory'
import TimelinePage from '../projects/timeline/TimelinePage'

// 휴대폰 폭·터치 포인터 — 타임라인이 간트 대신 아젠다로 그려지게 한다.
mockViewport()

// 오늘 = 2026-10-15 — 기간·마감 지남·연도 표기가 실행일과 무관하게 같게 Date 만 고정한다(타이머는 진짜).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T03:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

const KEY = 'WP'
const EPIC_TITLE = '결제 시스템 전면 개편 — 승인·정산·환불 파이프라인 재구축(여러 달에 걸친 에픽)'
const epicRef = { number: 40, title: EPIC_TITLE, type: makeEpicType() }
const I = (o: Partial<IssueResponse>) => createIssue({ projectKey: KEY, ...o })
// E2E 와 같은 데이터 — 월 섹션·에픽 묶음·일정 미정·완료/취소 에픽이 모두 나온다.
const ISSUES: IssueResponse[] = [
  I({ id: 40, number: 40, title: EPIC_TITLE, type: makeEpicType(), startDate: '2026-10-01', dueDate: '2026-12-15' }),
  I({ id: 41, number: 41, title: '정산 배치 신규 파이프라인 이관', parent: epicRef, startDate: '2026-11-05', dueDate: '2026-11-20' }),
  I({ id: 42, number: 42, title: '승인 API 타임아웃 조정', parent: epicRef, dueDate: '2026-10-08' }),
  I({ id: 9, number: 9, title: '9월에 시작한 이슈', startDate: '2026-09-25', dueDate: '2026-10-05' }),
  I({ id: 30, number: 30, title: '넘친 에픽', type: makeEpicType(), startDate: '2026-10-01', dueDate: '2026-10-10', childCount: 2, childDoneCount: 1 }),
  I({ id: 31, number: 31, title: '넘친 하위', parent: { number: 30, title: '넘친 에픽', type: makeEpicType() }, startDate: '2026-10-05', dueDate: '2026-10-14' }),
  I({ id: 10, number: 10, title: '모바일 결제 화면 카드 등록 실패', startDate: '2026-10-11', dueDate: '2026-10-20' }),
  ...Array.from({ length: 6 }, (_, k) => I({ id: 20 + k, number: 20 + k, title: `10월 작업 ${k + 1}`, dueDate: `2026-10-2${k}` })),
  I({ id: 13, number: 13, title: '시작일만 있는 이슈', startDate: '2026-11-02' }),
  I({ id: 11, number: 11, title: '일정 미정 이슈 A' }),
  I({ id: 12, number: 12, title: '일정 미정 이슈 B' }),
  I({ id: 80, number: 80, title: '완료 에픽', type: makeEpicType(), status: 'DONE', startDate: '2026-10-02', dueDate: '2026-10-09' }),
  I({ id: 90, number: 90, title: '취소 에픽', type: makeEpicType(), status: 'CANCELED', startDate: '2026-10-03', dueDate: '2026-10-12' }),
  I({ id: 91, number: 91, title: '취소 에픽의 진행 중 하위', parent: { number: 90, title: '취소 에픽', type: makeEpicType() }, status: 'IN_PROGRESS', startDate: '2026-10-05', dueDate: '2026-10-08' }),
]
const MILESTONES: MilestoneResponse[] = [
  { id: 1, projectId: 1, name: 'v2 베타', dueDate: '2026-11-01', description: null, createdAt: '', updatedAt: '' },
  { id: 2, projectId: 1, name: 'v2 정식 출시', dueDate: '2026-12-20', description: null, createdAt: '', updatedAt: '' },
]

function createCycle(o: Partial<CycleResponse>): CycleResponse {
  return { id: 1, projectId: 1, name: 'GW-1', goal: null, startDate: '2026-09-01', endDate: '2026-09-30', status: 'PLANNED', createdAt: '', updatedAt: '', ...o }
}

type Opts = {
  member?: boolean
  query?: string
  cycles?: CycleResponse[]
  /** 기본 'all', null 이면 period 없이(기본 = 활성 사이클). */
  period?: string | null
  issues?: IssueResponse[]
  milestones?: MilestoneResponse[]
  /** 버전 목록 — 없으면 기본 빈 목록(baseHandlers)이라 「버전 N」 칩이 없다. */
  versions?: VersionResponse[]
  /** 상태 목록 응답 — 관문(WP-938) 검증용. */
  statuses?: () => Promise<Response> | Response
  /** 진입 뒤 아젠다를 기다릴지(관문 검증은 false). */
  waitAgenda?: boolean
}

/** 타임라인 API(MSW) — status 쿼리에 DONE 이 있으면 0건(빈 상태 케이스). */
function handlers(opts: Opts) {
  return [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, viewerIsMember: opts.member ?? true }))),
    http.get(`/api/v1/projects/${KEY}/issues`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status') ?? ''
      return HttpResponse.json(createIssueSearchResponse(status.includes('DONE') ? [] : (opts.issues ?? ISSUES), null))
    }),
    // 마일스톤 추가는 프로젝트 OWNER 만(WP-1008) — 멤버 시나리오는 로그인 사용자(id 1)를 OWNER 로 둔다.
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json((opts.member ?? true) ? [createMember({ userId: 1, role: 'OWNER' })] : [])),
    http.get(`/api/v1/projects/${KEY}/milestones`, () => HttpResponse.json(opts.milestones ?? MILESTONES)),
    http.get(`/api/v1/projects/${KEY}/cycles`, () => HttpResponse.json(opts.cycles ?? [])),
    http.get(`/api/v1/projects/${KEY}/issue-dependencies`, () => HttpResponse.json([])),
    ...(opts.statuses ? [http.get(`/api/v1/projects/${KEY}/statuses`, opts.statuses)] : []),
    ...(opts.versions ? [http.get(`/api/v1/projects/${KEY}/versions`, () => HttpResponse.json(opts.versions))] : []),
  ]
}

/** 타임라인을 연다 — 기본 period=all 로 기간 거름 없이. */
async function open(opts: Opts = {}) {
  const params = new URLSearchParams((opts.query ?? '').replace(/^\?/, ''))
  const period = opts.period === undefined ? 'all' : opts.period
  if (period) params.set('period', period)
  const qs = params.toString()
  const view = renderMobileRoute('/projects/:key/timeline', <TimelinePage />, { path: `/projects/${KEY}/timeline${qs ? `?${qs}` : ''}`, handlers: handlers(opts) })
  if (opts.waitAgenda ?? true) await screen.findByTestId('timeline-agenda')
  return view
}

describe('모바일 타임라인 — 행', () => {
  // 행 본문 탭은 이슈 상세로 간다(에픽은 기본 접힘이라 먼저 펼친다).
  test('행 탭 → 이슈 상세', async () => {
    const { user, location } = await open()
    await user.click(screen.getByTestId('agenda-toggle-40'))
    await user.click(await screen.findByTestId('agenda-row-42'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/issues/42`))
  })

  // WP-1039 — 다른 프로젝트 에픽 PLAN-40 의 하위는 이 프로젝트 에픽 #40 과 따로 「PLAN-40 …」 머리 행 아래 묶이고,
  // 머리 행을 누르면 그 프로젝트 에픽으로, 펼침도 따로 움직인다.
  test('다른 프로젝트 에픽 하위는 키가 붙은 머리 행 아래 따로 묶이고, 머리 행은 그 프로젝트 에픽으로 간다', async () => {
    const crossRef = { number: 40, title: '기획 에픽', type: makeEpicType(), projectKey: 'PLAN' }
    const { user, location } = await open({
      issues: [...ISSUES, I({ id: 43, number: 43, title: '다른 팀 에픽 하위', parent: crossRef, startDate: '2026-10-06', dueDate: '2026-10-09' })],
    })
    const head = screen.getByTestId('agenda-row-PLAN-40')
    expect(head).toHaveTextContent('PLAN-40 기획 에픽')
    // 펼치기 전엔 어느 하위도 안 보이고, 다른 프로젝트 묶음을 펼쳐도 이 프로젝트 #40 의 하위는 그대로 접혀 있다.
    expect(screen.queryByTestId('agenda-row-43')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('agenda-toggle-PLAN-40'))
    expect(await screen.findByTestId('agenda-row-43')).toHaveTextContent('다른 팀 에픽 하위')
    expect(screen.queryByTestId('agenda-row-42')).not.toBeInTheDocument()
    await user.click(head)
    await waitFor(() => expect(location()).toBe('/projects/PLAN/issues/40'))
  })

  // WP-646 — 차단된 이슈 행에만 ⛔ 표시, 행 접근 이름에도 「차단됨」.
  test('차단된 이슈 행에 ⛔ 차단 표시 — 차단 안 된 행에는 없다', async () => {
    await open({ issues: ISSUES.map((i) => (i.number === 10 ? { ...i, blocked: true } : i)) })
    const marker = within(screen.getByTestId('agenda-row-10')).getByTestId('agenda-blocked')
    expect(marker).toHaveAccessibleName('차단됨')
    expect(within(screen.getByTestId('agenda-row-9')).queryByTestId('agenda-blocked')).not.toBeInTheDocument()
    expect(screen.getByTestId('agenda-row-10')).toHaveAccessibleName(/차단됨/)
  })

  // WP-678 — 해를 넘는 기간은 올해가 아닌 쪽에만 연도가 붙는다.
  test('이슈 행 — 해를 넘는 기간은 올해가 아닌 쪽에 연도가 붙는다', async () => {
    await open({
      issues: [
        I({ id: 70, number: 70, title: '해를 넘는 이슈', startDate: '2026-12-01', dueDate: '2027-01-05' }),
        I({ id: 71, number: 71, title: '올해 이슈', startDate: '2026-10-11', dueDate: '2026-10-20' }),
      ],
    })
    expect(screen.getByTestId('agenda-row-70')).toHaveTextContent('12월 1일 ~ 2027년 1월 5일')
    expect(screen.getByTestId('agenda-row-71')).toHaveTextContent('10월 11일 ~ 10월 20일')
  })

  // WP-688 — 필터로 에픽이 빠져 하위로 합성한 에픽도 서버 집계처럼 취소 하위를 완료로 센다(1/2 가 아니라 2/2).
  test('필터로 에픽이 빠진 합성 에픽도 완료·취소 하위를 완료로 센다', async () => {
    const parent = { number: 70, title: '필터로 빠진 에픽', type: makeEpicType() }
    await open({
      query: 'status=CANCELED',
      issues: [
        I({ id: 71, number: 71, title: '하위-완료', parent, status: 'DONE', dueDate: '2026-10-10' }),
        I({ id: 72, number: 72, title: '하위-취소', parent, status: 'CANCELED', dueDate: '2026-10-12' }),
      ],
    })
    const progress = within(screen.getByTestId('agenda-row-70')).getByTestId('agenda-progress')
    expect(progress.querySelector('[aria-hidden="true"]')).toHaveTextContent('2/2')
    expect(progress).toHaveTextContent('하위 2개 중 2개 완료')
  })

  // WP-247 — 완료 에픽은 완료 배지·성공 색 막대, 기본 필터에선 취소 에픽이 빠지고 그 하위는 단독 행(← 에픽 이름).
  test('완료 에픽은 완료 배지, 취소 에픽은 빠지고 옮겨진 하위는 단독 행', async () => {
    await open()
    const done = screen.getByTestId('agenda-row-80')
    expect(within(done).getByTestId('agenda-status-badge')).toHaveTextContent('완료')
    expect(within(done).getByTestId('agenda-bar').className).toMatch(/bg-success/)
    expect(screen.queryByTestId('agenda-row-90')).not.toBeInTheDocument()
    expect(screen.getByTestId('agenda-row-91')).toHaveAttribute('data-kind', 'issue')
    expect(screen.getByTestId('agenda-row-91')).toHaveTextContent('← 취소 에픽')
  })

  // 「취소」 상태 필터면 취소 에픽이 취소 배지·취소선·흐린 막대로 보인다.
  test('「취소」 필터면 취소 에픽이 배지·취소선으로 보인다', async () => {
    await open({ query: 'status=CANCELED' })
    const canceled = screen.getByTestId('agenda-row-90')
    expect(within(canceled).getByTestId('agenda-status-badge')).toHaveTextContent('취소')
    expect(canceled.querySelector('.line-through')).not.toBeNull()
    expect(within(canceled).getByTestId('agenda-bar').className).toMatch(/bg-muted-foreground/)
  })
})

describe('모바일 타임라인 — 칩·시트', () => {
  // 「일정 미정 N」 수는 날짜 없는 11·12 + 시작일만 있는 13(WP-484). 마일스톤 칩은 이름·날짜 시트를 연다.
  // (칩을 누르면 미정 섹션으로 스크롤되는지는 E2E @layout.)
  test('「일정 미정 N」 칩 수, 「마일스톤 N」 칩 → 이름·날짜 시트', async () => {
    const { user } = await open()
    expect(screen.getByTestId('agenda-chip-undated')).toHaveTextContent(/^일정 미정 3$/)
    await user.click(screen.getByTestId('agenda-chip-milestones'))
    const sheet = await screen.findByTestId('agenda-milestone-sheet')
    expect(sheet).toHaveTextContent('v2 베타')
    expect(sheet).toHaveTextContent('11월 1일')
    expect(sheet).toHaveTextContent('v2 정식 출시')
  })

  // WP-616 — 마일스톤 시트도 올해가 아닌 마감일엔 연도를 붙인다.
  test('마일스톤 시트 — 올해가 아닌 마감일은 연도까지 보인다', async () => {
    const { user } = await open({
      milestones: [
        { id: 7, projectId: 1, name: '작년 회고', dueDate: '2025-03-01', description: null, createdAt: '', updatedAt: '' },
        { id: 8, projectId: 1, name: '올해 베타', dueDate: '2026-11-01', description: null, createdAt: '', updatedAt: '' },
        { id: 9, projectId: 1, name: '내년 정식', dueDate: '2027-03-01', description: null, createdAt: '', updatedAt: '' },
      ],
    })
    await user.click(screen.getByTestId('agenda-chip-milestones'))
    const rows = (await screen.findByTestId('agenda-milestone-sheet')).querySelectorAll('li')
    expect([...rows].map((r) => r.textContent)).toEqual([
      expect.stringMatching(/작년 회고\s*2025년 3월 1일/),
      expect.stringMatching(/올해 베타\s*11월 1일/),
      expect.stringMatching(/내년 정식\s*2027년 3월 1일/),
    ])
  })

  // 릴리스가 잦으면 오래된 순 한 줄에서 다음 출시·방금 나간 버전이 맨 아래에 묻혔다(WP-1070) — 두 구역으로 나눈다.
  test('버전 시트 — 예정은 가까운 날짜부터(지난 미출시는 빨강), 출시됨은 최신 10개 + 더 보기, 누르면 버전 상세', async () => {
    // 오늘 10/15 — 출시됨 12개(10/4~10/15), 출시일이 지난 미출시 1개(10/10), 앞으로 나갈 미출시 1개(11/1).
    const released = Array.from({ length: 12 }, (_, k) =>
      createVersion({ id: k + 1, name: `v1.${k}`, releaseDate: `2026-10-${String(k + 4).padStart(2, '0')}`, status: 'RELEASED' }),
    )
    const { user, location } = await open({
      versions: [
        ...released,
        createVersion({ id: 20, name: 'v2.0', releaseDate: '2026-11-01' }),
        createVersion({ id: 21, name: 'v1.9-hotfix', releaseDate: '2026-10-10' }),
      ],
    })
    await user.click(await screen.findByTestId('agenda-chip-versions'))
    const sheet = await screen.findByTestId('agenda-version-sheet')
    const rows = () => [...sheet.querySelectorAll('li')].map((li) => li.textContent)
    // 구역은 제목으로 나뉜다 — 출시됨은 접혀 있어도 전체 수.
    expect(within(sheet).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['예정 2', '출시됨 12'])
    expect(rows()).toEqual([
      'v1.9-hotfix10월 10일',
      'v2.011월 1일',
      'v1.11오늘',
      'v1.10어제',
      ...[9, 8, 7, 6, 5, 4, 3, 2].map((k) => `v1.${k}10월 ${k + 4}일`),
      '이전 버전 2개 더 보기',
    ])
    // 출시일이 지났는데 아직 미출시면 날짜를 빨갛게 — 앞으로 나갈 미출시·출시됨은 아니다.
    expect(within(screen.getByTestId('agenda-version-21')).getByText('10월 10일')).toHaveClass('text-destructive')
    expect(within(screen.getByTestId('agenda-version-20')).getByText('11월 1일')).not.toHaveClass('text-destructive')

    await user.click(screen.getByTestId('agenda-version-more'))
    expect(rows().slice(-2)).toEqual(['v1.110월 5일', 'v1.010월 4일'])
    expect(screen.queryByTestId('agenda-version-more')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('agenda-version-20'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/versions/20`))
  })

  // 필터 칩은 활성 수를 보이고, 0건이어도 칩 줄이 남아 필터 시트에서 풀 수 있다.
  test('필터 칩 → 필터 시트(활성 수 표시), 0건이면 빈 상태 + 칩 줄 유지, 지우면 status 가 빠진다', async () => {
    const { user, location } = await open({ query: '?status=DONE', waitAgenda: false })
    await screen.findByTestId('timeline-agenda-empty')
    const filter = screen.getByTestId('agenda-chip-filter')
    expect(filter).toHaveTextContent(/^필터 1$/)
    await user.click(filter)
    const sheet = await screen.findByTestId('mobile-filter-sheet')
    await user.click(within(sheet).getByTestId('mobile-filter-clear'))
    await waitFor(() => expect(new URLSearchParams(location().split('?')[1]).get('status')).toBeNull())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('mobile-filter-sheet')).not.toBeInTheDocument())
    expect(await screen.findByTestId('agenda-row-10')).toBeInTheDocument()
  })

  // 모바일 헤더엔 줌·오늘이 없고, 멤버면 헤더 인라인 「마일스톤 추가」가 대화상자를 연다.
  test('헤더 — 줌·오늘 없음, 멤버면 「마일스톤 추가」가 대화상자를 연다', async () => {
    const { user } = await open()
    expect(screen.queryByRole('button', { name: '오늘' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '줌 전환' })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('milestone-add-button'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  test('비멤버는 「마일스톤 추가」가 없다', async () => {
    await open({ member: false })
    expect(screen.queryByTestId('milestone-add-button')).not.toBeInTheDocument()
  })
})

describe('모바일 타임라인 — 기간(WP-247)', () => {
  // 기간 칩은 칩 줄 맨 앞, period 없이 들어오면 활성 사이클로 걸러지고, 시트에서 「전체」로 바꾸면 다시 걸러진다.
  test('기간 칩 — 맨 앞에 활성 사이클 라벨, 시트에서 바꾸면 아젠다가 다시 걸러진다', async () => {
    const cycles = [
      createCycle({ id: 1, name: 'GW-2', startDate: '2026-10-08', endDate: '2026-10-21', status: 'ACTIVE' }),
      createCycle({ id: 2, name: 'GW-3', startDate: '2026-11-01', endDate: '2026-11-14', status: 'PLANNED' }),
    ]
    const { user, location } = await open({ cycles, period: null })
    const chips = document.querySelectorAll('[data-testid^="agenda-chip-"]')
    expect(chips[0]).toHaveAttribute('data-testid', 'agenda-chip-period')
    expect(screen.getByTestId('agenda-chip-period')).toHaveTextContent('GW-2')
    await user.click(screen.getByTestId('agenda-toggle-40'))
    expect(await screen.findByTestId('agenda-row-41')).toBeInTheDocument()
    expect(screen.queryByTestId('agenda-row-25')).not.toBeInTheDocument() // 10/25 마감 단독 — 기간 밖
    expect(screen.getByTestId('agenda-row-13')).toBeInTheDocument() // 마감일 없는 단독은 기간과 무관
    await user.click(screen.getByTestId('agenda-chip-period'))
    await user.click(within(await screen.findByTestId('agenda-period-sheet')).getByTestId('picker-option-all'))
    await waitFor(() => expect(location()).toMatch(/period=all/))
    expect(await screen.findByTestId('agenda-row-25')).toBeInTheDocument()
    // 필터 개수에는 기간이 들어가지 않는다.
    expect(screen.getByTestId('agenda-chip-filter')).toHaveTextContent(/^필터$/)
  })

  // 응답 0건이면 기본(활성) 기간이어도 원인은 필터 — 기간 문구가 아닌 필터 빈 상태.
  test('응답 0건이면 기본 기간이어도 필터 빈 상태 — 기간이 원인이 아님', async () => {
    await open({ query: '?status=DONE', period: null, waitAgenda: false })
    const empty = await screen.findByTestId('timeline-agenda-empty')
    expect(empty).toHaveTextContent('표시할 이슈가 없어요')
    expect(empty).toHaveTextContent('필터를 풀면 더 많은 이슈가 보여요.')
    expect(empty).not.toHaveTextContent('이 기간에 걸친 이슈가 없어요')
    expect(screen.getByTestId('agenda-chip-period')).toBeInTheDocument()
  })

  // 「직접 지정」 — 두 날짜를 적용하면 URL·칩 라벨이 바뀌고 시트가 닫히며 기간 밖 단독 이슈가 빠진다.
  test('기간 시트 「직접 지정」 — 적용하면 URL·칩 라벨이 바뀌고 시트가 닫힌다', async () => {
    const { user, location } = await open()
    await user.click(screen.getByTestId('agenda-chip-period'))
    const sheet = await screen.findByTestId('agenda-period-sheet')
    fireEvent.change(within(sheet).getByTestId('period-range-from'), { target: { value: '2026-10-01' } })
    fireEvent.change(within(sheet).getByTestId('period-range-to'), { target: { value: '2026-10-14' } })
    await user.click(within(sheet).getByTestId('period-range-apply'))
    await waitFor(() => expect(decodeURIComponent(location())).toMatch(/period=range:2026-10-01~2026-10-14/))
    expect(screen.getByTestId('agenda-chip-period')).toHaveTextContent('10/1–10/14')
    await waitFor(() => expect(screen.queryByTestId('agenda-period-sheet')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByTestId('agenda-row-25')).not.toBeInTheDocument())
  })
})

describe('모바일 타임라인 — 상태 목록 관문(WP-938)', () => {
  // 상태 목록을 받기 전엔 아젠다·필터 칩 대신 로딩 — 받은 뒤 필터 시트 「상태」 facet 이 프로젝트 상태 이름을 보인다.
  test('상태 목록을 받기 전엔 로딩, 받은 뒤 필터 시트 「상태」에 프로젝트 상태 이름', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const { user } = await open({
      waitAgenda: false,
      statuses: async () => {
        await held
        return HttpResponse.json(inServerOrder(withCustomStatuses('설계')))
      },
    })
    await waitFor(() => expect(screen.getByTestId('timeline-page')).toHaveTextContent('로딩 중…'))
    expect(screen.queryByTestId('timeline-agenda')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agenda-chip-filter')).not.toBeInTheDocument()

    release()
    await user.click(await screen.findByTestId('agenda-chip-filter'))
    const sheet = await screen.findByTestId('mobile-filter-sheet')
    await user.click(within(sheet).getByTestId('add-filter-trigger'))
    await user.click(await screen.findByTestId('add-filter-facet-statusId'))
    await waitFor(() =>
      expect([...document.querySelectorAll('[data-testid^="facet-value-statusId-"]')].map((e) => e.textContent?.trim())).toEqual([
        '할 일', '진행 중', '설계', '완료', '취소',
      ]),
    )
  })

  // 상태 목록 실패 → 아젠다 자리에 오류·다시 시도, 성공하면 아젠다가 그려진다.
  test('상태 목록을 불러오지 못하면 다시 시도, 성공 뒤 아젠다가 그려진다', async () => {
    let fail = true
    const { user } = await open({
      waitAgenda: false,
      statuses: () =>
        fail
          ? HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 })
          : HttpResponse.json(inServerOrder(withCustomStatuses())),
    })
    const error = await screen.findByTestId('project-statuses-error')
    expect(error).toHaveTextContent('상태 목록을 불러오지 못했습니다')
    expect(screen.queryByTestId('timeline-agenda')).not.toBeInTheDocument()
    fail = false
    await user.click(within(error).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('timeline-agenda')).toBeInTheDocument()
    expect(screen.queryByTestId('project-statuses-error')).not.toBeInTheDocument()
  })
})
