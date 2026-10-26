// 모바일 보드 상태 탭(WP-195·WP-808) — 페이지 테스트(WP-981).
// 탭↔패널 aria 연결, 탭 전환의 boardTab 주소 반영·주소로 복귀, 예전 범주 링크(boardTab=DONE) 정규화, 상태 필터로 탭 숨김·필터 변경에도 탭 유지,
// 그룹 보드의 탭 안 그룹 섹션, 개인 보드 탭 3개는 주소·조건부 렌더라 e2e/pages/mobile/board.spec.ts 에서 옮겼다.
// 카드 2줄·탭 44px·스와이프·길게 누르기·스크롤 맨 위 같은 기하·입력은 그 E2E 가 지킨다.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'
import type { IssueResponse } from '@/types/issue'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { statusFieldsOf } from '../../../e2e/factories/projectStatus.factory'

mockViewport()
// jsdom 에는 요소 scrollTo 가 없다 — 탭 전환 때 목록을 맨 위로 올리는 호출(스크롤 위치는 E2E @layout 이 본다).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}

const KEY = 'WP'
const TODO1 = createIssue({ id: 21, number: 21, projectKey: KEY, title: '환불 처리 실패 원인 분석', type: makeTaskType(), status: 'TODO' })
const TODO2 = createIssue({ id: 22, number: 22, projectKey: KEY, title: '환불 콜백 재시도 로직 추가', type: makeTaskType(), status: 'TODO' })
const PROG = createIssue({ id: 1047, number: 1047, projectKey: KEY, title: '정산 배치 지연 알림', type: makeTaskType(), status: 'IN_PROGRESS' })
const DONE1 = createIssue({ id: 31, number: 31, projectKey: KEY, title: '영수증 PDF 폰트 깨짐', type: makeTaskType(), status: 'DONE' })

/**
 * 프로젝트·메타·이슈 응답. 보드는 컬럼별 쿼리(statusId)라 그 상태(시드 id → 범주) 이슈만 돌려준다 — E2E board.spec 의 mock 과 같다.
 * queries 에는 이슈 목록 요청의 쿼리 문자열을 모은다.
 */
