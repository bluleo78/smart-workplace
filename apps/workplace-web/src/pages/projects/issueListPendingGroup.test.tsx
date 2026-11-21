// WP-1929: 사이클 목록 판정 대기(pending) 동안에는 사이클 스켈레톤 대신 평면 목록(IssueListView)을 그려야 한다 —
// 목록 쿼리는 두 게이트보다 위에서 발사돼 응답이 캐시에 있으므로, 상태 목록(WP-870)만 오면 행이 곧바로 뜬다.
// 사이클 응답은 약속(promise)으로 멈춘다 — 고정 지연(예: 300ms)은 기계 부하에 따라 행과 사이클 응답의
// 도착 순서가 뒤바뀌어 판정이 흔들리지만, 게이트는 해제 시점을 테스트가 쥐어 판정 순서를 못 박는다.
// 게이트를 열기 전에 평면 행이 떠 있음을 보면 옛 스켈레톤 게이트(행 대신 issue-list-pending 을 그리던 코드)는
// 시간초과로 실패하고, 새 코드는 통과한다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { API } from '@/test/kits/projects/projectScreens'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { CycleResponse } from '@/types/cycle'

import { createCycle } from '../../../e2e/factories/cycle.factory'
import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'PRF1'
const SEED_TITLE = 'WP-1929 씨앗 이슈'

/** 사이클 응답 게이트 — release 를 부르기 전까지 /cycles 응답을 멈춰 판정 대기 상태를 만든다. */
function cyclesGate() {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  return { held, release }
}

/**
 * 공통 핸들러 — 프로젝트 메타 + 시드 이슈(평면 검색) + 게이트에 묶인 사이클 응답.
 * cycle 파라미터가 붙은 구간 검색은 빈 목록으로 답해 구간 전환 이후의 요청도 커버한다.
 */
function setupHandlers(held: Promise<void>, cycles: () => CycleResponse[]) {
  return [
    http.get(`${API}/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, name: 'WP-1929 검증 프로젝트' }))),
    http.get(`${API}/projects/${KEY}/issues`, ({ request }) => {
      const cycle = new URL(request.url).searchParams.get('cycle')
      const items = cycle == null ? [createIssue({ id: 1, number: 1, title: SEED_TITLE })] : []
      return HttpResponse.json(createIssueSearchResponse(items, null))
    }),
    http.get(`${API}/projects/${KEY}/cycles`, async () => {
      await held
      return HttpResponse.json(cycles())
    }),
  ]
}

test('사이클 목록이 오기 전에 이슈 행이 보인다', async () => {
  const gate = cyclesGate()
  // 진행 중 사이클 없음 → 판정 결과는 그룹 없음, 평면 목록이 유지된다.
  const handlers = setupHandlers(gate.held, () => [])
  const { queryClient } = renderPage(`/projects/${KEY}`, { handlers, projectTabs: { [KEY]: 'issues' } })

  // 게이트가 닫혀 있는 사이에 평면 행이 떠야 한다 — 옛 스켈레톤 게이트라면 여기서 시간초과로 실패한다.
  expect(await screen.findByText(SEED_TITLE, {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryAllByTestId(/^list-cycle-section-/)).toHaveLength(0)
  expect(screen.queryByTestId('issue-list-pending')).not.toBeInTheDocument()

  // 게이트 해제 — 진행 중 사이클이 없으면 판정 뒤에도 평면 목록 그대로다(구간으로 바뀌지 않는다).
  gate.release()
  await waitFor(() => expect(queryClient.getQueryState(['cycles', KEY])?.status).toBe('success'))
  expect(screen.queryAllByTestId(/^list-cycle-section-/)).toHaveLength(0)
  expect(screen.getByText(SEED_TITLE)).toBeInTheDocument()
})

test('진행 중 사이클이 오면 그때 구간 목록으로 전환된다', async () => {
  const gate = cyclesGate()
  const handlers = setupHandlers(gate.held, () => [createCycle({ id: 1, status: 'ACTIVE' })])
  renderPage(`/projects/${KEY}`, { handlers, projectTabs: { [KEY]: 'issues' } })

  // 판정 전에는 평면 목록 — 사이클 응답을 기다려 행이 늦어지지 않는다.
  expect(await screen.findByText(SEED_TITLE, {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryAllByTestId(/^list-cycle-section-/)).toHaveLength(0)

  // 게이트 해제 — 진행 중 사이클이 생기면 groupBy=cycle 로 바뀌어 구간 목록이 평면 목록을 대신한다.
  gate.release()
  expect(await screen.findByTestId('list-cycle-section-backlog')).toBeInTheDocument()
  expect(screen.queryByText(SEED_TITLE)).not.toBeInTheDocument()
})
