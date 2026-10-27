// 모바일 에픽 시트와 「완료 모두 보기」(WP-390) — 페이지 테스트(WP-981).
// 진행 중 에픽은 토글을 건드리지 않고, 「종료된 에픽」에서 고르면 켜지며, 칩 ✕ 로 벗어나면 꺼지는 규칙은
// URL 상태·검색 쿼리 파라미터라 브라우저 없이 판정되므로 e2e/pages/mobile/epic-closed-toggle.spec.ts 에서 옮겼다(스펙은 삭제).
// 앱 셸을 보지 않으므로 이슈 목록 화면(ProjectDetailPage)만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import ProjectDetailPage from '../projects/ProjectDetailPage'

// 모바일 폭 — 필터 칩 줄(mobile-chip-*)과 에픽 바텀시트가 그려지는 조건.
mockViewport()

const KEY = 'WP'
const ISSUES = `/api/v1/projects/${KEY}/issues`
const EPIC_TYPE_ID = String(makeEpicType().id)

const OPEN_EPICS = [createIssue({ id: 10, number: 10, projectKey: KEY, title: '결제 리뉴얼', type: makeEpicType() })]
const CLOSED_EPICS = [createIssue({ id: 52, number: 52, projectKey: KEY, title: '팀 채팅 1차', type: makeEpicType(), status: 'DONE' })]

test('진행 중 에픽은 숨김을 유지하고, 종료된 에픽을 고르면 켜지며, 칩 ✕ 로 벗어나면 꺼진다', async () => {
  // 본문 이슈 검색(에픽 목록 조회 제외)의 쿼리 — 숨김 파라미터 확인용.
  const searches: URLSearchParams[] = []
  const { user, location } = renderMobileRoute('/projects/:key', <ProjectDetailPage />, {
    path: `/projects/${KEY}?group=none`,
    handlers: [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM' }))),
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
      http.get(ISSUES, ({ request }) => {
        const sp = new URL(request.url).searchParams
        if (sp.get('type') !== EPIC_TYPE_ID) {
          searches.push(sp)
          return HttpResponse.json(createIssueSearchResponse([], null))
        }
        return HttpResponse.json(createIssueSearchResponse((sp.get('status') ?? '').includes('DONE') ? CLOSED_EPICS : OPEN_EPICS, null))
      }),
    ],
  })
  const last = () => searches[searches.length - 1]

  // 진행 중 에픽 — 숨김 유지, URL 에 closed 없음.
  await user.click(await screen.findByTestId('mobile-chip-epic'))
  await user.click(within(await screen.findByTestId('mobile-epic-sheet')).getByRole('option', { name: /결제 리뉴얼/ }))
  await waitFor(() => expect(location()).toMatch(/parent=10/))
  expect(location()).not.toMatch(/closed=all/)
  await waitFor(() => expect(last()?.get('parent')).toBe('10'))
  expect(last()?.get('hideInactiveClosed')).toBe('true')

  // 종료된 에픽 — 토글이 켜지고 숨김 파라미터가 빠진다.
  await user.click(screen.getByTestId('mobile-chip-epic'))
  const sheet = await screen.findByTestId('mobile-epic-sheet')
  await user.click(within(sheet).getByTestId('mobile-epic-closed-toggle'))
  await user.click(await within(sheet).findByTestId('mobile-epic-closed-52'))
  await waitFor(() => expect(location()).toMatch(/parent=52/))
  expect(location()).toMatch(/closed=all/)
  await waitFor(() => expect(last()?.get('parent')).toBe('52'))
  expect(last()?.get('hideInactiveClosed')).toBeNull()

  // 뷰 시트의 「완료 모두 보기」 토글도 켜진 채 누를 수 있다.
  await waitFor(() => expect(screen.queryByTestId('mobile-epic-sheet')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mobile-chip-view'))
  const closedToggle = await screen.findByTestId('mobile-view-closed-toggle')
  expect(closedToggle).toHaveAttribute('aria-checked', 'true')
  expect(closedToggle).toBeEnabled()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('mobile-view-sheet')).not.toBeInTheDocument())

  // 칩 ✕ — 종료된 에픽에서 벗어나면 토글도 꺼진다.
  await user.click(screen.getByTestId('mobile-chip-epic-clear'))
  await waitFor(() => expect(location()).not.toMatch(/parent=/))
  expect(location()).not.toMatch(/closed=all/)
})
