// 저장한 뷰 고르기 표시(WP-1022) — 페이지 테스트(WP-971).
// 필터 없이 그룹·열만 담은 뷰(예: 담당자별로 묶기)를 골라도 「전체」가 켜진 채 그 뷰 칩은 꺼져 있어, 적용됐는지 알 수 없었다.
// 고르면 그 칩이 켜지고 「전체」는 꺼지며, 새로고침(같은 주소)해도 그대로다. 조건을 바꾸면 칩은 켜 둔 채 「수정됨」과
// 뷰 업데이트·새 뷰로 저장·되돌리기가 보이고, 되돌리면 저장된 조건으로 돌아간다. 필터를 담은 뷰도 같은 규칙이다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { SavedViewResponse } from '@/types/savedView'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

/** 저장 뷰 응답 하나 — 이름·쿼리만 다르게. */
function savedView(id: number, name: string, query: string): SavedViewResponse {
  return {
    id,
    name,
    query,
    visibility: 'PRIVATE',
    ownerId: 1,
    mine: true,
    pinned: false,
    createdAt: '2026-10-26T00:00:00Z',
    updatedAt: '2026-10-26T00:00:00Z',
  }
}

const VIEWS = [
  savedView(1, 'Soon', 'group=assignee'),
  savedView(2, '높음만', 'priority=HIGH&group=none'),
  savedView(3, '보드', 'view=board'),
]

const handlers = [
  http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))),
  http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
  http.get(`/api/v1/projects/${KEY}/members`, () =>
    HttpResponse.json([createMember({ userId: 1, name: '테스트 사용자', username: 'testuser', role: 'OWNER' })]),
  ),
  http.get(`/api/v1/projects/${KEY}/saved-views`, () => HttpResponse.json(VIEWS)),
  // 그룹 보기(담당자·우선순위)는 그룹별 개수를 따로 부른다 — 빈 묶음이면 섹션은 목록에서 정해진다.
  http.get(`/api/v1/projects/${KEY}/issues/group-counts`, ({ request }) =>
    HttpResponse.json({ groupBy: new URL(request.url).searchParams.get('groupBy') ?? 'assignee', groups: [] }),
  ),
  http.get(`/api/v1/projects/${KEY}/issues`, () =>
    HttpResponse.json(
      createIssueSearchResponse([createIssue({ id: 1, number: 7, projectKey: KEY, title: '로그인 세션 만료 처리', type: makeTaskType() })], null),
    ),
  ),
]

/** 칩이 켜졌는가 — 「전체」·뷰 칩 모두 aria-pressed 로 켜짐을 알린다. */
const pressed = (testId: string) => screen.getByTestId(testId).getAttribute('aria-pressed')

