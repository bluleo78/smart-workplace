// 모바일 사이클 목록(WP-197) — 페이지 테스트(WP-981).
// ⋯ → 액션 시트 → 삭제(취소는 유지·확인은 DELETE)와 행 탭 → 그 사이클로 필터된 이슈 목록 이동은 요청·주소라
// e2e/pages/mobile/cycles.spec.ts 에서 옮겼다. 2줄 요약 말줄임·⋯ 44px 같은 기하는 그 E2E 가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'
import type { CycleProgress, CycleResponse } from '@/types/cycle'

import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'

mockViewport()

const KEY = 'WP'
const now = '2026-10-01T00:00:00Z'
const cycle = (o: Partial<CycleResponse>): CycleResponse => ({
  id: 1, projectId: 1, name: '스프린트', goal: null, startDate: null, endDate: null, status: 'ACTIVE', createdAt: now, updatedAt: now, ...o,
})
const CYCLES = [
  cycle({ id: 1, name: '결제 모듈 재구축 1차', startDate: '2026-09-29', endDate: '2026-10-10', status: 'ACTIVE' }),
  cycle({ id: 2, name: '시작만', startDate: '2026-10-13', status: 'PLANNED' }),
]
const PROGRESS: CycleProgress[] = [{ cycleId: 1, total: 20, done: 9, byStatus: { DONE: 9, TODO: 11 } }]

/** 사이클 화면 + 행 탭 뒤 도착하는 프로젝트 상세(이슈 목록)의 최소 응답. DELETE 는 deletes 에 id 를 모은다. */
function handlers(deletes: number[]) {
  return [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
    http.get(`/api/v1/projects/${KEY}/cycles`, () => HttpResponse.json(CYCLES)),
    http.get(`/api/v1/projects/${KEY}/cycles/progress`, () => HttpResponse.json(PROGRESS)),
    http.delete(`/api/v1/projects/${KEY}/cycles/:id`, ({ params }) => {
      deletes.push(Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
  ]
}

test('⋯ → 삭제 → 취소는 요청 없이 유지, 다시 ⋯ → 삭제 → 확인은 그 사이클 DELETE', async () => {
  const deletes: number[] = []
  const { user } = renderPage(`/projects/${KEY}/cycles`, { handlers: handlers(deletes) })
  await user.click(await screen.findByTestId('cycle-more-2', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await user.click(within(await screen.findByTestId('cycle-sheet')).getByTestId('mobile-action-delete'))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(deletes).toEqual([])

  await user.click(screen.getByTestId('cycle-more-2'))
  await user.click(within(await screen.findByTestId('cycle-sheet')).getByTestId('mobile-action-delete'))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(deletes).toEqual([2]))
})

test('행을 누르면 그 사이클로 필터된 이슈 목록으로 간다', async () => {
  const { user, location } = renderPage(`/projects/${KEY}/cycles`, { handlers: handlers([]) })
  const row = await screen.findByTestId('cycle-row-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(within(row).getByRole('link'))
  // 상세는 lazy 청크라 첫 이동은 늦게 반영된다.
  await waitFor(() => expect(new URLSearchParams(location().split('?')[1]).get('cycle')).toBe('1'), { timeout: PAGE_LOAD_TIMEOUT })
  expect(location().startsWith(`/projects/${KEY}?`)).toBe(true)
})
