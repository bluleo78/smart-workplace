// 에픽 선택과 「완료 모두 보기」(WP-390) — 페이지 테스트(WP-980).
// 에픽을 골라도 종료 이슈 숨김(#876)이 풀리지 않고, 종료된 에픽에서 고를 때만 토글이 켜지며 벗어나면 다시 꺼지는지 —
// URL 상태·요청 파라미터·조건부 렌더라 브라우저 없이 판정되므로 e2e/pages/projects/epic-closed-toggle.spec.ts 에서 옮겼다.
// 목 서버는 hideInactiveClosed=true 면 지난 사이클 완료 이슈를 빼고 돌려줘 실제 숨김 결과까지 화면으로 확인한다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, issueSearch, KEY, projectMeta } from '@/test/kits/projects/listBoard'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { CycleResponse } from '@/types/cycle'
import type { IssueResponse } from '@/types/issue'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { makeEpicType, systemTypes } from '../../../e2e/factories/issueType.factory'

const EPIC_TYPE_ID = String(makeEpicType().id)

function cycle(overrides: Partial<CycleResponse>): CycleResponse {
  return { id: 1, projectId: 1, name: '스프린트', goal: null, startDate: null, endDate: null, status: 'ACTIVE', createdAt: '', updatedAt: '', ...overrides }
}
// 진행 중 사이클 1개 + 지난(완료) 사이클 1개 — 목록 기본 그룹이 사이클(진행 중 → 백로그)이 된다.
const CYCLES = [cycle({ id: 1, name: '스프린트 3', status: 'ACTIVE' }), cycle({ id: 2, name: '스프린트 2', status: 'COMPLETED' })]

const epic = (number: number, title: string, status: IssueResponse['status']) =>
  createIssue({ id: number, number, title, type: makeEpicType(), status, childCount: 2, childDoneCount: 1 })
const OPEN_EPICS = [epic(10, '결제 리뉴얼', 'IN_PROGRESS')]
const CLOSED_EPICS = [epic(30, '팀 채팅 1차', 'DONE')]

// 에픽별 백로그 이슈 — DONE 은 지난 사이클에서 끝난 이슈(숨김 대상).
const BACKLOG_BY_PARENT: Record<string, IssueResponse[]> = {
  '': [createIssue({ id: 1, number: 1, title: '백로그 작업' }), createIssue({ id: 2, number: 2, title: '지난 사이클 완료 작업', status: 'DONE' })],
  '10': [createIssue({ id: 11, number: 11, title: '결제 남은 작업' }), createIssue({ id: 12, number: 12, title: '결제 지난 완료 작업', status: 'DONE' })],
  '30': [createIssue({ id: 31, number: 31, title: '채팅 지난 완료 작업', status: 'DONE' })],
}

