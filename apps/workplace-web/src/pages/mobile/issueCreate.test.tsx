// 모바일 이슈 생성 시트(WP-196) — 페이지 테스트(WP-971, WP-981).
// 유효성 오류·버림 확인·칩으로 고른 속성의 POST payload·하위 태스크 전환·✦ AI 제안·개인 프로젝트 칩 구성은
// 브라우저 없이 판정되므로 e2e/pages/mobile/issue-create.spec.ts 에서 옮겼다.
// 전체 화면 크기·자라는 입력칸·칩 줄 스크롤(@layout), IME·포커스 복귀·스와이프(@input), 시스템 back(@platform)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 이슈 목록 화면(ProjectDetailPage)만 renderScreen 으로 띄운다(WP-1002).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import ProjectDetailPage from '../projects/ProjectDetailPage'

// 휴대폰 폭·터치 포인터 — 「＋」가 전체 화면 생성 시트(MobileIssueCreateSheet)를 연다.
mockViewport()

const KEY = 'WP'
const EPIC = createIssue({ id: 50, number: 50, projectKey: KEY, type: makeEpicType(), title: '결제 개편 에픽' })
const MEMBERS = [
  { userId: 1, name: '양동희', username: 'dh.yang@iacloud.kr', kind: 'HUMAN' },
  { userId: 2, name: '김개발', username: 'dev.kim@iacloud.kr', kind: 'HUMAN' },
]

