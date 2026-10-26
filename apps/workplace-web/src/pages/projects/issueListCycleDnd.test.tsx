// 이슈 목록 사이클 구간 드래그(#881) — 비멤버 드래그 차단 판정의 페이지 테스트(WP-971).
// 행이 끌 수 있는 행(dnd-kit 속성·aria-roledescription)인지는 권한에 따른 조건부 렌더라 브라우저 없이 판정되므로
// e2e/pages/projects/issue-list-cycle-dnd.spec.ts 에서 옮겼다. 실제 끌어 놓기·키보드 끌기·되돌리기(@input)는 E2E 에 남는다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { CycleResponse } from '@/types/cycle'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

const CYCLES: CycleResponse[] = [
  { id: 1, projectId: 1, name: '스프린트 12', goal: null, startDate: '2026-09-21', endDate: '2026-10-03', status: 'ACTIVE', createdAt: '', updatedAt: '' },
]

/** 진행 중 사이클 하나에 #12 를 둔 목록을 연다. 이동 요청이 나가면 moves 에 쌓인다. */
async function openList(member: boolean) {
  const moves: unknown[] = []
  const view = renderPage(`/projects/${KEY}`, {
    handlers: [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ viewerIsMember: member }))),
      http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 10, name: '김개발', username: 'kim' })])),
      http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${KEY}/cycles`, () => HttpResponse.json(CYCLES)),
      http.get(`/api/v1/projects/${KEY}/issues`, ({ request }) => {
        const cycle = new URL(request.url).searchParams.get('cycle')
        return HttpResponse.json(createIssueSearchResponse(cycle === '1' ? [createIssue({ id: 12, number: 12, title: '결제 실패 알림' })] : [], null))
      }),
      http.post(`/api/v1/projects/${KEY}/issues/:n/cycles/move`, async ({ request }) => {
        moves.push(await request.json())
        return HttpResponse.json({ cycles: [], removedFrom: false, addedTo: false })
      }),
    ],
  })
  const section = await screen.findByTestId('list-cycle-section-cycle-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const row = await within(section).findByTestId('issue-row-12')
  return { ...view, row, moves }
}

test('멤버의 행은 끌 수 있는 행(aria-roledescription)이다', async () => {
  const { row } = await openList(true)
  expect(row).toHaveAttribute('aria-roledescription', '드래그 가능한 이슈')
})

test('비멤버의 행은 끌 수 없다 — 드래그 속성이 없고 Space 로도 집히지 않는다', async () => {
  const { row, user, moves } = await openList(false)
  expect(row).not.toHaveAttribute('aria-roledescription')
  row.focus()
  await user.keyboard(' ')
  expect(screen.queryByTestId('issue-row-drag-overlay')).not.toBeInTheDocument()
  expect(moves).toEqual([])
})
