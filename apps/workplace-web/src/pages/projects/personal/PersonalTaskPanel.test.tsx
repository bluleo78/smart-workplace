// WP-2113: 데스크톱 개인 태스크 패널 제목 저장에 version 을 싣는지 — 화면 테스트(WP-971, 판정 기준은 PATCH 요청 본문).
// 저장 직전 캐시의 version 을 그대로 쓰면, 편집하는 사이 다른 곳에서 작업이 갱신됐을 때(재조회·SSE) 그새 올라간 version 을 싣고
// 남이 먼저 바꾼 제목을 모른 채 덮어쓴다 — 편집 시작 시점의 version 을 고정해 싣는지 모바일(PersonalTaskMobile.test)과 같이 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { PersonalProjectDetail } from '@/pages/projects/personal/PersonalProjectDetail'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

// 한 파일 = 뷰포트 하나 — 패널은 데스크톱 폭에서만 넓은 모달로 뜬다(모바일은 전체 화면 PersonalTaskMobile).
mockViewport({ width: 1440, height: 900, pointer: 'fine' })

const KEY = 'PME'
const TITLE = '연말정산 증빙서류 정리'
const BASE = `/api/v1/projects/${KEY}`
const PROJECT = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true })

/**
 * version 을 추적하는 개인 프로젝트 스텁 — 상세 GET 은 서버 version 을 그대로 싣고, PATCH 는 받은 본문을 server.patches 에 모은다.
 * 상세 재조회 수(detailGets)로 「다른 곳에서 갱신된 뒤」 시점을 잡을 수 있게 한다(모바일 테스트와 같은 방식).
 */
function stubVersioned() {
  const server = { version: 3, detailGets: 0, patches: [] as Record<string, unknown>[] }
  const issue = () => createIssue({ projectKey: KEY, number: 1, title: TITLE, version: server.version })
  const detail = () => createIssueDetail({ summary: issue(), body: '영수증은 드라이브 폴더에 있음' })
  const handlers = [
    http.get(BASE, () => HttpResponse.json(PROJECT)),
    http.get(`${BASE}/issues`, () => HttpResponse.json(createIssueSearchResponse([issue()]))),
    http.get(`${BASE}/issues/1`, () => {
      server.detailGets++
      return HttpResponse.json(detail())
    }),
    http.patch(`${BASE}/issues/1`, async ({ request }) => {
      server.patches.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json(detail())
    }),
    ...['watchers', 'attachments', 'drive-links', 'labels'].map((sub) => http.get(`${BASE}/issues/1/${sub}`, () => HttpResponse.json([]))),
  ]
  return { server, handlers }
}

/** ?task=1 데스크톱 모달을 열고 제목 표시가 뜰 때까지 기다린다. */
async function openPanel() {
  const stub = stubVersioned()
  const view = renderScreen(
    <Routes>
      <Route path="/projects/:key" element={<PersonalProjectDetail project={PROJECT} />} />
    </Routes>,
    { path: `/projects/${KEY}?task=1`, handlers: [...stub.handlers, ...shellHandlers] },
  )
  await screen.findByTestId('personal-task-modal')
  await screen.findByTestId('personal-task-panel-title')
  return { ...view, server: stub.server }
}

// WP-2113: 제목 저장 요청에 편집 시작 시점의 version 을 싣는다 — 안 싣거나 저장 시점 캐시로 싣면 남이 먼저 바꾼 제목을 덮어쓴다.
test('제목 저장 요청에 version 을 넣는다', async () => {
  const { user, server, queryClient } = await openPanel()
  const modal = screen.getByTestId('personal-task-modal')

  // 제목 편집 시작 — 아래서 싣는 version 을 이 시점(3)으로 고정한다.
  await user.click(within(modal).getByTestId('issue-title-edit'))
  const input = await within(modal).findByTestId('issue-title-input')
  await user.clear(input)
  await user.paste('새 제목')

  // 편집하는 사이 다른 곳에서 작업이 저장됐다 — 서버 version 3 → 4, 화면도 재조회로 다시 받는다(SSE·창 전환과 같은 갱신).
  server.version = 4
  const getsBefore = server.detailGets
  await act(() => queryClient.invalidateQueries())
  await waitFor(() => expect(server.detailGets).toBeGreaterThan(getsBefore))

  // 저장(Enter) — 요청 본문은 편집을 시작할 때의 version 을 싣는다(저장 시점 캐시의 4 가 아니라 3).
  await user.keyboard('{Enter}')
  await waitFor(() => expect(server.patches).toHaveLength(1))
  expect(server.patches[0]).toMatchObject({ title: '새 제목', version: 3 })
})
