// 이슈 목록 열 고르기(WP-270) — 화면 테스트(WP-980, WP-1002 에서 목록 화면(ProjectDetailPage)만 띄우게 바꿈).
// URL cols → 평면·사이클 구간 헤더와 셀(완료일·보고자·사이클·커스텀 필드), 빈 cols·기본 열, 그룹 헤더 colSpan, 완료일 필터의 자동 열,
// 저장된 뷰가 열을 담는지·「수정됨」 비교·뷰 업데이트 PATCH·URL cols 전환, 보드의 「열」 버튼 없음은 브라우저 없이 판정되므로
// e2e/pages/projects/issue-list-columns.spec.ts 에서 옮겼다. 그 spec 에는 폭·가로 스크롤·sticky·말줄임(@layout)과
// 새로고침 뒤 개인 열 유지(@platform)가 남는다. 날짜는 같은 해면 연도를 생략하므로 현재 시각(Date)을 2026-10-23 서울로 고정한다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { issueListHandlers, recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import type { ScreenUser } from '@/test/renderScreen'
import type { IssueFieldDef } from '@/types/customField'
import type { CycleResponse } from '@/types/cycle'
import type { IssueResponse } from '@/types/issue'
import type { SavedViewResponse } from '@/types/savedView'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'
const COLS = 'priority,assignee,due,closed,reporter,cycle,cf7'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T06:00:00Z'))
})
afterEach(() => vi.useRealTimers())

// 커스텀 필드 정의 — cf7 「고객사」(SELECT). cf8 은 정의만 있고 URL 에 없으니 열로 나오지 않아야 한다.
const FIELD_DEFS: IssueFieldDef[] = [
  { id: 7, projectId: 1, name: '고객사', type: 'SELECT', options: ['한빛', '누리'], position: 0, createdAt: '', updatedAt: '' },
  { id: 8, projectId: 1, name: '예상 공수', type: 'NUMBER', options: null, position: 1, createdAt: '', updatedAt: '' },
]
const CYCLE: CycleResponse = {
  id: 3, projectId: 1, name: 'GW-3', goal: null, startDate: '2026-10-19', endDate: '2026-10-30', status: 'ACTIVE', createdAt: '', updatedAt: '',
}
// 완료 이슈 — 마감 10/21, 서울 10/23 14:05 완료 → 「✓ 10월 23일」 + 「+2일」. 사이클 둘(첫 이름 + `+1`).
const ISSUE: IssueResponse = createIssue({
  id: 1, number: 1, title: '결제 모듈 개편', status: 'DONE', statusId: 3, statusName: '완료', priority: 'HIGH',
  dueDate: '2026-10-21', closedAt: '2026-10-23T05:05:00Z',
  reporter: { id: 5, username: 'lee', name: '이진우', kind: 'HUMAN' },
  cycles: [
    { id: 3, name: 'GW-3', status: 'ACTIVE' },
    { id: 2, name: 'GW-2', status: 'COMPLETED' },
  ],
  customFields: [{ defId: 7, name: '고객사', type: 'SELECT', value: '한빛' }],
})

function savedView(id: number, name: string, query: string): SavedViewResponse {
  return { id, name, query, visibility: 'PRIVATE', ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '' }
}

/** 목록 화면을 연다 — 사이클 유무에 따라 기본 그룹이 달라진다. 저장된 뷰는 서버 상태 배열을 GET/POST/PATCH 가 공유한다. */
function open(path: string, { cycles = [] as CycleResponse[], views = [] as SavedViewResponse[] } = {}) {
  const requests = recordRequests()
  const view = renderProjectScreen(path, {
    handlers: [
      http.post(`/api/v1/projects/${KEY}/saved-views`, async ({ request }) => {
        const body = (await request.json()) as SavedViewResponse
        const created = savedView(views.length + 1, body.name, body.query)
        views.push(created)
        return HttpResponse.json(created, { status: 201 })
      }),
      http.patch(`/api/v1/projects/${KEY}/saved-views/:id`, async ({ request, params }) => {
        const body = (await request.json()) as Partial<SavedViewResponse>
        const i = views.findIndex((v) => v.id === Number(params.id))
        views[i] = { ...views[i], ...body }
        return HttpResponse.json(views[i])
      }),
      ...issueListHandlers({
        // 사이클 그룹은 구간별(cycle=3·null) 요청 — 진행 중 구간에만 이슈를 둔다.
        issues: (url) => createIssueSearchResponse(url.searchParams.get('cycle') === 'null' ? [] : [ISSUE], null),
        extra: { fields: FIELD_DEFS, cycles, 'cycles/progress': [], 'saved-views': () => views },
      }),
    ],
  })
  return { ...view, requests, views }
}

