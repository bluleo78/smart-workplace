// 모바일 개인 프로젝트(WP-221) — 페이지 테스트(WP-981).
// 개인 툴바 구성(뷰·에픽 칩 없음, 저장 뷰 조회 없음, 체크리스트/보드 토글), 그룹 시트 선택지, 보드 카드 → 전체 화면 상세,
// 속성 칩 저장(상태 PATCH·라벨/담당자 PUT·라벨 만들기 POST), 제목 편집 Esc 취소·저장은 요청·조건부 렌더라
// e2e/pages/mobile/personal-project.spec.ts 에서 옮겼다. 전체 화면 레이어·토스트 겹침·입력줄 위치·행 폭 같은 기하와 시스템 뒤로가기는 그 E2E 가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { createChatMessagePage, createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createLabel, toLabelSummary } from '../../../e2e/factories/label.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

mockViewport()
// jsdom 에는 요소 scrollTo 가 없다 — 보드 탭 전환 때 목록을 맨 위로 올리는 호출(스크롤 위치는 E2E 가 본다).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}

const KEY = 'PME'
const TITLE = '연말정산 증빙서류 정리 및 회사 제출'

/**
 * 개인 프로젝트 + 작업 1건. 쓰기(PATCH 이슈·PUT 라벨·PUT 담당자·POST 라벨)와 저장 뷰 요청을 seen 에 모은다.
 * E2E personal-project.spec 의 stubPersonal 과 같은 구성.
 */
function stubPersonal() {
  const labels = [createLabel({ id: 1, name: '세금' }), createLabel({ id: 2, name: '긴급' })]
  const issue = createIssue({ projectKey: KEY, number: 1, title: TITLE, status: 'TODO', labels: [toLabelSummary(labels[0])] })
  const thread = createChatThread()
  const seen = { patches: [] as unknown[], putLabels: [] as unknown[], putAssignees: [] as unknown[], labelPosts: [] as unknown[], savedViews: 0 }
  const handlers = [
    http.get(`/api/v1/projects/${KEY}/saved-views`, () => {
      seen.savedViews++
      return HttpResponse.json([])
    }),
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true }))),
    http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([issue]))),
    http.get(`/api/v1/projects/${KEY}/labels`, () => HttpResponse.json(labels)),
    http.post(`/api/v1/projects/${KEY}/labels`, async ({ request }) => {
      const body = (await request.json()) as { name: string }
      seen.labelPosts.push(body)
      const created = createLabel({ id: 99, name: body.name, colorToken: 'GRAY', viewerCanManage: true })
      labels.push(created)
      return HttpResponse.json(created)
    }),
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 1, name: '양동희' })])),
    http.get(`/api/v1/projects/${KEY}/issues/1`, () =>
      HttpResponse.json(createIssueDetail({ summary: issue, body: '영수증은 드라이브 「2026 연말정산」 폴더에 있음' })),
    ),
    http.patch(`/api/v1/projects/${KEY}/issues/1`, async ({ request }) => {
      seen.patches.push(await request.json())
      return HttpResponse.json(createIssueDetail({ summary: issue }))
    }),
    http.put(`/api/v1/projects/${KEY}/issues/1/labels`, async ({ request }) => {
      seen.putLabels.push(await request.json())
      return HttpResponse.json([])
    }),
    http.put(`/api/v1/projects/${KEY}/issues/1/assignees`, async ({ request }) => {
      seen.putAssignees.push(await request.json())
      return HttpResponse.json([])
    }),
    http.get(`/api/v1/projects/${KEY}/issues/1/chat/thread`, () => HttpResponse.json(thread)),
    http.get(`/api/v1/chat/threads/${thread.threadId}/messages`, () => HttpResponse.json(createChatMessagePage([]))),
    ...['watchers', 'attachments', 'drive-links', 'labels'].map((s) => http.get(`/api/v1/projects/${KEY}/issues/1/${s}`, () => HttpResponse.json([]))),
  ]
  return { seen, handlers }
}

