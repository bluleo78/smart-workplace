// 모바일 폭의 완료일 표기(WP-873) — 페이지 테스트(WP-980).
// 이슈 상세 칩 줄 아래 완료 줄, 모바일 목록 행 메타·모바일 보드 카드 메타의 완료일 문구는 브라우저 없이 판정되므로
// e2e/pages/projects/issue-closed-date.spec.ts 에서 옮겼다. 뷰포트는 파일 하나에 하나라 데스크톱(issueClosedDate.test.tsx)과 나눈다.
// 화면 테스트(WP-1002) — 이슈 상세·프로젝트 상세 화면만 renderIssueDetailScreen·renderProjectScreen 으로 띄운다(App·인증 부팅·앱 셸 없이).
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'

mockViewport()

const KEY = 'PROJ'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T06:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const DONE_LATE = { status: 'DONE', statusId: 3, statusName: '완료', closedAt: '2026-10-23T05:05:00Z', dueDate: '2026-10-21' } as const
const ISSUES = [
  createIssue({ id: 1, number: 1, title: '늦게 끝남', ...DONE_LATE }),
  createIssue({ id: 2, number: 2, title: '종료 시각 없음', status: 'DONE', closedAt: null, dueDate: '2026-10-21' }),
  createIssue({ id: 3, number: 3, title: '취소됨', status: 'CANCELED', closedAt: '2026-10-18T03:00:00Z', dueDate: '2026-10-10' }),
]

const listHandlers = [
  http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
  http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
  http.get(`/api/v1/projects/${KEY}/issues`, ({ request }) => {
    const statusId = new URL(request.url).searchParams.get('statusId')
    return HttpResponse.json(createIssueSearchResponse(statusId ? ISSUES.filter((i) => String(i.statusId) === statusId) : ISSUES))
  }),
]

// 모바일 상세는 속성 레일 대신 칩 줄을 쓴다 — 같은 완료 줄이 한 번만 보여야 한다(레일·칩 중복 금지).
test('모바일 이슈 상세에서도 같은 완료 문구가 한 번만 보인다', async () => {
  renderIssueDetailScreen(`/projects/${KEY}/issues/1`, {
    handlers: issueDetailHandlers({ key: KEY, detail: createIssueDetail({ summary: { ...createIssue({ projectKey: KEY }), ...DONE_LATE } }) }),
  })
  expect(await screen.findByTestId('mobile-prop-chips', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
  const lines = await screen.findAllByTestId('issue-closed-line')
  expect(lines).toHaveLength(1)
  expect(lines[0]).toHaveTextContent('✓ 10월 23일 (금) 오후 2:05 완료')
  expect(within(lines[0]).getByTestId('issue-closed-late')).toHaveTextContent('마감 +2일')
})

test('모바일 목록 행 메타에 완료일이 보이고, closedAt 없는 종료 이슈는 같은 표기의 마감으로 폴백한다', async () => {
  renderProjectScreen(`/projects/${KEY}?group=none`, { handlers: listHandlers })
  const meta1 = await screen.findByTestId('issue-row-1-meta', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(meta1).toHaveTextContent('✓ 10월 23일')
  expect(meta1).toHaveTextContent('+2일')
  expect(screen.getByTestId('issue-row-3-meta')).toHaveTextContent('⊘ 10월 18일')
  // 마감도 완료일과 같은 표기(같은 해면 연도 생략, 스펙 4.6) — 「2026년 10월 21일」 이 섞여 보이지 않게.
  const meta2 = screen.getByTestId('issue-row-2-meta')
  expect(meta2).not.toHaveTextContent('✓')
  expect(meta2).toHaveTextContent('10월 21일')
  expect(meta2).not.toHaveTextContent('2026년')
})

// 모바일 보드는 상태 탭 하나씩 — 완료(3)·취소(4) 탭의 카드 메타.
test('모바일 보드 카드 메타에 완료일이 보인다', async () => {
  const { unmount } = renderProjectScreen(`/projects/${KEY}?view=board&group=none&boardTab=3`, { handlers: listHandlers })
  const meta = await screen.findByTestId('issue-card-1-meta', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(meta).toHaveTextContent('✓ 10월 23일')
  expect(meta).toHaveTextContent('+2일')
  unmount()
  renderProjectScreen(`/projects/${KEY}?view=board&group=none&boardTab=4`, { handlers: listHandlers })
  expect(await screen.findByTestId('issue-card-3-meta')).toHaveTextContent('⊘ 10월 18일')
})