/** 프로젝트 화면 API — POST 생성 요청 본문은 posts 에 쌓는다. */
function projectApi(key = KEY, project = createProject({ key }), list = [EPIC]) {
  const posts: Record<string, unknown>[] = []
  const handlers = [
    http.get(`/api/v1/projects/${key}`, () => HttpResponse.json(project)),
    http.get(`/api/v1/projects/${key}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${key}/members`, () => HttpResponse.json(MEMBERS)),
    http.get(`/api/v1/projects/${key}/views`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${key}/issues`, () => HttpResponse.json(createIssueSearchResponse(list, null))),
    http.post(`/api/v1/projects/${key}/issues`, async ({ request }) => {
      posts.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json(createIssue({ id: 99, number: 99, projectKey: key, title: 'new' }))
    }),
    // 에픽 시트 검색어로 다른 프로젝트 에픽 찾기(WP-1039) — PLAN-3 에픽 하나.
    http.get('/api/v1/issues/lookup', () =>
      HttpResponse.json([{ projectKey: 'PLAN', number: 3, title: '분기 계획', status: 'TODO', type: makeEpicType() }]),
    ),
    http.post(`/api/v1/projects/${key}/issues/ai-classify`, () =>
      HttpResponse.json({ type: 'BUG', priority: 'HIGH', reason: '오류 재현 절차가 있어 버그로 분류', labels: [] }),
    ),
  ]
  return { handlers, posts }
}

/** 목록을 열고 「＋」로 생성 시트를 연다. */
async function openSheet() {
  const api = projectApi()
  const page = renderMobileRoute('/projects/:key', <ProjectDetailPage />, { path: `/projects/${KEY}`, handlers: api.handlers })
  await page.user.click(await screen.findByTestId('mobile-new-issue'))
  const sheet = await screen.findByTestId('issue-create-sheet')
  return { ...page, api, sheet }
}

describe('모바일 이슈 생성 시트', () => {
  test('설명이 50000자를 넘으면 오류 문구가 보이고 생성 요청은 나가지 않는다', async () => {
    // WP-929: 상한 초과 시 아무 반응 없이 멈추던 회귀 — zod 오류가 설명 아래에 그려지고 POST 는 막힌다.
    const { user, api } = await openSheet()
    fireEvent.change(screen.getByTestId('issue-create-title'), { target: { value: '긴 설명' } })
    fireEvent.change(screen.getByTestId('issue-create-body'), { target: { value: '가'.repeat(50001) } })
    await user.click(screen.getByTestId('issue-create-submit'))
    expect(await screen.findByText('본문은 50000자 이하여야 합니다')).toHaveAttribute('id', 'issue-create-body-error')
    expect(screen.getByTestId('issue-create-body')).toHaveAttribute('aria-invalid', 'true')
    expect(api.posts).toHaveLength(0)
  })

  test('내용이 있으면 취소·Esc 모두 버림 확인 — 계속 작성은 내용을 지키고, 버리기로 닫힌다', async () => {
    // 작성 중 실수로 닫아 내용을 잃지 않게 하는 확인창 분기(내용 있음) — 취소 버튼과 Esc 가 같은 확인을 거친다.
    const { user } = await openSheet()
    fireEvent.change(screen.getByTestId('issue-create-title'), { target: { value: '작성 중' } })
    await user.click(screen.getByTestId('issue-create-cancel'))
    expect(await screen.findByTestId('issue-create-discard-dialog')).toHaveTextContent('작성 중인 내용을 버릴까요?')
    await user.click(screen.getByTestId('issue-create-discard-keep'))
    await waitFor(() => expect(screen.queryByTestId('issue-create-discard-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('issue-create-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('issue-create-title')).toHaveValue('작성 중')
    await user.keyboard('{Escape}')
    await user.click(await screen.findByTestId('issue-create-discard-confirm'))
    await waitFor(() => expect(screen.queryByTestId('issue-create-sheet')).not.toBeInTheDocument())
  })

  test('비어 있으면 취소는 확인 없이 바로 닫힌다', async () => {
    // 버림 확인 분기의 반대편(내용 없음) — 빈 시트에 확인창을 띄우면 한 번 더 눌러야 해 번거롭다.
    const { user } = await openSheet()
    await user.click(screen.getByTestId('issue-create-cancel'))
    await waitFor(() => expect(screen.queryByTestId('issue-create-sheet')).not.toBeInTheDocument())
    expect(screen.queryByTestId('issue-create-discard-dialog')).not.toBeInTheDocument()
  })

  test('우선순위·담당자·마감·에픽·시작일 칩으로 고른 값이 POST payload 에 실린다', async () => {
    // 칩 시트에서 고른 값 → 칩 라벨 → 생성 요청 본문까지(품질 기준 1). 시트·키보드 포커스 이동은 E2E(@input)가 본다.
    const { user, api } = await openSheet()
    fireEvent.change(screen.getByTestId('issue-create-title'), { target: { value: '속성 많은 이슈' } })
    await user.click(screen.getByTestId('create-chip-priority'))
    await user.click(within(await screen.findByTestId('create-priority-sheet')).getByTestId('picker-option-HIGH'))
    await waitFor(() => expect(screen.getByTestId('create-chip-priority')).toHaveTextContent('높음'))
    await user.click(screen.getByTestId('create-chip-assignee'))
    await user.click(await screen.findByTestId('multi-option-2'))
    await user.click(screen.getByTestId('create-assignee-sheet-done'))
    await waitFor(() => expect(screen.getByTestId('create-chip-assignee')).toHaveTextContent('김개발'))
    await user.click(screen.getByTestId('create-chip-due'))
    await user.click(await screen.findByTestId('create-due-sheet-tomorrow'))
    await user.click(screen.getByTestId('create-chip-epic'))
    await user.click(within(await screen.findByTestId('create-epic-sheet')).getByTestId('picker-option-50'))
    await waitFor(() => expect(screen.getByTestId('create-chip-epic')).toHaveTextContent('결제 개편 에픽'))
    // ⋯ → 시작일: 날짜 시트가 떠 있는 동안 제목은 포커스 없음(시트·키보드 동시 금지), 고른 뒤 제목으로 돌아온다.
    const title = screen.getByTestId('issue-create-title')
    title.focus()
    await user.click(screen.getByTestId('create-chip-more'))
    await user.click(await screen.findByTestId('mobile-action-start'))
    await screen.findByTestId('create-start-sheet')
    expect(title).not.toHaveFocus()
    await user.click(await screen.findByTestId('create-start-sheet-today'))
    await waitFor(() => expect(screen.queryByTestId('create-start-sheet')).not.toBeInTheDocument())
    await waitFor(() => expect(title).toHaveFocus())
    await user.click(screen.getByTestId('issue-create-submit'))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0]).toMatchObject({ title: '속성 많은 이슈', priority: 'HIGH', assigneeIds: [2], parentNumber: 50 })
    expect(api.posts[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(api.posts[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await waitFor(() => expect(screen.queryByTestId('issue-create-sheet')).not.toBeInTheDocument())
  })

  test('에픽 시트에서 다른 프로젝트 에픽을 찾아 고르면 칩에 키·제목이 보이고 payload 에 parentKey 로 실린다 (WP-1039)', async () => {
    const { user, api } = await openSheet()
    fireEvent.change(screen.getByTestId('issue-create-title'), { target: { value: '다른 팀 에픽 하위' } })
    await user.click(screen.getByTestId('create-chip-epic'))
    const sheet = await screen.findByTestId('create-epic-sheet')
    fireEvent.change(within(sheet).getByTestId('create-epic-sheet-search'), { target: { value: '분기' } })
    await user.click(await within(sheet).findByTestId('picker-other-epic-PLAN-3'))
    await waitFor(() => expect(screen.getByTestId('create-chip-epic')).toHaveTextContent('PLAN-3 분기 계획'))
    await user.click(screen.getByTestId('issue-create-submit'))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0]).toMatchObject({ title: '다른 팀 에픽 하위', parentKey: 'PLAN-3' })
    expect(api.posts[0]).not.toHaveProperty('parentNumber')
  })

  test('에픽을 고른 뒤 유형을 하위 태스크로 바꾸면 에픽은 빠지고 상위 번호 입력이 생겨 payload 에 실린다', async () => {
    // 하위 태스크는 에픽 대신 상위 이슈 번호를 갖는다 — 유형 전환이 에픽 칩을 치우고 parentNumber·typeId 로 보낸다.
    const { user, api } = await openSheet()
    fireEvent.change(screen.getByTestId('issue-create-title'), { target: { value: '하위 작업' } })
    await user.click(screen.getByTestId('create-chip-epic'))
    await user.click(await screen.findByTestId('picker-option-50'))
    await user.click(screen.getByTestId('create-chip-type'))
    // systemTypes() 의 SUBTASK = id 5, 라벨 「하위 태스크」.
    await user.click(within(await screen.findByTestId('create-type-sheet')).getByRole('option', { name: '하위 태스크' }))
    await waitFor(() => expect(screen.getByTestId('create-chip-type')).toHaveTextContent('하위 태스크'))
    expect(screen.queryByTestId('create-chip-epic')).not.toBeInTheDocument()
    // ⋯ 를 거치지 않아도 상위 번호 입력이 바로 보인다.
    const parent = screen.getByTestId('create-parent-number')
    fireEvent.change(parent, { target: { value: '7' } })
    await user.click(screen.getByTestId('issue-create-submit'))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0]).toMatchObject({ parentNumber: 7, typeId: 5 })
  })

  test('✦ AI 제안 — 분류 응답의 유형·우선순위가 칩에 반영되고 이유가 보이며, 제목 포커스는 그대로다', async () => {
    // ai-classify 응답(BUG·HIGH·이유) → 칩 라벨·이유 문구 반영(품질 기준 2).
    const { user } = await openSheet()
    const title = screen.getByTestId('issue-create-title')
    fireEvent.change(title, { target: { value: '결제 버튼 누르면 500 오류' } })
    title.focus()
    await user.click(screen.getByTestId('create-chip-ai'))
    await waitFor(() => expect(screen.getByTestId('create-chip-priority')).toHaveTextContent('높음'))
    expect(screen.getByTestId('create-chip-type')).toHaveTextContent('버그')
    expect(screen.getByTestId('create-ai-reason')).toHaveTextContent('오류 재현 절차가 있어 버그로 분류')
    // ✦ 는 시트를 열지 않으므로 제목 포커스(=키보드)를 빼앗지 않는다.
    expect(title).toHaveFocus()
  })
})

describe('모바일 이슈 생성 시트 — 개인 프로젝트', () => {
  test('개인 프로젝트는 유형·에픽 칩이 없다', async () => {
    // 개인 프로젝트는 유형·에픽 개념을 쓰지 않는다 — 프로젝트 type 에 따른 칩 구성 분기.
    const PKEY = 'PME'
    const api = projectApi(PKEY, createProject({ id: 7, key: PKEY, name: '개인 작업', type: 'PERSONAL', isDefault: true }), [])
    const { user } = renderMobileRoute('/projects/:key', <ProjectDetailPage />, { path: `/projects/${PKEY}`, handlers: api.handlers })
    const header = await screen.findByTestId('page-header')
    // 빈 개인 목록은 본문에도 「빠른 추가」가 있어 머리말의 버튼으로 좁힌다.
    await user.click(await within(header).findByRole('button', { name: '빠른 추가' }))
    await screen.findByTestId('issue-create-sheet')
    expect(screen.getByTestId('create-chip-priority')).toBeInTheDocument()
    expect(screen.queryByTestId('create-chip-type')).not.toBeInTheDocument()
    expect(screen.queryByTestId('create-chip-epic')).not.toBeInTheDocument()
  })
})