/** 공통 목 — 본문 이슈 검색(에픽 목록 조회 제외) URL 을 돌려준다. */
function setup() {
  const search = issueSearch((url) => {
    const sp = url.searchParams
    if (sp.get('type') === EPIC_TYPE_ID) return (sp.get('status') ?? '').includes('DONE') ? CLOSED_EPICS : OPEN_EPICS
    if (sp.get('cycle') === '1') return []
    // 백로그·보드 — 서버의 종료 이슈 숨김(#876)을 흉내 낸다.
    const all = BACKLOG_BY_PARENT[sp.get('parent') ?? ''] ?? []
    return sp.get('hideInactiveClosed') === 'true' ? all.filter((i) => i.status !== 'DONE') : all
  })
  const handlers = [
    ...projectMeta(),
    http.get(`${API}/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`${API}/projects/${KEY}/cycles`, () => HttpResponse.json(CYCLES)),
    http.get(`${API}/projects/${KEY}/views`, () => HttpResponse.json([])),
    search.handler,
  ]
  const bodySearches = () => search.urls.filter((u) => u.searchParams.get('type') !== EPIC_TYPE_ID)
  return { handlers, bodySearches }
}

const backlog = () => screen.getByTestId('list-cycle-section-backlog')
const toggle = () => screen.getByTestId('show-all-closed-toggle')

async function open(path = `/projects/${KEY}`) {
  const s = setup()
  const page = renderPage(path, { handlers: s.handlers })
  return { ...page, ...s }
}

async function openEpicPanel(user: ReturnType<typeof renderPage>['user']) {
  await user.click(await screen.findByTestId('epic-panel-toggle', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await screen.findByTestId('epic-side-panel')
}

/** 「완료 모두 보기」 꺼짐 + 누를 수 있음 + URL closed 없음. */
function expectToggleOff(location: string) {
  expect(location).not.toMatch(/closed=all/)
  expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  expect(toggle()).toBeEnabled()
}

/** 종료된 에픽 30 선택 — 구역을 펼친 뒤 누른다. */
async function selectClosedEpic(user: ReturnType<typeof renderPage>['user'], location: () => string) {
  const section = screen.getByTestId('epic-closed-toggle')
  if (section.getAttribute('aria-expanded') !== 'true') await user.click(section)
  await user.click(await screen.findByTestId('epic-closed-filter-30'))
  await waitFor(() => expect(location()).toMatch(/parent=30/))
  expect(location()).toMatch(/closed=all/)
}

describe('에픽 선택과 「완료 모두 보기」 (WP-390)', () => {
  test('진행 중 에픽을 골라도 백로그에 지난 사이클 완료 이슈가 쌓이지 않고, 토글은 꺼진 채 누를 수 있다', async () => {
    const { user, location, bodySearches } = await open()
    await openEpicPanel(user)

    await user.click(await screen.findByTestId('epic-filter-10'))
    await waitFor(() => expect(location()).toMatch(/parent=10/))
    await waitFor(() => expect(backlog()).toHaveTextContent('결제 남은 작업'))
    expect(backlog()).not.toHaveTextContent('결제 지난 완료 작업')
    expectToggleOff(location())
    // 백로그 구간 요청이 숨김 파라미터를 보낸다.
    const backlogReq = bodySearches().filter((u) => u.searchParams.get('parent') === '10' && u.searchParams.get('cycle') === 'null').at(-1)
    expect(backlogReq?.searchParams.get('hideInactiveClosed')).toBe('true')

    // 사용자가 직접 켜면 그때 지난 완료분이 보인다.
    await user.click(toggle())
    await waitFor(() => expect(location()).toMatch(/closed=all/))
    await waitFor(() => expect(backlog()).toHaveTextContent('결제 지난 완료 작업'))
    // 진행 중 에픽에서 벗어나도 사용자가 켠 토글은 그대로다.
    await user.click(screen.getByTestId('epic-filter-all'))
    await waitFor(() => expect(location()).not.toMatch(/parent=/))
    expect(location()).toMatch(/closed=all/)
    await waitFor(() => expect(backlog()).toHaveTextContent('지난 사이클 완료 작업'))
  })

  test('종료된 에픽을 고르면 토글이 실제로 켜져 하위 이슈가 보이고, 사용자가 끌 수 있다', async () => {
    const { user, location } = await open()
    await openEpicPanel(user)

    await selectClosedEpic(user, location)
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'true'))
    expect(toggle()).toBeEnabled()
    await waitFor(() => expect(backlog()).toHaveTextContent('채팅 지난 완료 작업'))

    await user.click(toggle())
    await waitFor(() => expectToggleOff(location()))
    expect(location()).toMatch(/parent=30/)
    await waitFor(() => expect(backlog()).not.toHaveTextContent('채팅 지난 완료 작업'))
  })

  // 벗어나는 경로별 판정은 epicScope.test.ts(nextShowAllClosed)가 담당 — 여기선 대표 경로(전체) 하나로 화면 연결을 본다.
  test('종료된 에픽에서 벗어나면 토글이 다시 꺼진다 — 전체로 이동', async () => {
    const { user, location } = await open()
    await openEpicPanel(user)

    await selectClosedEpic(user, location)
    await user.click(screen.getByTestId('epic-filter-all'))
    await waitFor(() => expect(location()).not.toMatch(/parent=/))
    await waitFor(() => expectToggleOff(location()))
    await waitFor(() => expect(backlog()).toHaveTextContent('백로그 작업'))
    expect(backlog()).not.toHaveTextContent('지난 사이클 완료 작업')
  })

  test('보드도 에픽을 골랐을 때 종료 이슈 숨김을 유지한다', async () => {
    const { location, bodySearches } = await open(`/projects/${KEY}?view=board&parent=10`)
    expect(await screen.findByTestId('issue-card-11', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByTestId('issue-card-12')).not.toBeInTheDocument()
    const last = bodySearches().at(-1)!
    expect(last.searchParams.get('parent')).toBe('10')
    expect(last.searchParams.get('hideInactiveClosed')).toBe('true')
    expectToggleOff(location())
    // 보드 열 안에서만 카드가 보인다(열 배선).
    expect(within(screen.getByTestId('board-col-1')).getByTestId('issue-card-11')).toBeInTheDocument()
  })
})