/** 작업 상세(?task=1)를 띄운다. */
async function openTask() {
  const p = stubPersonal()
  const view = renderPage(`/projects/${KEY}?task=1`, { handlers: p.handlers })
  await screen.findByTestId('personal-task-mobile', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 칩은 상세 조회가 끝난 뒤 그려진다.
  await screen.findByTestId('mobile-prop-status')
  return { ...view, seen: p.seen }
}

test('개인 툴바 — 뷰·에픽 칩 없이 필터·그룹·검색·체크리스트 토글, 토글하면 보드로, 저장 뷰는 조회하지 않는다', async () => {
  const p = stubPersonal()
  const { user, location } = renderPage(`/projects/${KEY}`, { handlers: p.handlers })
  const bar = await screen.findByTestId('mobile-issue-toolbar', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(await screen.findByTestId('personal-checklist')).toBeInTheDocument()
  expect(within(bar).queryByTestId('mobile-chip-view')).not.toBeInTheDocument()
  expect(within(bar).queryByTestId('mobile-chip-epic')).not.toBeInTheDocument()
  expect(within(bar).getByTestId('mobile-chip-filter')).toBeInTheDocument()
  expect(within(bar).getByTestId('mobile-chip-group')).toHaveTextContent('그룹: 없음')
  expect(within(bar).getByTestId('mobile-search-open')).toBeInTheDocument()
  const toggle = within(bar).getByTestId('mobile-view-toggle')
  expect(toggle).toHaveAttribute('aria-label', '보드로 전환')
  await user.click(toggle)
  await waitFor(() => expect(location()).toMatch(/view=board/))
  await waitFor(() => expect(screen.getByTestId('mobile-view-toggle')).toHaveAttribute('aria-label', '체크리스트로 전환'))
  expect(p.seen.savedViews).toBe(0)
})

test('그룹 시트 선택지는 없음·상태·우선순위 세 가지', async () => {
  const p = stubPersonal()
  const { user } = renderPage(`/projects/${KEY}`, { handlers: p.handlers })
  await user.click(await screen.findByTestId('mobile-chip-group', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  const group = await screen.findByTestId('mobile-group-sheet')
  expect(within(group).getAllByRole('option')).toHaveLength(3)
  for (const v of ['none', 'status', 'priority']) expect(within(group).getByTestId(`picker-option-${v}`)).toBeInTheDocument()
})

test('보드 카드를 눌러도 모달 대신 같은 전체 화면 상세가 열린다(칩 순서 = 상태·우선순위·마감·담당자·라벨)', async () => {
  const p = stubPersonal()
  const { user } = renderPage(`/projects/${KEY}?view=board`, { handlers: p.handlers })
  const card = await screen.findByTestId('issue-card-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(within(card).getByRole('link'))
  const layer = await screen.findByTestId('personal-task-mobile')
  expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument()
  expect(await within(layer).findByTestId('personal-task-panel-title')).toHaveTextContent('연말정산')
  const order = [...layer.querySelectorAll('[data-testid^="mobile-prop-"]')]
    .map((e) => e.getAttribute('data-testid'))
    .filter((id) => id !== 'mobile-prop-chips')
  expect(order).toEqual(['mobile-prop-status', 'mobile-prop-priority', 'mobile-prop-due', 'mobile-prop-assignee', 'mobile-prop-label'])
  expect(within(layer).getByTestId('mobile-prop-label')).toHaveTextContent('세금')
})

test('상태 칩 → 완료 → PATCH statusId(프로젝트 상태 id)', async () => {
  const { user, seen } = await openTask()
  await user.click(screen.getByTestId('mobile-prop-status'))
  await user.click(within(await screen.findByTestId('issue-status-sheet')).getByTestId('picker-option-3'))
  await waitFor(() => expect(seen.patches).toContainEqual(expect.objectContaining({ statusId: 3 })))
})

test('라벨 칩 — 그대로 닫으면 요청 없음, 바꾸고 완료하면 PUT 1회', async () => {
  const { user, seen } = await openTask()
  await user.click(screen.getByTestId('mobile-prop-label'))
  let sheet = await screen.findByTestId('issue-label-sheet')
  // 라벨은 사람이 아니라 「개」로 센다(WP-499).
  expect(within(sheet).getByText('라벨을 여러 개 고를 수 있습니다.')).toBeInTheDocument()
  await user.click(within(sheet).getByTestId('issue-label-sheet-done'))
  await waitFor(() => expect(screen.queryByTestId('issue-label-sheet')).not.toBeInTheDocument())
  expect(seen.putLabels).toEqual([])

  await user.click(screen.getByTestId('mobile-prop-label'))
  sheet = await screen.findByTestId('issue-label-sheet')
  await user.click(within(sheet).getByTestId('multi-option-2'))
  await user.click(within(sheet).getByTestId('issue-label-sheet-done'))
  await waitFor(() => expect(seen.putLabels).toEqual([{ labelIds: [1, 2] }]))
})

test('라벨 시트에서 없는 이름 → 만들기 → POST(GRAY) → 체크된 채 추가 → 완료하면 PUT 1회(WP-394)', async () => {
  const { user, seen } = await openTask()
  await user.click(screen.getByTestId('mobile-prop-label'))
  const sheet = await screen.findByTestId('issue-label-sheet')
  const search = within(sheet).getByTestId('issue-label-sheet-search')
  // 정확히 같은 이름이 있으면 만들기가 없다.
  await user.type(search, '세금')
  expect(within(sheet).queryByTestId('issue-label-sheet-create')).not.toBeInTheDocument()
  await user.clear(search)
  await user.type(search, '영수증')
  expect(within(sheet).queryByText('결과가 없습니다')).not.toBeInTheDocument()
  expect(await within(sheet).findByTestId('issue-label-sheet-create')).toHaveTextContent('「영수증」 라벨 만들기')
  await user.click(within(sheet).getByTestId('issue-label-sheet-create'))
  await waitFor(() => expect(seen.labelPosts).toEqual([{ name: '영수증', colorToken: 'GRAY' }]))
  await waitFor(() => expect(search).toHaveValue(''))
  expect(await within(sheet).findByTestId('multi-option-99')).toHaveAttribute('aria-selected', 'true')
  await user.click(within(sheet).getByTestId('issue-label-sheet-done'))
  await waitFor(() => expect(seen.putLabels).toEqual([{ labelIds: [1, 99] }]))
})

test('담당자 칩 — 그대로 완료하면 요청 없음, 바꾸고 완료하면 PUT 1회', async () => {
  const { user, seen } = await openTask()
  await user.click(screen.getByTestId('mobile-prop-assignee'))
  await user.click(within(await screen.findByTestId('issue-assignee-sheet')).getByTestId('issue-assignee-sheet-done'))
  await waitFor(() => expect(screen.queryByTestId('issue-assignee-sheet')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mobile-prop-assignee'))
  const sheet = await screen.findByTestId('issue-assignee-sheet')
  await user.click(within(sheet).getByTestId('multi-option-1'))
  await user.click(within(sheet).getByTestId('issue-assignee-sheet-done'))
  await waitFor(() => expect(seen.putAssignees).toHaveLength(1))
})

test('제목 편집 — 하단이 [취소·저장] 바로 바뀌고, Esc 는 편집만 취소(레이어 유지), 저장은 PATCH title 1건', async () => {
  const { user, seen } = await openTask()
  const layer = screen.getByTestId('personal-task-mobile')
  const bottom = within(layer).getByTestId('personal-task-bottom-bar')
  expect(await within(bottom).findByTestId('chat-composer')).toBeInTheDocument()

  await user.click(within(layer).getByTestId('issue-title-edit'))
  expect(await within(bottom).findByTestId('mobile-edit-bar')).toBeInTheDocument()
  // 입력줄은 hidden 속성으로 숨는다(편집 바와 자리를 나눠 쓴다).
  expect(within(bottom).getByTestId('chat-composer')).not.toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(within(layer).queryByTestId('issue-title-input')).not.toBeInTheDocument())
  expect(screen.getByTestId('personal-task-mobile')).toBeInTheDocument()
  await waitFor(() => expect(within(bottom).getByTestId('chat-composer')).toBeVisible())

  await user.click(within(layer).getByTestId('issue-title-edit'))
  const input = await within(layer).findByTestId('issue-title-input')
  await user.clear(input)
  await user.paste('연말정산 서류 제출')
  await user.click(within(bottom).getByTestId('mobile-edit-save'))
  await waitFor(() => expect(seen.patches).toContainEqual(expect.objectContaining({ title: '연말정산 서류 제출' })))
  // Esc 취소 때는 PATCH 가 나가지 않았다 — 저장 1건만.
  expect(seen.patches).toHaveLength(1)
})
