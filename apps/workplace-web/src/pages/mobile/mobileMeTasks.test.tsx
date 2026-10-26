// 모바일 내 작업(WP-630·WP-886·WP-916) — 페이지 테스트(WP-981).
// 우선순위 메타 문구·색, 프로젝트 머리 줄 순서, 할당/구독 탭의 아바타 유무, 마감 지남 표시, 행 탭 이동은 브라우저 없이 판정되므로
// e2e/pages/mobile/me-tasks.spec.ts 에서 옮겼다. 본문 스크롤·행 폭 같은 기하(@layout)는 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { server } from '@/test/msw/server'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'
import type { IssueResponse } from '@/types/issue'
import type { UserSummary } from '@/types/user'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'

mockViewport()

afterEach(() => {
  vi.useRealTimers()
})

const agent: UserSummary = { id: 9, username: 'claude', name: 'Claude', kind: 'AGENT' }
const human: UserSummary = { id: 7, username: 'kim', name: '김민수', kind: 'HUMAN' }
const EX = { name: '외부 연동 프로젝트', size: 2 }
const OPS = { name: '운영 개선', size: 1 }
const GROUPED = [
  createIssue({ id: 301, projectKey: 'EX', number: 31, title: '외부 연동 첫 작업', assignees: [human], projectGroup: EX }),
  createIssue({ id: 302, projectKey: 'EX', number: 32, title: '외부 연동 둘째 작업', assignees: [human], projectGroup: EX }),
  createIssue({ id: 303, projectKey: 'OPS', number: 5, title: '운영 작업', assignees: [human], projectGroup: OPS }),
]

/** 내 작업(할당 탭)을 연다 — /me/issues 가 issues 를 준다. */
function open(issues: IssueResponse[], path = '/me/tasks/assigned') {
  return renderPage(path, {
    handlers: [
      http.get('/api/v1/me/issues', () => HttpResponse.json(createIssueSearchResponse(issues))),
      http.get('/api/v1/me/watched-issues', () => HttpResponse.json(createIssueSearchResponse(issues))),
    ],
  })
}

// 우선순위는 높음·매우 높음만 빨간 글자, 매우 낮음은 메타 줄에서 숨긴다(WP-886) — 경고가 필요한 것만 눈에 띄게.
test('모바일 메타 — 우선순위는 높음·매우 높음만 빨간 글자로, 매우 낮음은 숨긴다', async () => {
  open([
    createIssue({ id: 301, number: 31, title: '결제 장애', priority: 'HIGHEST', assignees: [agent] }),
    createIssue({ id: 302, number: 32, title: '로그인 오류', priority: 'HIGH', assignees: [agent] }),
    createIssue({ id: 303, number: 33, title: '아이디어', priority: 'LOWEST', assignees: [agent] }),
  ])
  const highestMeta = await screen.findByTestId('assigned-row-301-meta', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(within(highestMeta).getByText('매우 높음', { exact: true })).toHaveClass('text-destructive')
  expect(within(screen.getByTestId('assigned-row-302-meta')).getByText('높음', { exact: true })).toHaveClass('text-destructive')
  expect(screen.getByTestId('assigned-row-303-meta')).not.toHaveTextContent('낮음')
})

// 프로젝트 머리 줄(WP-916) — 그 프로젝트 행들 바로 앞에 온다(문서 순서).
test('내 작업 — 프로젝트 머리 줄이 그 프로젝트 행 위에 있다', async () => {
  open(GROUPED)
  const exHead = await screen.findByTestId('assigned-row-project-EX-head', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const opsHead = screen.getByTestId('assigned-row-project-OPS-head')
  expect(exHead).toHaveTextContent(EX.name)
  expect(opsHead).toHaveTextContent(OPS.name)
  const order = ['assigned-row-project-EX-head', 'assigned-row-301', 'assigned-row-302', 'assigned-row-project-OPS-head', 'assigned-row-303']
  const els = order.map((id) => screen.getByTestId(id))
  for (let i = 1; i < els.length; i++) {
    // 앞 요소 뒤에 다음 요소가 온다.
    expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
})

// 할당 탭은 모두 내 일이라 아바타가 군더더기 — 구독 탭은 담당자가 제각각이라 아바타를 보인다(WP-916).
test('내 작업 — 할당 탭은 아바타가 없고 구독 탭은 있다', async () => {
  const { user } = open(GROUPED)
  const row = await screen.findByTestId('assigned-row-301', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(within(row).queryAllByTestId(/^user-avatar/)).toHaveLength(0)
  await user.click(screen.getByTestId('tab-watched'))
  const watched = await screen.findByTestId('watched-row-301')
  expect(within(watched).queryAllByTestId(/^user-avatar/).length).toBeGreaterThan(0)
})

// 마감 지남은 미완료만 빨강 + 「마감 지남」, 완료된 일은 같은 날짜여도 표시하지 않는다(WP-916).
test('내 작업 — 마감 지남은 빨강, 완료는 표시 없음', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T10:00:00'))
  open(
    [
      createIssue({ id: 401, projectKey: 'EX', number: 41, title: '지난 마감', dueDate: '2026-10-20', projectGroup: EX }),
      createIssue({ id: 402, projectKey: 'EX', number: 42, title: '끝난 일', status: 'DONE', dueDate: '2026-10-20', projectGroup: EX }),
    ],
    '/me/tasks/assigned?closed=all',
  )
  const overdue = await screen.findByTestId('assigned-row-401-due', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(overdue).toHaveClass('text-destructive')
  expect(overdue).toHaveTextContent('10월 20일')
  expect(overdue).toHaveTextContent('마감 지남')
  const done = screen.getByTestId('assigned-row-402-due')
  expect(done).not.toHaveClass('text-destructive')
  expect(done).not.toHaveTextContent('마감 지남')
})

// 행 전체가 탭 대상 — 제목 링크가 아닌 메타 줄을 눌러도 상세로 간다(WP-916).
test('내 작업 — 메타 줄을 눌러도 행 탭으로 상세 이동', async () => {
  const { location } = open(GROUPED)
  // 라우터 이동은 transition 이라 상세 페이지 모듈(lazy)을 처음 불러올 때까지 주소가 늦게 바뀐다.
  // 상세 화면 자체는 이 테스트의 관심사가 아니라 그 조회는 404 로 막는다.
  server.use(
    http.get('/api/v1/projects/EX', () => HttpResponse.json({ message: '없음' }, { status: 404 })),
    http.get('/api/v1/projects/EX/*', () => HttpResponse.json({ message: '없음' }, { status: 404 })),
    http.get('/api/v1/issues/*', () => HttpResponse.json([])),
  )
  fireEvent.click(await screen.findByTestId('assigned-row-301-meta', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await waitFor(() => expect(location()).toBe('/projects/EX/issues/31'), { timeout: PAGE_LOAD_TIMEOUT })
})