/** 보이는 헤더 문구(스크린리더 전용 상태·우선순위·작업은 뺀다)를 순서대로. */
function visibleHeaders(scope: Element) {
  return [...scope.querySelectorAll('th')]
    .filter((th) => !th.querySelector('.sr-only') && (th.textContent ?? '').trim() !== '')
    .map((th) => (th.textContent ?? '').trim())
}
const thead = () => document.querySelector('thead')!
const params = (location: string) => new URL(location, 'http://x').searchParams

/** 선택 열 셀 — 평면·사이클 구간이 같은 셀 렌더러를 쓰는지 같은 기대값으로 본다. */
function expectSelectedCells(row: HTMLElement) {
  expect(within(row).getByTestId('issue-row-1-due')).toHaveTextContent(/^10월 21일$/)
  const closed = within(row).getByTestId('issue-row-1-closed')
  expect(closed).toHaveTextContent('✓ 10월 23일')
  // 스크린리더용 구분어(sr-only) — 날짜와 「+2일」 이 붙어 읽히지 않는다.
  expect(closed).toHaveTextContent('10월 23일, 마감 +2일')
  // 셀 툴팁에 시각·완료·늦음 — 말줄임이 「+2일」 을 가려도 값을 볼 수 있다.
  expect(closed.closest('td')).toHaveAttribute('title', '2026-10-23 14:05 완료 · 마감 +2일')
  expect(within(row).getByTestId('issue-row-1-closed-late')).toHaveTextContent(/^\+2일$/)
  expect(within(row).getByTestId('issue-row-1-closed-late')).toHaveClass('text-warning-text')
  expect(within(row).getByTestId('issue-row-1-reporter')).toHaveTextContent('이진우')
  expect(within(row).getByTestId('issue-row-1-cycle')).toHaveTextContent(/^GW-3 \+1$/)
  expect(within(row).getByTestId('issue-row-1-cycle')).toHaveAttribute('title', 'GW-3, GW-2')
  expect(within(row).getByTestId('issue-row-1-cf7')).toHaveTextContent(/^한빛$/)
  expect(within(row).getByLabelText('우선순위 높음')).toBeInTheDocument()
}

const EXPECTED_HEADERS = ['ID', '제목', '담당자', '마감', '완료일', '보고자', '사이클', '고객사']