function handlers({ issues = [TODO1, TODO2, PROG, DONE1], type = 'TEAM' as 'TEAM' | 'PERSONAL', queries = [] as URLSearchParams[] } = {}) {
  return [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type, viewerIsMember: true }))),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/issues`, ({ request }) => {
      const url = new URL(request.url)
      queries.push(url.searchParams)
      if (url.searchParams.get('type') === String(makeEpicType().id)) return HttpResponse.json(createIssueSearchResponse([], null))
      const statusId = url.searchParams.get('statusId')
      const status = statusId ? (statusFieldsOf(Number(statusId)).status ?? null) : url.searchParams.get('status')
      const list: IssueResponse[] = status ? issues.filter((i) => status.split(',').includes(i.status)) : issues
      return HttpResponse.json(createIssueSearchResponse(list, null))
    }),
  ]
}

const tab = (statusId: number) => screen.getByTestId(`board-tab-${statusId}`)

test('선택 탭의 aria-controls 가 그 탭으로 이름 붙은 tabpanel(카드 목록)을 가리키고, 탭을 바꾸면 따라간다', async () => {
  const { user } = renderPage(`/projects/${KEY}?view=board&group=none&boardTab=1`, { handlers: handlers() })
  await screen.findByTestId('issue-card-21', {}, { timeout: PAGE_LOAD_TIMEOUT })
  for (const [statusId, card] of [[1, 'issue-card-21'], [3, 'issue-card-31']] as const) {
    if (statusId === 3) await user.click(tab(3))
    await waitFor(() => expect(tab(statusId)).toHaveAttribute('aria-selected', 'true'))
    const panel = document.getElementById(tab(statusId).getAttribute('aria-controls')!)!
    expect(panel).toHaveAttribute('role', 'tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', tab(statusId).id)
    await waitFor(() => expect(panel.querySelector(`[data-testid="${card}"]`)).not.toBeNull())
  }
})

test('탭을 누르면 전환되고 주소 boardTab 에 남으며, 그 주소로 다시 열면 같은 탭이다', async () => {
  const first = renderPage(`/projects/${KEY}?view=board&group=none`, { handlers: handlers() })
  // 기본 탭은 진행 중(2) — 그 카드만 보인다.
  expect(await screen.findByTestId('issue-card-1047', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(tab(2)).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByTestId('issue-card-21')).not.toBeInTheDocument()
  await first.user.click(tab(3))
  await waitFor(() => expect(first.location()).toMatch(/boardTab=3/))
  expect(await screen.findByTestId('issue-card-31')).toBeInTheDocument()
  const url = first.location()
  first.unmount()

  // 새로고침 = 같은 주소로 새로 띄우기.
  renderPage(url, { handlers: handlers() })
  expect(await screen.findByTestId('issue-card-31', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(tab(3)).toHaveAttribute('aria-selected', 'true')
})

test('예전 범주 링크(boardTab=DONE)는 그 범주 첫 상태 탭으로 열리고 주소가 statusId 로 바뀐다', async () => {
  const { location } = renderPage(`/projects/${KEY}?view=board&group=none&boardTab=DONE`, { handlers: handlers() })
  expect(await screen.findByTestId('issue-card-31', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(tab(3)).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => expect(location()).toMatch(/boardTab=3(&|$)/))
})

test('상태 필터로 제외된 탭은 숨기고, 검색어로 필터를 바꿔도 선택 탭은 유지된다', async () => {
  const { user, location } = renderPage(`/projects/${KEY}?view=board&group=none&status=TODO,DONE&boardTab=3`, { handlers: handlers() })
  expect(await screen.findByTestId('issue-card-31', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryByTestId('board-tab-2')).not.toBeInTheDocument()
  expect(tab(3)).toHaveAttribute('aria-selected', 'true')
  // 검색어 입력 = writeFilters 경로.
  await user.click(screen.getByTestId('mobile-search-open'))
  fireEvent.change(await screen.findByTestId('mobile-search-input'), { target: { value: '영수증' } })
  await waitFor(() => expect(location()).toMatch(/q=/))
  expect(location()).toMatch(/boardTab=3/)
})

test('우선순위 그룹 보드도 상태 탭 — 탭 건수와 탭 안 그룹 섹션, 다른 상태 카드는 없다', async () => {
  const hi = createIssue({ id: 61, number: 61, projectKey: KEY, title: '높음 할 일', type: makeTaskType(), status: 'TODO', priority: 'HIGH' })
  const lo = createIssue({ id: 62, number: 62, projectKey: KEY, title: '낮음 할 일', type: makeTaskType(), status: 'TODO', priority: 'LOW' })
  renderPage(`/projects/${KEY}?view=board&group=priority&boardTab=1`, { handlers: handlers({ issues: [hi, lo, PROG] }) })
  expect(await screen.findByTestId('board-group-1-HIGH', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('높음 할 일')
  expect(screen.getByTestId('board-group-1-LOW')).toHaveTextContent('낮음 할 일')
  await waitFor(() => expect(screen.getByTestId('board-tab-count-1')).toHaveTextContent('2'))
  expect(screen.queryByTestId('issue-card-1047')).not.toBeInTheDocument()
})

test('개인 프로젝트 보드는 탭 3개(취소 없음)이고 상태 편집 ⋯·범주 색 띠가 없다', async () => {
  renderPage(`/projects/${KEY}?view=board`, { handlers: handlers({ type: 'PERSONAL' }) })
  expect(await screen.findByTestId('board-tab-1', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(tab(3)).toBeInTheDocument()
  expect(screen.queryByTestId('board-tab-4')).not.toBeInTheDocument()
  expect(screen.queryByTestId('board-tab-menu')).not.toBeInTheDocument()
  expect(screen.queryByTestId('board-tab-band-1')).not.toBeInTheDocument()
})
