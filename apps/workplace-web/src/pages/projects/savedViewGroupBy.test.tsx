// 저장 뷰 그룹 기준(#58·WP-472) — 페이지 테스트(WP-980).
// 우선순위 그룹 섹션 배치·빈 그룹 숨김, 서버 그룹 총계와 같은 필터로 센 요청(쿼리), 그룹 셀렉터 → URL,
// 뷰 저장 POST query 의 group 은 브라우저 없이 판정되므로 e2e/pages/projects/saved-view-group-by.spec.ts 에서 옮겼다(그 spec 은 모두 옮겨 지웠다).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { issueListHandlers, recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'

test('우선순위 그룹 목록 — 그룹 섹션별 행 배치 + 헤더 라벨 + 빈 그룹 숨김', async () => {
  const issues = [
    createIssue({ id: 1, number: 1, title: 'High one', priority: 'HIGH' }),
    createIssue({ id: 2, number: 2, title: 'Low one', priority: 'LOW' }),
  ]
  renderPage(`/projects/${KEY}?group=priority`, { handlers: issueListHandlers({ issues: () => createIssueSearchResponse(issues) }) })
  const high = await screen.findByTestId('list-group-HIGH', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(within(high).getByTestId('issue-row-1')).toBeInTheDocument()
  expect(within(screen.getByTestId('list-group-LOW')).getByTestId('issue-row-2')).toBeInTheDocument()
  expect(high).toHaveTextContent('높음')
  expect(screen.queryByTestId('list-group-MID')).not.toBeInTheDocument()
})

// 첫 페이지엔 TODO 2건만 왔지만 서버 총계는 32 — 헤더 수는 불러온 행 수가 아니라 서버 그룹 총계(WP-472).
test('그룹 헤더 수는 서버 그룹 총계이고, 목록과 같은 필터로 요청한다 (WP-472)', async () => {
  const requests = recordRequests()
  const issues = [
    createIssue({ id: 1, number: 1, title: 'Todo one', status: 'TODO' }),
    createIssue({ id: 2, number: 2, title: 'Todo two', status: 'TODO' }),
  ]
  renderPage(`/projects/${KEY}?group=status&q=todo`, {
    handlers: [
      http.get(`/api/v1/projects/${KEY}/issues/group-counts`, () =>
        // 상태 그룹 총계는 프로젝트 상태(statusId)별 — 시드 「할 일」 id 1, 「완료」 id 3 (WP-808).
        HttpResponse.json({ groupBy: 'statusId', groups: [{ key: '1', count: 32 }, { key: '3', count: 3 }] }),
      ),
      ...issueListHandlers({ issues: () => createIssueSearchResponse(issues, 'c1') }),
    ],
  })
  expect(await screen.findByTestId('list-group-count-1', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent(/^32$/)
  const counts = requests.last('GET', `/api/v1/projects/${KEY}/issues/group-counts`)!
  expect(counts.search.get('groupBy')).toBe('statusId')
  expect(counts.search.get('q')).toBe('todo')
  expect(counts.search.get('excludeSubtasks')).toBe('true')
  expect(counts.search.has('cursor')).toBe(false)
})

test('그룹 셀렉터 → URL group 동기화(view 유지), 「없음」은 group=none 을 명시한다 (#878)', async () => {
  const { user, location } = renderPage(`/projects/${KEY}?view=board`, { handlers: issueListHandlers({ issues: () => createIssueSearchResponse([]) }) })
  await user.click(await screen.findByTestId('group-by-trigger', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await user.click(await screen.findByTestId('group-by-assignee'))
  await waitFor(() => expect(location()).toMatch(/group=assignee/))
  expect(location()).toMatch(/view=board/)
  // 키를 지우면 사이클이 있는 프로젝트는 기본 사이클 그룹으로 돌아가므로 「없음」은 group=none 으로 남긴다.
  await waitFor(() => expect(screen.getByTestId('group-by-trigger')).toHaveTextContent('담당자'))
  await user.click(screen.getByTestId('group-by-trigger'))
  await user.click(await screen.findByTestId('group-by-none'))
  await waitFor(() => expect(location()).toMatch(/group=none/))
  expect(location()).not.toMatch(/group=assignee/)
})

test('group 설정 상태에서 뷰 저장 → POST query 에 group 이 실린다', async () => {
  const posts: { query: string; name: string }[] = []
  const { user } = renderPage(`/projects/${KEY}?group=assignee`, {
    handlers: [
      http.post(`/api/v1/projects/${KEY}/saved-views`, async ({ request }) => {
        const body = (await request.json()) as { query: string; name: string }
        posts.push(body)
        return HttpResponse.json(
          { id: 1, name: body.name, query: body.query, visibility: 'PRIVATE', ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '' },
          { status: 201 },
        )
      }),
      ...issueListHandlers({ issues: () => createIssueSearchResponse([]) }),
    ],
  })
  await user.click(await screen.findByTestId('save-view-button', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await user.click(await screen.findByTestId('save-view-name'))
  await user.paste('담당자 그룹')
  await user.click(screen.getByTestId('save-view-submit'))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].query).toContain('group=assignee')
  expect(posts[0].name).toBe('담당자 그룹')
})
