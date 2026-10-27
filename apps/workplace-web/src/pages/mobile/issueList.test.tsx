// 모바일 이슈 목록 — 툴바 시트(그룹·필터·뷰·에픽)와 행 메타 규칙의 페이지 테스트(WP-981).
// 시트에서 고른 값이 URL(쿼리)·칩 라벨·저장 뷰 payload 로 가는지, 권한별로 버튼이 보이는지는 브라우저 없이 판정되므로
// e2e/pages/mobile/issue-list.spec.ts 에서 옮겼다. 폭·줄 수·터치 크기(@layout)·검색창 포커스(@input)·히스토리 표식(@platform)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 이슈 목록 화면(ProjectDetailPage)만 renderScreen 으로 띄운다 — 행을 눌러 가는 상세는 그리지 않고 이동 주소만 본다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'
import type { IssueResponse } from '@/types/issue'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { serverEpicFilter } from '../../../e2e/fixtures/epic-search'
import ProjectDetailPage from '../projects/ProjectDetailPage'

// 이 파일은 iPhone 13 폭·터치 포인터 — matchMedia 결과가 파일 안에서 캐시되므로 첫 렌더 전에 한 번 부른다.
mockViewport()

const KEY = 'WP'
const ISSUES = `/api/v1/projects/${KEY}/issues`
const VIEWS = `/api/v1/projects/${KEY}/saved-views`

const epicRef = { number: 30, title: '결제 안정화 및 운영 모니터링 체계 정비 (2026 하반기 핵심 과제)', type: makeEpicType() }
const person = (id: number, name: string) => ({ id, username: `u${id}`, name, kind: 'HUMAN' as const })

// 메타가 가장 많은 행 — 에픽 부모 + 높음 + 하위 진행 + 라벨·담당자.
const LONG = createIssue({
  id: 21, number: 21, projectKey: KEY,
  title: '결제 모듈에서 환불 처리 시 간헐적으로 실패하는 문제의 원인을 분석하고 재시도 로직을 보강한다',
  parent: epicRef, priority: 'HIGH', dueDate: '2026-10-10', childCount: 3, childDoneCount: 1,
  labels: [{ id: 1, name: '결제', colorToken: 'BLUE' }],
  assignees: [person(1, '김하나'), person(2, '이둘')],
})
const PLAIN = createIssue({ id: 22, number: 22, projectKey: KEY, title: '일반 이슈', priority: 'MID' })
const SUB = createIssue({
  id: 23, number: 23, projectKey: KEY, title: '스토리 하위 이슈',
  parent: { number: 40, title: '스토리 부모', type: { ...makeTaskType(), name: 'STORY' } },
})
// 에픽 시트용 — 진행 있는 것, 하위 없는 것, 숫자가 긴 것.
const EPICS = [
  createIssue({ id: 30, number: 30, projectKey: KEY, title: '결제 안정화', type: makeEpicType(), childCount: 4, childDoneCount: 1 }),
  createIssue({ id: 12, number: 12, projectKey: KEY, title: '온보딩 개선', type: makeEpicType(), childCount: 0, childDoneCount: 0 }),
  createIssue({ id: 31, number: 31, projectKey: KEY, title: '레거시 이관', type: makeEpicType(), childCount: 125, childDoneCount: 10 }),
]
// 종료된 에픽(WP-245) — 진행 중 EPICS 와 번호가 겹치지 않게 52·53.
const CLOSED_EPICS = [
  createIssue({ id: 52, number: 52, projectKey: KEY, title: '팀 채팅 1차', type: makeEpicType(), status: 'DONE' }),
  createIssue({ id: 53, number: 53, projectKey: KEY, title: '구 메신저 연동', type: makeEpicType(), status: 'CANCELED' }),
]
const MY_BUG_VIEW = {
  id: 5, name: '내 버그', query: 'status=TODO&group=none', visibility: 'PRIVATE', ownerId: 1,
  mine: true, pinned: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
}

type MockOpts = {
  views?: unknown[]
  member?: boolean
  projectType?: 'TEAM' | 'OPEN'
  epics?: IssueResponse[]
  closedEpics?: IssueResponse[]
  /** 진행 중 사이클에 할당된 에픽 번호(WP-389) — 에픽 조회는 serverEpicFilter 로 서버처럼 거른다. */
  activeCycle?: number[]
}

