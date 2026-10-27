// 모바일 이슈 행·카드 「⋯」 액션 시트(WP-273 시안 M1) — 페이지 테스트(WP-981).
// 시트 항목이 보내는 요청 payload(우선순위·담당자·AI 위임·삭제)와 선택 모드에서 ⋯ 를 숨기는 조건부 렌더는
// 브라우저 없이 판정되므로 e2e/pages/mobile/issue-row-menu.spec.ts 에서 옮겼다.
// 시트 배치·가로 넘침·스크린샷(@layout)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 이슈 목록 화면(ProjectDetailPage)만 renderScreen 으로 띄운다 — 행을 눌러 가는 상세는 그리지 않고 이동 주소만 본다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createAgentMember, createMember, createProject } from '../../../e2e/factories/project.factory'
import ProjectDetailPage from '../projects/ProjectDetailPage'

// 모바일 폭·터치 포인터 — 행마다 ⋯ 와 액션 시트가 그려지는 조건.
mockViewport()

const KEY = 'WP'
const ISSUES = `/api/v1/projects/${KEY}/issues`

const ME = createMember({ userId: 1, name: '테스트 사용자', username: 'testuser', role: 'MEMBER' })
const KIM = createMember({ userId: 2, name: '김개발', username: 'kim', role: 'MEMBER' })
const BOT = createAgentMember({ userId: 99, name: '트리스타나' })
const LONG = createIssue({
  id: 21, number: 21, projectKey: KEY, type: makeTaskType(), status: 'TODO', priority: 'HIGH', reporterId: 1,
  title: '결제 모듈 환불 처리 간헐적 실패 원인 분석 — PG 콜백 타임아웃 시 PENDING 잔류',
  assignees: [{ id: 2, username: 'kim', name: '김개발', kind: 'HUMAN' }],
})
const OTHER = createIssue({ id: 22, number: 22, projectKey: KEY, title: '환불 콜백 재시도 로직 추가', type: makeTaskType(), status: 'TODO', reporterId: 5 })

type Call = { method: string; path: string; body: unknown }

/** 목록·메타·변경 API — 쓰기 요청은 calls 에 쌓는다. */
function issueApi() {
  const calls: Call[] = []
  const handlers = [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([ME, KIM, BOT])),
    http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(ISSUES, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')
      const all = [LONG, OTHER]
      return HttpResponse.json(createIssueSearchResponse(status ? all.filter((i) => status.split(',').includes(i.status)) : all, null))
    }),
    http.all(`${ISSUES}/:num/:sub?`, async ({ request }) => {
      if (request.method === 'GET') return undefined
      const text = await request.text()
      calls.push({ method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null })
      return request.method === 'DELETE' ? new HttpResponse(null, { status: 204 }) : HttpResponse.json([])
    }),
  ]
  return { handlers, calls }
}

/** 목록을 열고 21번 행의 ⋯ 시트를 띄운다. */
async function openSheet() {
  const api = issueApi()
  const page = renderMobileRoute('/projects/:key', <ProjectDetailPage />, { path: `/projects/${KEY}?group=none`, handlers: api.handlers })
  await page.user.click(await screen.findByTestId('issue-row-21-menu'))
  await screen.findByTestId('mobile-action-sheet')
  return { ...page, api }
}

describe('모바일 이슈 행 ⋯ 시트', () => {
  test('시트 줄마다 현재 값(상태·담당자·우선순위)이 적혀 있고 상세로 이동하지 않는다', async () => {
    const { location } = await openSheet()
    expect(screen.getByTestId('mobile-action-status')).toHaveTextContent('할 일')
    expect(screen.getByTestId('mobile-action-assignee')).toHaveTextContent('김개발')
    expect(screen.getByTestId('mobile-action-priority')).toHaveTextContent('높음')
    for (const id of ['ai', 'copy-link', 'select', 'delete']) expect(screen.getByTestId(`mobile-action-${id}`)).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}?group=none`)
  })

  test('우선순위 → 낮음 → PATCH issue { priority: LOW }', async () => {
    const { user, api } = await openSheet()
    await user.click(screen.getByTestId('mobile-action-priority'))
    await user.click(within(await screen.findByTestId('issue-priority-picker')).getByTestId('picker-option-LOW'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'PATCH', path: `${ISSUES}/21`, body: { priority: 'LOW' } }]))
  })

  test('담당자 → 멤버를 누르면 기존 담당자에 더해 PUT', async () => {
    const { user, api } = await openSheet()
    await user.click(screen.getByTestId('mobile-action-assignee'))
    await user.click(within(await screen.findByTestId('issue-assignee-picker')).getByTestId('picker-option-1'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'PUT', path: `${ISSUES}/21/assignees`, body: { userIds: [2, 1] } }]))
  })

  test('AI에게 맡기기(AI 멤버 1명) → 바로 PUT', async () => {
    const { user, api } = await openSheet()
    await user.click(screen.getByTestId('mobile-action-ai'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'PUT', path: `${ISSUES}/21/assignees`, body: { userIds: [2, 99] } }]))
  })

  test('삭제 → 확인 → DELETE', async () => {
    const { user, api } = await openSheet()
    await user.click(screen.getByTestId('mobile-action-delete'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'DELETE', path: `${ISSUES}/21`, body: null }]))
  })

  test('선택 모드에선 ⋯ 를 숨긴다(탭 = 선택 토글)', async () => {
    const { user } = await openSheet()
    await user.click(screen.getByTestId('mobile-action-select'))
    expect(await screen.findByTestId('issue-bulk-toolbar')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-row-22-menu')).not.toBeInTheDocument()
  })
})
