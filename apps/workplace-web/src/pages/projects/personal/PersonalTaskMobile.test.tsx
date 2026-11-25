// WP-2113: 모바일 개인 태스크 제목 저장에 version 을 싣는지 — 화면 테스트(WP-971, 판정 기준은 PATCH 요청 본문).
// 모바일 전체 화면 상세는 저장 직전 캐시의 version 을 그대로 써 왔다 — 편집을 시작한 뒤 다른 곳에서 이슈가 갱신되면(재조회·SSE)
// 그새 올라간 version 을 싣고 남이 먼저 바꾼 제목을 모른 채 덮어쓴다. 편집 시작 시점의 version 을 고정해 싣는지 본다.
// 개인 프로젝트 모바일 화면은 personalProject.test 와 같은 renderMobileRoute(앱 셸 없는 모바일 화면 렌더)로 띄운다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { ProjectIssuesTab } from '@/test/kits/projects/projectTabs'
import { mockViewport } from '@/test/viewport'

import { createChatMessagePage, createChatThread } from '../../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createLabel, toLabelSummary } from '../../../../e2e/factories/label.factory'
import { createMember, createProject } from '../../../../e2e/factories/project.factory'

// 한 파일 = 뷰포트 하나 — 모바일 전체 화면(PersonalTaskMobile)이 뜨려면 모바일 폭·터치 포인터가 필요하다.
mockViewport()

const KEY = 'PME'
const TITLE = '연말정산 증빙서류 정리'
const BASE = `/api/v1/projects/${KEY}`

/**
 * version 을 추적하는 개인 프로젝트 스텁 — 상세 GET 은 서버 version 을 그대로 싣고, PATCH 는 받은 본문을 server.patches 에
 * 모은 뒤 서버 상태로 응답한다. 상세 재조회 수(detailGets)로 「다른 곳에서 갱신된 뒤」 시점을 잡을 수 있게 한다.
 */
function stubVersioned() {
  const server = { version: 3, detailGets: 0, patches: [] as Record<string, unknown>[] }
  const labels = [createLabel({ id: 1, name: '세금' })]
  const issue = () =>
    createIssue({ projectKey: KEY, number: 1, title: TITLE, version: server.version, labels: [toLabelSummary(labels[0])] })
  const detail = () => createIssueDetail({ summary: issue(), body: '영수증은 드라이브 폴더에 있음' })
  const thread = createChatThread()
  const handlers = [
    http.get(`${BASE}/saved-views`, () => HttpResponse.json([])),
    http.get(BASE, () => HttpResponse.json(createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true }))),
    http.get(`${BASE}/issues`, () => HttpResponse.json(createIssueSearchResponse([issue()]))),
    http.get(`${BASE}/labels`, () => HttpResponse.json(labels)),
    http.post(`${BASE}/labels`, async ({ request }) => {
      const body = (await request.json()) as { name: string }
      return HttpResponse.json(createLabel({ id: 99, name: body.name, colorToken: 'GRAY', viewerCanManage: true }))
    }),
    http.get(`${BASE}/members`, () => HttpResponse.json([createMember({ userId: 1, name: '양동희' })])),
    http.get(`${BASE}/issues/1`, () => {
      server.detailGets++
      return HttpResponse.json(detail())
    }),
    http.patch(`${BASE}/issues/1`, async ({ request }) => {
      server.patches.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json(detail())
    }),
    http.delete(`${BASE}/issues/1`, () => new HttpResponse(null, { status: 204 })),
    http.put(`${BASE}/issues/1/labels`, () => HttpResponse.json([])),
    http.put(`${BASE}/issues/1/assignees`, () => HttpResponse.json([])),
    http.get(`${BASE}/issues/1/recurrence`, () => new HttpResponse(null, { status: 204 })),
    http.put(`${BASE}/issues/1/recurrence`, async ({ request }) => {
      const body = (await request.json()) as { rrule: string; time: string }
      return HttpResponse.json({ ...body, enabled: true, nextRunAt: '2026-10-28T23:30:00Z', consecutiveFailures: 0, lastRunAt: null, agentUserId: 9, agentName: '비서' })
    }),
    http.get(`${BASE}/issues/1/recurrence/agents`, () => HttpResponse.json([])),
    http.get(`${BASE}/issues/1/chat/thread`, () => HttpResponse.json(thread)),
    http.get(`/api/v1/chat/threads/${thread.threadId}/messages`, () => HttpResponse.json(createChatMessagePage([]))),
    ...['watchers', 'attachments', 'drive-links', 'labels'].map((s) => http.get(`${BASE}/issues/1/${s}`, () => HttpResponse.json([]))),
  ]
  return { server, handlers }
}

/** ?task=1 모바일 전체 화면을 열고 상세 조회(속성 칩)가 끝날 때까지 기다린다. */
async function openTask() {
  const stub = stubVersioned()
  const view = renderMobileRoute('/projects/:key', <ProjectIssuesTab />, {
    path: `/projects/${KEY}?task=1`,
    handlers: stub.handlers,
  })
  await screen.findByTestId('personal-task-mobile')
  await screen.findByTestId('mobile-prop-status')
  return { ...view, server: stub.server }
}

// WP-2113: 제목 저장 요청에 편집 시작 시점의 version 을 싣는다 — 안 싣으면(또는 저장 시점 캐시로 싣면) 남이 먼저 바꾼 제목을
// 덮어쓰고, version 없는 글 변경을 막는 서버 규칙(409)에 걸린다.
test('제목 저장 요청에 version 을 넣는다', async () => {
  const { user, server, queryClient } = await openTask()
  const layer = screen.getByTestId('personal-task-mobile')
  const bottom = within(layer).getByTestId('personal-task-bottom-bar')

  // 제목 편집 시작 — 아래서 싣는 version 을 이 시점(3)으로 고정한다.
  await user.click(within(layer).getByTestId('issue-title-edit'))
  const input = await within(layer).findByTestId('issue-title-input')
  await user.clear(input)
  await user.paste('새 제목')

  // 편집하는 사이 다른 곳에서 이슈가 저장됐다 — 서버 version 3 → 4, 화면도 재조회로 다시 받는다(SSE·창 전환과 같은 갱신).
  server.version = 4
  const getsBefore = server.detailGets
  await act(() => queryClient.invalidateQueries())
  await waitFor(() => expect(server.detailGets).toBeGreaterThan(getsBefore))

  // 저장 — 요청 본문은 편집을 시작할 때의 version 을 싣는다(저장 시점 캐시의 4 가 아니라 3).
  await user.click(within(bottom).getByTestId('mobile-edit-save'))
  await waitFor(() => expect(server.patches).toHaveLength(1))
  expect(server.patches[0]).toMatchObject({ title: '새 제목', version: 3 })
})