describe('이슈 목록 열 정의 (WP-270)', () => {
  test('평면 목록 — URL cols 의 선택 열이 정해진 순서로 헤더·셀에 보인다', async () => {
    open(`/projects/${KEY}?group=none&cols=${COLS}`)
    const row = await screen.findByTestId('issue-row-1')
    await waitFor(() => expect(visibleHeaders(thead())).toEqual(EXPECTED_HEADERS))
    expectSelectedCells(row)
  })

  test('사이클 구간 목록 — 상단 열 이름 행과 구간 표가 같은 열 정의(같은 칸 수)를 쓴다', async () => {
    open(`/projects/${KEY}?cols=${COLS}`, { cycles: [CYCLE] })
    const section = await screen.findByTestId('list-cycle-section-cycle-3')
    const row = await within(section).findByTestId('issue-row-1')
    const head = screen.getByTestId('list-cycle-column-head')
    await waitFor(() => expect(visibleHeaders(head)).toEqual(EXPECTED_HEADERS))
    expectSelectedCells(row)
    // 고정 5칸 + 선택 7칸 — 구간 표의 열 수가 상단 열 이름 행과 같다(정렬 유지).
    expect(head.querySelectorAll('th')).toHaveLength(12)
    expect(section.querySelectorAll('thead th')).toHaveLength(12)
  })

  test('그룹 목록(group=status)에서 선택 열이 늘면 그룹 헤더 colSpan 이 헤더 칸 수와 같다', async () => {
    open(`/projects/${KEY}?group=status&cols=${COLS}`)
    await screen.findByTestId('issue-row-1')
    const ths = thead().querySelectorAll('th')
    expect(ths).toHaveLength(12)
    const groupCell = document.querySelector('tbody[data-testid^="list-group-"] > tr td')!
    expect(groupCell).toHaveAttribute('colspan', String(ths.length))
  })

  test('cols= (빈 값)이면 선택 열이 모두 꺼진다 — 우선순위·담당자·마감 없음', async () => {
    open(`/projects/${KEY}?group=none&cols=`)
    const row = await screen.findByTestId('issue-row-1')
    await waitFor(() => expect(visibleHeaders(thead())).toEqual(['ID', '제목']))
    expect([...thead().querySelectorAll('th')].some((th) => th.textContent?.includes('우선순위'))).toBe(false)
    expect(within(row).queryByTestId('issue-row-1-due')).not.toBeInTheDocument()
    expect(within(row).queryByLabelText('우선순위 높음')).not.toBeInTheDocument()
  })

  test('cols 가 없으면 기본 열 — 우선순위(sr-only)·ID·제목·담당자·마감, 날짜는 연도 생략 + 정확한 값 툴팁', async () => {
    open(`/projects/${KEY}?group=none`)
    const row = await screen.findByTestId('issue-row-1')
    await waitFor(() => expect(visibleHeaders(thead())).toEqual(['ID', '제목', '담당자', '마감']))
    expect([...thead().querySelectorAll('th .sr-only')].filter((el) => el.textContent?.includes('우선순위'))).toHaveLength(1)
    expect(within(row).getByLabelText('우선순위 높음')).toBeInTheDocument()
    expect(within(row).getByTestId('issue-row-1-due')).toHaveTextContent(/^10월 21일$/)
    expect(within(row).getByTestId('issue-row-1-due')).toHaveAttribute('title', '2026-10-21')
    expect(within(row).queryByTestId('issue-row-1-closed')).not.toBeInTheDocument()
  })
})

type User = ScreenUser

/** 열 메뉴에서 한 항목을 토글하고 닫는다(메뉴는 고른 뒤에도 열려 있다). */
async function toggleColumn(user: User, key: string) {
  await user.click(screen.getByTestId('issue-column-picker'))
  await user.click(await screen.findByTestId(`issue-column-option-${key}`))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('issue-column-menu')).not.toBeInTheDocument())
}

/** 필터 바에서 facet 값 하나를 고른다. */
async function addFilter(user: User, facet: string, value: string) {
  await openQuickFacet(user, facet)
  await user.click(await screen.findByTestId(`facet-value-${facet}-${value}`))
  await user.keyboard('{Escape}')
}

/** 뷰 저장 대화상자 — 이름을 넣고(열 담기 선택) 저장한다. */
async function saveView(user: User, name: string, { includeColumns = false } = {}) {
  await user.click(screen.getByTestId('save-view-button'))
  const nameInput = await screen.findByTestId('save-view-name')
  if (includeColumns) await user.click(screen.getByTestId('save-view-include-columns'))
  fireEvent.change(nameInput, { target: { value: name } })
  await user.click(screen.getByTestId('save-view-submit'))
  await waitFor(() => expect(screen.queryByTestId('save-view-submit')).not.toBeInTheDocument())
}

/** 개인 열 저장값(localStorage 의 issue-list-columns* 항목) 스냅샷. */
const personalColumnsStorage = () =>
  Object.fromEntries(Object.entries(window.localStorage).filter(([k]) => k.includes('issue-list-columns')))