async function open(path = `/projects/${KEY}`, extra: typeof handlers = []) {
  const view = renderPage(path, { handlers: [...extra, ...handlers] })
  await screen.findByTestId('view-chip-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

describe('저장한 뷰 칩 — 지금 적용 중인 뷰 표시', () => {
  test('처음 화면은 「전체」가 켜져 있다', async () => {
    await open()
    expect(pressed('view-chip-all')).toBe('true')
    expect(pressed('view-chip-1')).toBe('false')
  })

  test('그룹만 담은 뷰를 고르면 그 칩이 켜지고 「전체」는 꺼지며, 조건이 주소에 적용된다', async () => {
    const { location } = await open()
    fireEvent.click(screen.getByTestId('view-chip-1'))
    expect(await screen.findByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true')
    expect(pressed('view-chip-all')).toBe('false')
    expect(new URLSearchParams(location().split('?')[1]).get('group')).toBe('assignee')
    // 바뀐 것이 없으니 저장은 막혀 있고 「수정됨」도 없다.
    expect(screen.getByTestId('save-view-button')).toBeDisabled()
    expect(screen.queryByTestId('view-chip-modified-1')).not.toBeInTheDocument()
  })

  test('그 뷰의 주소로 바로 열어도(새로고침) 그 칩이 켜져 있고, 그룹을 바꾸면 「전체」가 아니라 「수정됨」이다', async () => {
    await open(`/projects/${KEY}?group=assignee`)
    expect(await screen.findByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true')
    expect(pressed('view-chip-all')).toBe('false')

    fireEvent.click(screen.getByTestId('group-by-trigger'))
    fireEvent.click(await screen.findByTestId('group-by-priority'))
    expect(await screen.findByTestId('view-chip-modified-1')).toHaveTextContent('수정됨')
    expect(pressed('view-chip-all')).toBe('false')
  })

  test('이슈 화면에서 사이드바 고정 뷰로 열어도 고른 뷰다 — 그룹을 바꾸면 「전체」가 아니라 「수정됨」이다', async () => {
    const pinned = { id: 1, projectId: 1, projectKey: KEY, projectName: '프로젝트', name: 'Soon', query: 'group=assignee', createdAt: '2026-10-26T00:00:00Z' }
    const { user, location } = await open(`/projects/${KEY}`, [http.get('/api/v1/me/pinned-views', () => HttpResponse.json([pinned]))])
    await user.click(await screen.findByTestId('pinned-view-1'))
    await waitFor(() => expect(new URLSearchParams(location().split('?')[1]).get('group')).toBe('assignee'))
    expect(await screen.findByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('group-by-trigger'))
    fireEvent.click(await screen.findByTestId('group-by-priority'))
    expect(await screen.findByTestId('view-chip-modified-1')).toHaveTextContent('수정됨')
    expect(pressed('view-chip-all')).toBe('false')
  })

  test('어느 뷰와도 맞지 않는 주소로 처음 열면, 필터를 지우다 맞은 뷰는 붙잡지 않는다 — 그룹을 바꾸면 「전체」(#773)', async () => {
    const { location } = await open(`/projects/${KEY}?priority=LOW&group=assignee`)
    expect(pressed('view-chip-1')).toBe('false')
    // 필터 칩의 ✕ 로 필터를 지운다(「전체」 칩은 고른 뷰를 함께 잊으므로 이 경로가 아니다) — 남은 담당자 그룹이 Soon 과 같아져 켜진다.
    fireEvent.click(await screen.findByRole('button', { name: '우선순위 필터 제거' }))
    await waitFor(() => expect(new URLSearchParams(location().split('?')[1]).get('priority')).toBeNull())
    expect(await screen.findByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true')

    // 그룹을 더 돌리면 「전체」로 — 처음 연 뷰가 아니니 「수정됨」으로 남지 않는다.
    fireEvent.click(screen.getByTestId('group-by-trigger'))
    fireEvent.click(await screen.findByTestId('group-by-priority'))
    expect(await screen.findByTestId('view-chip-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('view-chip-modified-1')).not.toBeInTheDocument()
  })

  test('고른 뒤 그룹을 바꾸면 칩은 켜 둔 채 「수정됨」과 업데이트·되돌리기가 보이고, 되돌리면 저장된 조건으로 돌아간다', async () => {
    const { location } = await open()
    fireEvent.click(screen.getByTestId('view-chip-1'))
    expect(await screen.findByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('group-by-trigger'))
    fireEvent.click(await screen.findByTestId('group-by-priority'))

    expect(await screen.findByTestId('view-chip-modified-1')).toHaveTextContent('수정됨')
    expect(pressed('view-chip-1')).toBe('true')
    expect(pressed('view-chip-all')).toBe('false')
    expect(screen.getByTestId('update-view-button')).toBeInTheDocument()
    expect(within(screen.getByTestId('view-chip-bar')).getByTestId('save-view-button')).toHaveTextContent('새 뷰로 저장')

    fireEvent.click(screen.getByTestId('revert-view-button'))
    expect(await screen.findByTestId('save-view-button')).toBeDisabled()
    expect(screen.queryByTestId('view-chip-modified-1')).not.toBeInTheDocument()
    expect(new URLSearchParams(location().split('?')[1]).get('group')).toBe('assignee')
  })

  test('필터를 담은 뷰도 조건을 바꾸면 「수정됨」, 「전체」를 누르면 모두 꺼진다', async () => {
    await open()
    fireEvent.click(screen.getByTestId('view-chip-2'))
    expect(await screen.findByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('group-by-trigger'))
    fireEvent.click(await screen.findByTestId('group-by-priority'))
    expect(await screen.findByTestId('view-chip-modified-2')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('view-chip-all'))
    expect(await screen.findByTestId('view-chip-all')).toHaveAttribute('aria-pressed', 'true')
    expect(pressed('view-chip-2')).toBe('false')
    expect(screen.queryByTestId('view-chip-modified-2')).not.toBeInTheDocument()
  })

  test('보드 전용 뷰는 「전체」에서 그룹 「없음」만 골라도 저절로 켜지지 않는다(#599) — 칩을 눌러 고르면 켜진다', async () => {
    // 진행 중 사이클이 있어야 기본 그룹이 「사이클」이 되고, 「없음」을 고르면 주소에 group=none 이 생긴다.
    const activeCycle = {
      id: 1,
      projectId: 1,
      name: '1주차',
      goal: null,
      startDate: '2026-10-26',
      endDate: '2026-11-01',
      status: 'ACTIVE' as const,
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    }
    const { location } = await open(`/projects/${KEY}`, [http.get(`/api/v1/projects/${KEY}/cycles`, () => HttpResponse.json([activeCycle]))])
    fireEvent.click(screen.getByTestId('group-by-trigger'))
    fireEvent.click(await screen.findByTestId('group-by-none'))
    await waitFor(() => expect(new URLSearchParams(location().split('?')[1]).get('group')).toBe('none'))
    expect(await screen.findByTestId('view-chip-all')).toHaveAttribute('aria-pressed', 'true')
    expect(pressed('view-chip-3')).toBe('false')

    fireEvent.click(screen.getByTestId('view-chip-3'))
    expect(await screen.findByTestId('view-chip-3')).toHaveAttribute('aria-pressed', 'true')
    expect(pressed('view-chip-all')).toBe('false')
  })

  test('「전체」에서 그룹을 돌려 보다 같은 그룹의 뷰를 지나쳐도, 다른 그룹으로 가면 「전체」로 돌아온다(#773) — 「수정됨」이 남지 않는다', async () => {
    await open()
    fireEvent.click(screen.getByTestId('group-by-trigger'))
    fireEvent.click(await screen.findByTestId('group-by-assignee'))
    // 화면이 그 뷰와 같으니 그 뷰가 켜진다(필터를 담은 뷰와 같은 규칙).
    expect(await screen.findByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('group-by-trigger'))
    fireEvent.click(await screen.findByTestId('group-by-priority'))
    expect(await screen.findByTestId('view-chip-all')).toHaveAttribute('aria-pressed', 'true')
    expect(pressed('view-chip-1')).toBe('false')
    expect(screen.queryByTestId('view-chip-modified-1')).not.toBeInTheDocument()
  })
})