/** 목록·메타·저장 뷰 API — 저장 뷰 쓰기(POST·PATCH)와 저장 뷰 조회 횟수를 기록한다. */
function issueApi(opts: MockOpts = {}) {
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = []
  let viewListRequests = 0
  const handlers = [
    http.get(`/api/v1/projects/${KEY}`, () =>
      HttpResponse.json(createProject({ key: KEY, type: opts.projectType ?? 'TEAM', viewerIsMember: opts.member ?? true })),
    ),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(VIEWS, () => {
      viewListRequests += 1
      return HttpResponse.json(opts.views ?? [])
    }),
    http.post(VIEWS, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      writes.push({ method: 'POST', path: VIEWS, body })
      return HttpResponse.json({ ...MY_BUG_VIEW, id: 9, name: body.name, query: body.query })
    }),
    http.patch(`${VIEWS}/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      writes.push({ method: 'PATCH', path: `${VIEWS}/${params.id}`, body })
      const base = (opts.views ?? []).find((v) => (v as { id: number }).id === Number(params.id)) as object
      return HttpResponse.json({ ...base, ...body })
    }),
    http.get(ISSUES, ({ request }) => {
      const url = new URL(request.url)
      const isEpicList = url.searchParams.get('type') === String(makeEpicType().id)
      const body = isEpicList
        ? serverEpicFilter(url, [...(opts.epics ?? EPICS), ...(opts.closedEpics ?? [])], opts.activeCycle)
        : [LONG, PLAIN, SUB]
      return HttpResponse.json(createIssueSearchResponse(body, null))
    }),
  ]
  return { handlers, writes, viewListRequests: () => viewListRequests }
}

/** 목록을 열고 첫 행이 뜰 때까지 기다린다. */
async function open(query = 'group=none', opts: MockOpts = {}) {
  const api = issueApi(opts)
  const page = renderMobileRoute('/projects/:key', <ProjectDetailPage />, { path: `/projects/${KEY}${query ? `?${query}` : ''}`, handlers: api.handlers })
  await screen.findByTestId('mobile-issue-toolbar')
  return { ...page, api }
}

/** 지금 주소의 쿼리 파라미터. */
const params = (location: () => string) => new URL(location(), 'http://x').searchParams

describe('모바일 이슈 목록 — 행 메타', () => {
  test('메타 줄에 키·높음·하위 진행이, 에픽 부모만 ◆ 줄로 보이고 보통 우선순위는 숨는다', async () => {
    await open()
    const meta = await screen.findByTestId('issue-row-21-meta')
    expect(meta).toHaveTextContent(`${KEY}-21`)
    expect(meta).toHaveTextContent('높음')
    expect(meta).toHaveTextContent('1/3')
    expect(screen.getByTestId('issue-row-21-epic')).toHaveTextContent('결제 안정화')
    expect(screen.getByTestId('issue-row-22-meta')).not.toHaveTextContent('보통')
    // STORY 부모는 에픽이 아니다 — ◆ 줄 없음.
    expect(screen.getByTestId('issue-row-23')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-row-23-epic')).not.toBeInTheDocument()
    // 표 머리는 모바일에서 그리지 않는다.
    expect(document.querySelector('thead')).toBeNull()
  })

  // 그룹이 이미 에픽이거나 특정 에픽으로 걸러 본 목록에서는 ◆ 줄이 같은 정보를 반복하므로 뺀다.
  test('그룹 「에픽」 안의 행은 에픽 메타를 생략한다', async () => {
    await open('group=epic')
    await screen.findByTestId('list-group-epic-30')
    expect(await screen.findByTestId('issue-row-21')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-row-21-epic')).not.toBeInTheDocument()
  })

  test('특정 에픽으로 필터된 목록은 에픽 메타를 생략한다', async () => {
    await open('group=none&parent=30')
    expect(await screen.findByTestId('issue-row-21')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-row-21-epic')).not.toBeInTheDocument()
  })

  // 데스크톱에서 열어 둔 에픽 패널 상태(localStorage)가 남아 있어도 모바일은 패널 없이 목록만 그린다.
  test('저장된 에픽 패널 열림 상태가 있어도 모바일에선 패널을 그리지 않는다', async () => {
    window.localStorage.setItem('epicSidePanel.open.WP', 'true')
    try {
      await open()
      await screen.findByTestId('issue-row-21-title')
      expect(screen.queryByTestId('epic-side-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('view-chip-bar')).not.toBeInTheDocument()
      expect(screen.queryByTestId('epic-panel-toggle')).not.toBeInTheDocument()
    } finally {
      window.localStorage.removeItem('epicSidePanel.open.WP')
    }
  })
})

describe('모바일 이슈 목록 — 툴바', () => {
  test('검색 모드를 오갔다 와도 선택한 저장 뷰 이름이 칩에 유지된다(WP-221)', async () => {
    const { user, location } = await open('', { views: [MY_BUG_VIEW] })
    await user.click(screen.getByTestId('mobile-chip-view'))
    await user.click(await screen.findByTestId('mobile-view-option-5'))
    await waitFor(() => expect(screen.queryByTestId('mobile-view-sheet')).not.toBeInTheDocument())
    expect(screen.getByTestId('mobile-chip-view')).toHaveTextContent('내 버그')
    await user.click(screen.getByTestId('mobile-search-open'))
    await user.click(screen.getByTestId('mobile-search-input'))
    await user.paste('환불')
    await waitFor(() => expect(params(location).get('q')).toBe('환불'))
    await user.click(screen.getByTestId('mobile-search-cancel'))
    // 검색어가 붙어 조건이 달라져도 선택한 뷰 이름(업데이트 대상)을 유지한다.
    expect(await screen.findByTestId('mobile-chip-view')).toHaveTextContent('내 버그')
    // 검색어는 남고 툴바에 점으로 알린다.
    expect(screen.getByTestId('mobile-search-dot')).toBeInTheDocument()
    expect(params(location).get('q')).toBe('환불')
  })

  test('그룹 시트 — 에픽을 고르면 group=epic, 칩 라벨이 바뀌고 에픽 묶음이 보인다', async () => {
    const { user, location } = await open('')
    const chip = screen.getByTestId('mobile-chip-group')
    expect(chip).toHaveTextContent('그룹: 없음')
    await user.click(chip)
    await screen.findByTestId('mobile-group-sheet')
    await user.click(screen.getByTestId('picker-option-epic'))
    await waitFor(() => expect(params(location).get('group')).toBe('epic'))
    expect(screen.getByTestId('mobile-chip-group')).toHaveTextContent('그룹: 에픽')
    expect(await screen.findByTestId('list-group-epic-30')).toBeInTheDocument()
  })

  test('필터 시트 — 빈 안내, ＋ 필터로 상태 추가 → status 쿼리·칩 개수, 전체 해제로 지운다', async () => {
    const { user, location } = await open('')
    await user.click(screen.getByTestId('mobile-chip-filter'))
    const sheet = await screen.findByTestId('mobile-filter-sheet')
    expect(within(sheet).getByTestId('mobile-filter-empty')).toHaveTextContent('적용된 필터 없음')
    await user.click(within(sheet).getByTestId('add-filter-trigger'))
    await user.click(await screen.findByTestId('add-filter-facet-status'))
    await user.click(await screen.findByRole('checkbox', { name: '진행 중' }))
    await waitFor(() => expect(params(location).get('status')).toBe('IN_PROGRESS'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('add-filter-facet-status')).not.toBeInTheDocument())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('mobile-filter-sheet')).not.toBeInTheDocument())
    expect(screen.getByTestId('mobile-chip-filter')).toHaveTextContent('필터 1')
    await user.click(screen.getByTestId('mobile-chip-filter'))
    await user.click(await screen.findByTestId('mobile-filter-clear'))
    await waitFor(() => expect(params(location).has('status')).toBe(false))
  })

  test('뷰 시트 — 저장 뷰 적용, 상태 필터 뷰에선 완료 토글이 켜진 채 비활성, 「전체」에서 켜면 closed=all 이고 시트는 남는다', async () => {
    const { user, location } = await open('', { views: [MY_BUG_VIEW] })
    const chip = screen.getByTestId('mobile-chip-view')
    expect(chip).toHaveTextContent('전체')
    await user.click(chip)
    await user.click(await screen.findByTestId('mobile-view-option-5'))
    await waitFor(() => expect(params(location).get('status')).toBe('TODO'))
    expect(screen.getByTestId('mobile-chip-view')).toHaveTextContent('내 버그')
    // 상태 필터가 있는 뷰는 종료 이슈 숨김을 이미 해제한다(#876).
    await user.click(screen.getByTestId('mobile-chip-view'))
    const toggle = await screen.findByTestId('mobile-view-closed-toggle')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByTestId('mobile-view-option-all'))
    await waitFor(() => expect(screen.getByTestId('mobile-chip-view')).toHaveTextContent('전체'))
    await user.click(screen.getByTestId('mobile-chip-view'))
    await user.click(await screen.findByTestId('mobile-view-closed-toggle'))
    await waitFor(() => expect(params(location).get('closed')).toBe('all'))
    expect(screen.getByTestId('mobile-view-sheet')).toBeInTheDocument()
  })

  // WP-741 — OPEN 비멤버는 저장된 뷰를 쓸 수 없다(서버 멤버 전용): 목록을 요청하지 않고 시트에 저장 행도 없다.
  test('뷰 시트 — OPEN 비멤버는 저장된 뷰를 요청하지 않고 「뷰 저장」 행이 없다', async () => {
    const { user, api } = await open('', { projectType: 'OPEN', member: false })
    await user.click(screen.getByTestId('mobile-chip-view'))
    expect(await screen.findByTestId('mobile-view-option-all')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-view-save')).not.toBeInTheDocument()
    expect(api.viewListRequests()).toBe(0)
  })

  test('목록/보드 토글 — 보드로 전환하면 view=board', async () => {
    const { user, location } = await open('')
    const toggle = screen.getByTestId('mobile-view-toggle')
    expect(toggle).toHaveAttribute('aria-label', '보드로 전환')
    await user.click(toggle)
    await waitFor(() => expect(params(location).get('view')).toBe('board'))
  })
})

describe('모바일 이슈 목록 — 에픽 시트', () => {
  test('에픽 선택 → parent 필터 + 칩 라벨, ✕ 로 해제', async () => {
    const { user, location } = await open()
    await user.click(screen.getByTestId('mobile-chip-epic'))
    const sheet = await screen.findByTestId('mobile-epic-sheet')
    expect(within(sheet).getByTestId('picker-option-all')).toBeInTheDocument()
    expect(within(sheet).getByTestId('picker-option-unassigned')).toBeInTheDocument()
    expect(await within(sheet).findByTestId('picker-option-epic-30')).toHaveTextContent('1/4')
    await user.click(within(sheet).getByTestId('picker-option-epic-30'))
    await waitFor(() => expect(screen.queryByTestId('mobile-epic-sheet')).not.toBeInTheDocument())
    expect(params(location).get('parent')).toBe('30')
    expect(screen.getByTestId('mobile-chip-epic')).toHaveTextContent('결제 안정화')
    await user.click(screen.getByTestId('mobile-chip-epic-clear'))
    await waitFor(() => expect(params(location).has('parent')).toBe(false))
    expect(screen.getByTestId('mobile-chip-epic')).toHaveTextContent('◆ 에픽')
  })

  test('이미 선택된 에픽을 다시 눌러도 필터가 유지된다', async () => {
    const { user, location } = await open('group=none&parent=30')
    await user.click(screen.getByTestId('mobile-chip-epic'))
    await user.click(await screen.findByTestId('picker-option-epic-30'))
    await waitFor(() => expect(screen.queryByTestId('mobile-epic-sheet')).not.toBeInTheDocument())
    expect(params(location).get('parent')).toBe('30')
    expect(screen.getByTestId('mobile-chip-epic')).toHaveTextContent('결제 안정화')
  })

  test('에픽 범위만 걸린 상태에서 뷰 시트 「전체」 를 눌러도 에픽 필터가 유지된다', async () => {
    const { user, location } = await open('group=none&parent=30')
    expect(screen.getByTestId('mobile-chip-view')).toHaveTextContent('전체')
    await user.click(screen.getByTestId('mobile-chip-view'))
    await user.click(await screen.findByTestId('mobile-view-option-all'))
    await waitFor(() => expect(screen.queryByTestId('mobile-view-sheet')).not.toBeInTheDocument())
    expect(params(location).get('parent')).toBe('30')
  })

  test('에픽 미할당 선택 → topLevel 필터', async () => {
    const { user, location } = await open()
    await user.click(screen.getByTestId('mobile-chip-epic'))
    await user.click(await screen.findByTestId('picker-option-unassigned'))
    await waitFor(() => expect(params(location).get('topLevel')).toBe('true'))
    expect(screen.getByTestId('mobile-chip-epic')).toHaveTextContent('에픽 미할당')
  })

  test('멤버는 시트에서 에픽 만들기 → 시트가 닫히고 생성 창이 열린다', async () => {
    const { user } = await open()
    await user.click(screen.getByTestId('mobile-chip-epic'))
    await user.click(await screen.findByTestId('mobile-epic-create'))
    await waitFor(() => expect(screen.queryByTestId('mobile-epic-sheet')).not.toBeInTheDocument())
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  test('비멤버에겐 에픽 만들기 버튼이 없다', async () => {
    const { user } = await open('group=none', { member: false })
    await user.click(screen.getByTestId('mobile-chip-epic'))
    await screen.findByTestId('mobile-epic-sheet')
    expect(await screen.findByTestId('picker-option-epic-30')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-epic-create')).not.toBeInTheDocument()
  })

  test('목록에 없는 에픽 번호로 진입하면 칩에 번호를 표시한다', async () => {
    await open('group=none&parent=99')
    expect(await screen.findByTestId('mobile-chip-epic')).toHaveTextContent('에픽 #99')
  })
})

describe('모바일 이슈 목록 — 저장 뷰 쓰기', () => {
  test('뷰 저장 — 시트가 닫히고 다이얼로그에서 저장하면 현재 조건으로 POST, 이후 body 잠금이 풀린다', async () => {
    const { user, api } = await open('group=none&status=TODO')
    await user.click(screen.getByTestId('mobile-chip-view'))
    await user.click(await screen.findByTestId('mobile-view-save'))
    await waitFor(() => expect(screen.queryByTestId('mobile-view-sheet')).not.toBeInTheDocument())
    await user.click(await screen.findByTestId('save-view-name'))
    await user.paste('내 할 일')
    await user.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(screen.queryByTestId('save-view-name')).not.toBeInTheDocument())
    expect(api.writes).toHaveLength(1)
    expect(api.writes[0].method).toBe('POST')
    expect(api.writes[0].body.name).toBe('내 할 일')
    expect(String(api.writes[0].body.query)).toContain('status=TODO')
    // 시트 → 다이얼로그 전환 뒤에도 body 에 pointer-events 잠금이 남지 않는다.
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'))
    await user.click(screen.getByTestId('mobile-chip-filter'))
    expect(await screen.findByTestId('mobile-filter-sheet')).toBeInTheDocument()
  })

  /** 필터 시트에서 상태 「진행 중」을 더해 저장 뷰와 다른(dirty) 조건을 만든다. */
  async function addInProgressFilter(user: ReturnType<typeof renderMobileRoute>['user'], location: () => string) {
    await user.click(screen.getByTestId('mobile-chip-filter'))
    const sheet = await screen.findByTestId('mobile-filter-sheet')
    await user.click(within(sheet).getByTestId('add-filter-trigger'))
    await user.click(await screen.findByTestId('add-filter-facet-status'))
    await user.click(await screen.findByRole('checkbox', { name: '진행 중' }))
    await waitFor(() => expect(params(location).get('status')).toBe('IN_PROGRESS'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('add-filter-facet-status')).not.toBeInTheDocument())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('mobile-filter-sheet')).not.toBeInTheDocument())
  }

  test('공유 뷰 업데이트 — 확인 후 PATCH 로 새 조건 저장, 이후 body 잠금이 풀린다', async () => {
    const shared = { ...MY_BUG_VIEW, id: 7, name: '팀 뷰', query: 'priority=HIGH&group=none', visibility: 'SHARED' }
    const { user, api, location } = await open(shared.query, { views: [shared] })
    expect(await screen.findByText('팀 뷰')).toBeInTheDocument()
    await addInProgressFilter(user, location)
    await user.click(screen.getByTestId('mobile-chip-view'))
    await user.click(await screen.findByTestId('mobile-view-update'))
    await waitFor(() => expect(screen.queryByTestId('mobile-view-sheet')).not.toBeInTheDocument())
    await user.click(await screen.findByTestId('update-view-confirm'))
    await waitFor(() => expect(screen.queryByTestId('update-view-confirm')).not.toBeInTheDocument())
    expect(api.writes.map((w) => [w.method, w.path])).toEqual([['PATCH', `${VIEWS}/7`]])
    expect(String(api.writes[0].body.query)).toContain('status=IN_PROGRESS')
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'))
  })

  // WP-654 — 남이 만든 공유 뷰는 고쳐 쓸 수 없다(서버 403). 조건을 바꿔도 「뷰 업데이트」 없이 「새 뷰로 저장」만 보인다.
  test('남의 공유 뷰를 고치면 「뷰 업데이트」 없이 「새 뷰로 저장」만 보인다', async () => {
    const shared = { ...MY_BUG_VIEW, id: 8, name: '남의 팀 뷰', query: 'priority=HIGH&group=none', visibility: 'SHARED', ownerId: 99, mine: false }
    const { user, location } = await open(shared.query, { views: [shared] })
    expect(await screen.findByText('남의 팀 뷰')).toBeInTheDocument()
    await addInProgressFilter(user, location)
    await user.click(screen.getByTestId('mobile-chip-view'))
    expect(await screen.findByTestId('mobile-view-save')).toBeEnabled()
    expect(screen.queryByTestId('mobile-view-update')).not.toBeInTheDocument()
  })
})

describe('모바일 이슈 목록 — 종료된 에픽(WP-245·WP-389)', () => {
  test('시트 맨 아래 「종료된 에픽」 을 펼쳐 종료 에픽으로 필터한다', async () => {
    const { user, location } = await open('group=none', { closedEpics: CLOSED_EPICS })
    await user.click(screen.getByTestId('mobile-chip-epic'))
    const sheet = await screen.findByTestId('mobile-epic-sheet')
    const toggle = await within(sheet).findByTestId('mobile-epic-closed-toggle')
    expect(toggle).toHaveTextContent('종료된 에픽')
    await waitFor(() => expect(toggle).toHaveTextContent('2'))
    expect(within(sheet).queryByTestId('mobile-epic-closed-52')).not.toBeInTheDocument()
    await user.click(toggle)
    expect(await within(sheet).findByTestId('mobile-epic-closed-52')).toHaveTextContent('완료')
    expect(within(sheet).getByTestId('mobile-epic-closed-53')).toHaveTextContent('취소')
    await user.click(within(sheet).getByTestId('mobile-epic-closed-52'))
    await waitFor(() => expect(screen.queryByTestId('mobile-epic-sheet')).not.toBeInTheDocument())
    expect(params(location).get('parent')).toBe('52')
    expect(screen.getByTestId('mobile-chip-epic')).toHaveTextContent('팀 채팅 1차')
  })

  // 새로고침과 같은 URL 진입 — 칩 라벨은 번호가 아닌 제목, 시트를 열면 종료 구역이 펼쳐져 선택이 보인다.
  // 「›」로 상세에 가는 이동은 시트 히스토리 항목을 되돌린 뒤 push 하는 브라우저 히스토리 동작이라 E2E(@platform)가 지킨다.
  test('종료 에픽 parent 로 진입하면 칩에 제목, 종료 구역이 펼쳐져 선택돼 있다', async () => {
    const { user } = await open('group=none&parent=52', { closedEpics: CLOSED_EPICS })
    await waitFor(() => expect(screen.getByTestId('mobile-chip-epic')).toHaveTextContent('팀 채팅 1차'))
    await user.click(screen.getByTestId('mobile-chip-epic'))
    expect(await screen.findByTestId('mobile-epic-closed-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByTestId('mobile-epic-closed-52')).toHaveAttribute('aria-selected', 'true')
  })

  test('진행 중 사이클에 할당된 종료 에픽은 위쪽에 종료 배지와 함께 보이고, 종료 구역에서는 빠진다 (WP-389)', async () => {
    const { user, location } = await open('group=none', { closedEpics: CLOSED_EPICS, activeCycle: [52] })
    await user.click(screen.getByTestId('mobile-chip-epic'))
    const sheet = await screen.findByTestId('mobile-epic-sheet')
    const option = await within(sheet).findByTestId('picker-option-epic-52')
    expect(within(option).getByTestId('closed-status-badge')).toHaveTextContent('완료')
    const toggle = await within(sheet).findByTestId('mobile-epic-closed-toggle')
    await waitFor(() => expect(toggle).toHaveTextContent('1'))
    await user.click(toggle)
    expect(await within(sheet).findByTestId('mobile-epic-closed-53')).toBeInTheDocument()
    expect(within(sheet).queryByTestId('mobile-epic-closed-52')).not.toBeInTheDocument()
    await user.click(option)
    await waitFor(() => expect(params(location).get('parent')).toBe('52'))
  })

  test('사이클 소속 종료 에픽 parent 로 진입해도 칩 라벨은 제목이다 (WP-389)', async () => {
    await open('group=none&parent=52', { closedEpics: CLOSED_EPICS, activeCycle: [52] })
    await waitFor(() => expect(screen.getByTestId('mobile-chip-epic')).toHaveTextContent('팀 채팅 1차'))
  })

  test('검색: 종료 에픽만 매칭되면 종료 구역을 펼쳐 보이고, 고른 뒤 다시 열면 검색창이 비어 있다 (WP-245 I2·I3)', async () => {
    // 활성 에픽 9개(> 8) — 검색창이 나타난다.
    const many = Array.from({ length: 9 }, (_, i) =>
      createIssue({ id: 10 + i, number: 10 + i, projectKey: KEY, title: `진행 에픽 ${i + 1}`, type: makeEpicType() }),
    )
    const { user, location } = await open('group=none', { epics: many, closedEpics: CLOSED_EPICS })
    await user.click(screen.getByTestId('mobile-chip-epic'))
    const sheet = await screen.findByTestId('mobile-epic-sheet')
    const search = await within(sheet).findByTestId('mobile-epic-sheet-search')
    await user.click(search)
    await user.paste('팀 채팅')
    await waitFor(() => expect(within(sheet).getByTestId('mobile-epic-closed-toggle')).toHaveAttribute('aria-expanded', 'true'))
    expect(sheet).not.toHaveTextContent('결과가 없습니다')
    await user.click(await within(sheet).findByTestId('mobile-epic-closed-52'))
    await waitFor(() => expect(screen.queryByTestId('mobile-epic-sheet')).not.toBeInTheDocument())
    expect(params(location).get('parent')).toBe('52')
    await user.click(screen.getByTestId('mobile-chip-epic'))
    expect(await screen.findByTestId('mobile-epic-sheet-search')).toHaveValue('')
  })

  test('활성 2 + 종료 8 = 10개(> 8)면 검색창이 보이고, 종료 에픽이 매칭되면 펼친다 (WP-245)', async () => {
    const few = Array.from({ length: 2 }, (_, i) =>
      createIssue({ id: 10 + i, number: 10 + i, projectKey: KEY, title: `에픽 ${i + 1}`, type: makeEpicType() }),
    )
    const closed = Array.from({ length: 8 }, (_, i) =>
      createIssue({ id: 52 + i, number: 52 + i, projectKey: KEY, title: `종료 에픽 ${i + 1}`, type: makeEpicType(), status: 'DONE' }),
    )
    const { user } = await open('group=none', { epics: few, closedEpics: closed })
    await user.click(screen.getByTestId('mobile-chip-epic'))
    const sheet = await screen.findByTestId('mobile-epic-sheet')
    const search = await within(sheet).findByTestId('mobile-epic-sheet-search')
    await user.click(search)
    await user.paste('종료 에픽 3')
    await waitFor(() => expect(within(sheet).getByTestId('mobile-epic-closed-toggle')).toHaveAttribute('aria-expanded', 'true'))
    expect(await within(sheet).findByTestId('mobile-epic-closed-54')).toBeInTheDocument()
  })
})