const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed')
const headersEq = (expected: string[]) => waitFor(() => expect(visibleHeaders(thead())).toEqual(expected))

describe('열 고르기 메뉴·완료일 자동 열 (WP-270)', () => {
  test('「열」 메뉴 — 체크 상태·커스텀 필드 후보, 고른 뒤에도 열림, URL 엔 cols 없음, 필터를 바꿔도 유지, 「기본 열로 되돌리기」', async () => {
    const { user, location } = open(`/projects/${KEY}?group=none`)
    await screen.findByTestId('issue-row-1')
    await user.click(screen.getByTestId('issue-column-picker'))
    expect(await screen.findByTestId('issue-column-menu')).toHaveTextContent('표시할 열')
    expect(screen.getByTestId('issue-column-option-assignee')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('issue-column-option-reporter')).toHaveAttribute('aria-checked', 'false')
    expect(await screen.findByTestId('issue-column-option-cf7')).toHaveTextContent(/^고객사$/)
    await user.click(screen.getByTestId('issue-column-option-reporter'))
    expect(screen.getByTestId('issue-column-option-reporter')).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Escape}')

    await headersEq(['ID', '제목', '담당자', '마감', '보고자'])
    expect(screen.getByTestId('issue-row-1-reporter')).toHaveTextContent('이진우')
    expect(params(location()).has('cols')).toBe(false)

    await addFilter(user, 'priority', 'HIGH')
    await waitFor(() => expect(location()).toMatch(/priority=HIGH/))
    await headersEq(['ID', '제목', '담당자', '마감', '보고자'])
    await user.click(screen.getByTestId('issue-column-picker'))
    await user.click(await screen.findByTestId('issue-column-reset'))
    await headersEq(['ID', '제목', '담당자', '마감'])
  })

  test('완료일 필터 「지난 주」를 걸면 완료일 열이 자동으로 보이고 메뉴엔 「필터로 켜짐」(비활성), 풀면 사라진다', async () => {
    const { user, location } = open(`/projects/${KEY}?group=none`)
    await screen.findByTestId('issue-row-1')
    expect(screen.queryByTestId('issue-row-1-closed')).not.toBeInTheDocument()
    await addFilter(user, 'closedIn', 'last-week')
    await waitFor(() => expect(location()).toMatch(/closedIn=last-week/))
    await headersEq(['ID', '제목', '담당자', '마감', '완료일'])
    expect(screen.getByTestId('issue-row-1-closed')).toHaveTextContent('✓ 10월 23일')
    await user.click(screen.getByTestId('issue-column-picker'))
    const closedOption = await screen.findByTestId('issue-column-option-closed')
    expect(closedOption).toHaveAttribute('aria-checked', 'true')
    expect(closedOption).toHaveAttribute('data-disabled', '')
    expect(closedOption).toHaveTextContent('필터로 켜짐')
    // 스크린리더 이름이 「완료일필터로 켜짐」 으로 붙지 않는다.
    expect(closedOption).toHaveAccessibleName(/^완료일\s*,\s*필터로 켜짐$/)
    await user.keyboard('{Escape}')
    // 자동 열은 URL 에 남지 않는다.
    expect(params(location()).has('cols')).toBe(false)

    await user.click(screen.getByTestId('quick-filter-closedIn-remove'))
    await waitFor(() => expect(location()).not.toMatch(/closedIn=/))
    await headersEq(['ID', '제목', '담당자', '마감'])
    await user.click(screen.getByTestId('issue-column-picker'))
    expect(await screen.findByTestId('issue-column-option-closed')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('issue-column-option-closed')).not.toHaveTextContent('필터로 켜짐')
  })

  test('보드 뷰에선 「열」 버튼이 없다', async () => {
    const { user, location } = open(`/projects/${KEY}?group=none`)
    expect(await screen.findByTestId('issue-column-picker')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '보드' }))
    await waitFor(() => expect(location()).toMatch(/view=board/))
    expect(screen.queryByTestId('issue-column-picker')).not.toBeInTheDocument()
  })
})

describe('저장된 뷰와 열 (WP-270, 스펙 4.7)', () => {
  test('「현재 열 구성도 함께 저장」은 기본 꺼짐 — POST query 에 cols 가 없고, 그 뷰를 열면 각자 개인 열로 보인다', async () => {
    const { user, location, requests } = open(`/projects/${KEY}?group=none&priority=HIGH`)
    await screen.findByTestId('issue-row-1')
    await toggleColumn(user, 'reporter')
    await headersEq(['ID', '제목', '담당자', '마감', '보고자'])
    await user.click(screen.getByTestId('save-view-button'))
    expect(await screen.findByTestId('save-view-include-columns')).not.toBeChecked()
    expect(screen.getByTestId('save-view-columns-hint')).toHaveTextContent(/^\(우선순위·담당자·마감·보고자\)$/)
    fireEvent.change(screen.getByTestId('save-view-name'), { target: { value: '높음' } })
    await user.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(requests.count('POST', `/api/v1/projects/${KEY}/saved-views`)).toBe(1))
    await waitFor(() => expect(requests.last('POST', `/api/v1/projects/${KEY}/saved-views`)!.body).toBeTruthy())
    const query = new URLSearchParams((requests.last('POST', `/api/v1/projects/${KEY}/saved-views`)!.body as { query: string }).query)
    expect(query.has('cols')).toBe(false)
    expect(query.get('priority')).toBe('HIGH')
    await waitFor(() => expect(pressed('view-chip-1')).toBe('true'))
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()

    // 다른 개인 열(마일스톤 추가)로 바꾼 뒤 그 뷰를 열어도 뷰가 열을 담지 않았으니 개인 열 그대로.
    await user.click(screen.getByTestId('view-chip-all'))
    await toggleColumn(user, 'milestone')
    await user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(location()).toMatch(/priority=HIGH/))
    expect(params(location()).has('cols')).toBe(false)
    await headersEq(['ID', '제목', '담당자', '마감', '보고자', '마일스톤'])
    expect(pressed('view-chip-1')).toBe('true')
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()
  })

  test('열을 담아 저장하면 POST query 에 고른 열(자동 완료일 열 제외)이 실리고, 열만 바꿔도 「뷰 업데이트」로 새 열을 PATCH 한다', async () => {
    const { user, location, requests } = open(`/projects/${KEY}?group=none&priority=HIGH&closedIn=last-week`)
    await screen.findByTestId('issue-row-1')
    await toggleColumn(user, 'reporter')
    await headersEq(['ID', '제목', '담당자', '마감', '완료일', '보고자'])
    await user.click(screen.getByTestId('save-view-button'))
    // 힌트는 고른 열만 — 완료일 필터로 자동으로 붙은 열은 저장 대상이 아니다.
    expect(await screen.findByTestId('save-view-columns-hint')).toHaveTextContent(/^\(우선순위·담당자·마감·보고자\)$/)
    await user.click(screen.getByTestId('save-view-include-columns'))
    fireEvent.change(screen.getByTestId('save-view-name'), { target: { value: '보고자 보기' } })
    await user.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(requests.last('POST', `/api/v1/projects/${KEY}/saved-views`)?.body).toBeTruthy())
    const query = new URLSearchParams((requests.last('POST', `/api/v1/projects/${KEY}/saved-views`)!.body as { query: string }).query)
    expect(query.get('cols')).toBe('priority,assignee,due,reporter')
    expect(query.get('priority')).toBe('HIGH')
    expect(query.get('closedIn')).toBe('last-week')
    await waitFor(() => expect(pressed('view-chip-1')).toBe('true'))
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()

    // 개인 열을 기본으로 되돌린 뒤 뷰를 열면 뷰에 담긴 열로 보인다.
    await user.click(screen.getByTestId('view-chip-all'))
    await user.click(screen.getByTestId('issue-column-picker'))
    await user.click(await screen.findByTestId('issue-column-reset'))
    await headersEq(['ID', '제목', '담당자', '마감'])
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(params(location()).get('cols')).toBe('priority,assignee,due,reporter'))
    await headersEq(['ID', '제목', '담당자', '마감', '완료일', '보고자'])
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()

    // 열만 바꿔도 이 뷰는 「수정됨」 → 「뷰 업데이트」가 새 열을 저장한다.
    await toggleColumn(user, 'milestone')
    await user.click(await screen.findByTestId('update-view-button'))
    await waitFor(() => expect(requests.last('PATCH', `/api/v1/projects/${KEY}/saved-views/1`)?.body).toBeTruthy())
    const updated = new URLSearchParams((requests.last('PATCH', `/api/v1/projects/${KEY}/saved-views/1`)!.body as { query: string }).query)
    expect(updated.get('cols')).toBe('priority,assignee,due,reporter,milestone')
    expect(updated.get('priority')).toBe('HIGH')
    await waitFor(() => expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument())
    expect(pressed('view-chip-1')).toBe('true')
  })

  test('cols 없는 예전 뷰 — 열면 개인 열로 보이고, 열을 바꿔도 「뷰 업데이트」(수정됨)가 뜨지 않는다', async () => {
    const { user, location } = open(`/projects/${KEY}?group=none`, { views: [savedView(1, '높음', 'priority=HIGH&group=none')] })
    await screen.findByTestId('issue-row-1')
    await toggleColumn(user, 'reporter')
    await headersEq(['ID', '제목', '담당자', '마감', '보고자'])
    await user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(location()).toMatch(/priority=HIGH/))
    expect(params(location()).has('cols')).toBe(false)
    expect(pressed('view-chip-1')).toBe('true')
    await headersEq(['ID', '제목', '담당자', '마감', '보고자'])
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()
    // 열을 바꾸면 개인 저장값이 바뀌고(URL 엔 cols 없음) 뷰는 그대로 활성 — 열을 담지 않은 뷰라 비교하지 않는다.
    await toggleColumn(user, 'milestone')
    await headersEq(['ID', '제목', '담당자', '마감', '보고자', '마일스톤'])
    expect(params(location()).has('cols')).toBe(false)
    expect(pressed('view-chip-1')).toBe('true')
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()
  })

  test('cols 를 담은 뷰 안의 「기본 열로 되돌리기」는 그 화면 열만 기본으로 — 개인 열은 남고, 열 없는 뷰로 옮기면 개인 열로 보인다', async () => {
    const { user, location } = open(`/projects/${KEY}?group=none`, {
      views: [savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone'), savedView(2, '중간', 'priority=MID&group=none')],
    })
    await screen.findByTestId('issue-row-1')
    await toggleColumn(user, 'reporter')
    await headersEq(['ID', '제목', '담당자', '마감', '보고자'])
    await user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(params(location()).get('cols')).toBe('assignee,milestone'))
    await headersEq(['ID', '제목', '담당자', '마일스톤'])
    await user.click(screen.getByTestId('issue-column-picker'))
    await user.click(await screen.findByTestId('issue-column-reset'))
    await waitFor(() => expect(params(location()).get('cols')).toBe('priority,assignee,due'))
    await headersEq(['ID', '제목', '담당자', '마감'])
    await user.keyboard('{Escape}')
    expect(await screen.findByTestId('update-view-button')).toBeInTheDocument()

    await user.click(screen.getByTestId('view-chip-2'))
    await waitFor(() => expect(location()).toMatch(/priority=MID/))
    expect(params(location()).has('cols')).toBe(false)
    await headersEq(['ID', '제목', '담당자', '마감', '보고자'])
    expect(pressed('view-chip-2')).toBe('true')
  })

  test('필터가 같은 두 뷰(열 담음·안 담음) — 열을 담은 뷰에서 열만 바꾸면 그 뷰가 수정됨으로 남고, 업데이트는 그 뷰로 간다', async () => {
    const { user, location, requests } = open(`/projects/${KEY}?group=none`, {
      views: [savedView(1, '높음', 'priority=HIGH&group=none'), savedView(2, '높음 + 열', 'priority=HIGH&group=none&cols=assignee,milestone')],
    })
    await screen.findByTestId('issue-row-1')
    await user.click(screen.getByTestId('view-chip-2'))
    await waitFor(() => expect(pressed('view-chip-2')).toBe('true'))
    expect(pressed('view-chip-1')).toBe('false')
    await toggleColumn(user, 'reporter')
    await waitFor(() => expect(params(location()).get('cols')).toBe('assignee,reporter,milestone'))
    expect(await screen.findByTestId('update-view-button')).toBeInTheDocument()
    expect(pressed('view-chip-1')).toBe('false')
    await user.click(screen.getByTestId('update-view-button'))
    await waitFor(() => expect(requests.of('PATCH', /\/saved-views\/\d+$/).map((r) => r.path)).toEqual([`/api/v1/projects/${KEY}/saved-views/2`]))
  })

  test('cols 를 담은 뷰를 열고 필터를 바꿔도 URL cols 는 유지되고, 「전체」로 돌아가면 개인 열로', async () => {
    const { user, location } = open(`/projects/${KEY}?group=none`, {
      views: [savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone')],
    })
    await screen.findByTestId('issue-row-1')
    await user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(params(location()).get('cols')).toBe('assignee,milestone'))
    await headersEq(['ID', '제목', '담당자', '마일스톤'])
    expect(pressed('view-chip-1')).toBe('true')
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()

    await addFilter(user, 'priority', 'MID')
    expect(await screen.findByTestId('update-view-button')).toBeInTheDocument()
    expect(params(location()).get('cols')).toBe('assignee,milestone')

    await user.click(screen.getByTestId('view-chip-all'))
    await waitFor(() => expect(location()).not.toMatch(/cols=/))
    await headersEq(['ID', '제목', '담당자', '마감'])
  })

  test('열을 담아 새 뷰를 저장하면 URL 에도 그 열이 실린다 — 바로 열을 바꿔도 「뷰 업데이트」가 뜨고 개인 열 저장값은 그대로', async () => {
    const { user, location } = open(`/projects/${KEY}?group=none&priority=HIGH`)
    await screen.findByTestId('issue-row-1')
    await toggleColumn(user, 'reporter')
    await headersEq(['ID', '제목', '담당자', '마감', '보고자'])
    const personal = personalColumnsStorage()
    expect(Object.keys(personal)).toHaveLength(1)

    await saveView(user, '보고자 보기', { includeColumns: true })
    await waitFor(() => expect(params(location()).get('cols')).toBe('priority,assignee,due,reporter'))
    await waitFor(() => expect(pressed('view-chip-1')).toBe('true'))
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()

    await toggleColumn(user, 'milestone')
    await waitFor(() => expect(params(location()).get('cols')).toBe('priority,assignee,due,reporter,milestone'))
    expect(await screen.findByTestId('update-view-button')).toBeInTheDocument()
    expect(personalColumnsStorage()).toEqual(personal)
  })

  test('열을 담은 뷰를 「뷰 업데이트」하면 URL 에도 그 열이 실려, 뒤이은 열 변경이 개인 설정이 아니라 뷰를 바꾼다', async () => {
    const { user, location, requests } = open(`/projects/${KEY}?group=none&priority=HIGH`, {
      // 기본 열을 담은 뷰 — 개인 열이 기본이면 URL cols 없이도 일치해 활성이 된다.
      views: [savedView(1, '높음', 'priority=HIGH&group=none&cols=priority,assignee,due')],
    })
    await screen.findByTestId('issue-row-1')
    await waitFor(() => expect(pressed('view-chip-1')).toBe('true'))
    expect(params(location()).has('cols')).toBe(false)

    await addFilter(user, 'priority', 'MID')
    await user.click(await screen.findByTestId('update-view-button'))
    await waitFor(() => expect(requests.last('PATCH', `/api/v1/projects/${KEY}/saved-views/1`)?.body).toBeTruthy())
    expect(new URLSearchParams((requests.last('PATCH', `/api/v1/projects/${KEY}/saved-views/1`)!.body as { query: string }).query).get('cols')).toBe(
      'priority,assignee,due',
    )
    await waitFor(() => expect(params(location()).get('cols')).toBe('priority,assignee,due'))
    await waitFor(() => expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument())

    const personal = personalColumnsStorage()
    await toggleColumn(user, 'reporter')
    expect(await screen.findByTestId('update-view-button')).toBeInTheDocument()
    expect(personalColumnsStorage()).toEqual(personal)
  })

  test('열을 담은 뷰에서 열 없이 새 뷰로 저장하면 URL cols 가 빠져 개인 열로 보인다', async () => {
    const { user, location, requests } = open(`/projects/${KEY}?group=none`, {
      views: [savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone')],
    })
    await screen.findByTestId('issue-row-1')
    await user.click(screen.getByTestId('view-chip-1'))
    await headersEq(['ID', '제목', '담당자', '마일스톤'])
    await addFilter(user, 'priority', 'MID')
    await user.click(screen.getByTestId('save-view-button'))
    expect(await screen.findByTestId('save-view-include-columns')).not.toBeChecked()
    fireEvent.change(screen.getByTestId('save-view-name'), { target: { value: '높음·중간' } })
    await user.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(requests.last('POST', `/api/v1/projects/${KEY}/saved-views`)?.body).toBeTruthy())
    expect(new URLSearchParams((requests.last('POST', `/api/v1/projects/${KEY}/saved-views`)!.body as { query: string }).query).has('cols')).toBe(false)
    await waitFor(() => expect(params(location()).has('cols')).toBe(false))
    await headersEq(['ID', '제목', '담당자', '마감'])
    await waitFor(() => expect(pressed('view-chip-2')).toBe('true'))
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()
  })

  test.each([false, true])('열을 담은 뷰에서 열만 바꾸고 「새 뷰로 저장」(열 담음=%s) — 새 뷰가 활성, 예전 뷰는 수정됨으로 남지 않는다 (WP-473)', async (includeColumns) => {
    const { user, location } = open(`/projects/${KEY}?group=none`, {
      views: [savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone')],
    })
    await screen.findByTestId('issue-row-1')
    await user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(pressed('view-chip-1')).toBe('true'))
    await toggleColumn(user, 'reporter')
    expect(await screen.findByTestId('update-view-button')).toBeInTheDocument()
    await saveView(user, '새 보기', { includeColumns })
    await waitFor(() => expect(pressed('view-chip-2')).toBe('true'))
    expect(pressed('view-chip-1')).toBe('false')
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()
    if (includeColumns) await waitFor(() => expect(params(location()).get('cols')).toBe('assignee,reporter,milestone'))
    else await waitFor(() => expect(params(location()).has('cols')).toBe(false))
  })

  test('활성 뷰가 아닌 뷰를 ⋯ 수정 「현재 필터로 갱신」 해도 지금 화면의 URL 열은 바뀌지 않는다', async () => {
    const { user, location, requests } = open(`/projects/${KEY}?group=none`, {
      views: [
        savedView(1, '마일스톤 보기', 'priority=HIGH&group=none&cols=assignee,milestone'),
        // 열을 담지 않은 뷰 — 갱신 뒤 URL 을 이 뷰에 맞추면 지금 화면의 cols 가 빠져 버린다.
        savedView(2, '중간', 'priority=MID&group=none'),
      ],
    })
    await screen.findByTestId('issue-row-1')
    await user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(params(location()).get('cols')).toBe('assignee,milestone'))
    await user.click(screen.getByTestId('view-chip-menu-2'))
    await user.click(await screen.findByTestId('view-edit-2'))
    await user.click(await screen.findByTestId('save-view-update-query'))
    await user.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(requests.of('PATCH', /\/saved-views\/\d+$/).map((r) => r.path)).toEqual([`/api/v1/projects/${KEY}/saved-views/2`]))
    await waitFor(() => expect(screen.queryByTestId('save-view-submit')).not.toBeInTheDocument())
    expect(params(location()).get('cols')).toBe('assignee,milestone')
    await headersEq(['ID', '제목', '담당자', '마일스톤'])
  })
})
