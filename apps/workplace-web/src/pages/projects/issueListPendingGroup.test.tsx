// WP-1929 리뷰 반려 — 판정 대기(pending) 동안엔 사이클 스켈레톤(IssueCycleListSkeleton)을 그린다(#878 복원):
// 평면 목록이 잠깐 떴다가 구간 목록으로 바뀌는 깜빡임을 막기 위해서다. 목록 쿼리는 두 게이트보다 위에서
// 발사돼 응답이 캐시에 남아, 판정이 끝나 평면 목록이 그려지는 순간 행이 곧바로 뜬다 — 요청만 먼저 나가고
// 화면에는 판정이 끝날 때까지 스켈레톤만 그린다.
// 사이클 응답은 약속(promise)으로 멈춘다 — 고정 지연(예: 300ms)은 기계 부하에 따라 행과 사이클 응답의
// 도착 순서가 뒤바뀌어 판정이 흔들리지만, 게이트는 해제 시점을 테스트가 쥐어 판정 순서를 못 박는다.
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
 * 평면 요청(cycle 파라미터 없음)이 언제 나갔는지 세기 위해 파라미터를 모은다.
 */
function setupHandlers(held: Promise<void>, cycles: () => CycleResponse[]) {
  const flatParams: URLSearchParams[] = []
  const handlers = [
    http.get(`${API}/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, name: 'WP-1929 검증 프로젝트' }))),
    http.get(`${API}/projects/${KEY}/issues`, ({ request }) => {
      const url = new URL(request.url)
      const cycle = url.searchParams.get('cycle')
      if (cycle == null) flatParams.push(url.searchParams)
      const items = cycle == null ? [createIssue({ id: 1, number: 1, title: SEED_TITLE })] : []
      return HttpResponse.json(createIssueSearchResponse(items, null))
    }),
    http.get(`${API}/projects/${KEY}/cycles`, async () => {
      await held
      return HttpResponse.json(cycles())
    }),
  ]
  return { handlers, flatParams }
}

test('판정 대기 동안엔 스켈레톤이고, 판정이 끝나야 이슈 행이 보인다', async () => {
  const gate = cyclesGate()
  // 진행 중 사이클 없음 → 판정 결과는 그룹 없음, 평면 목록이 이어진다.
  const { handlers, flatParams } = setupHandlers(gate.held, () => [])
  const { queryClient } = renderPage(`/projects/${KEY}`, { handlers, projectTabs: { [KEY]: 'issues' } })

  // 게이트가 닫혀 있는 사이엔 스켈레톤이 보이고 행은 아직 없다(#878 복원 — WP-1929 리뷰 반려).
  expect(await screen.findByTestId('issue-list-pending', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryByText(SEED_TITLE)).not.toBeInTheDocument()
  expect(screen.queryAllByTestId(/^list-cycle-section-/)).toHaveLength(0)
  // 화면은 스켈레톤이어도 목록 요청은 게이트 위에서 이미 나가 있다(WP-1929 완료 기준 ① — 발사는 판정을 기다리지 않는다).
  await waitFor(() => expect(flatParams.filter((p) => p.get('size') === '30')).toHaveLength(1), {
    timeout: PAGE_LOAD_TIMEOUT,
  })

  // 게이트 해제 — 진행 중 사이클이 없으면 판정 뒤엔 평면 목록 그대로다(구간으로 바뀌지 않는다).
  gate.release()
  await waitFor(() => expect(queryClient.getQueryState(['cycles', KEY])?.status).toBe('success'))
  expect(await screen.findByText(SEED_TITLE, {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryByTestId('issue-list-pending')).not.toBeInTheDocument()
  expect(screen.queryAllByTestId(/^list-cycle-section-/)).toHaveLength(0)
  // 판정 뒤에 평면 요청이 한 번 더 나가지 않는다 — 이미 캐시에 있던 그 요청을 다시 쓴다.
  expect(flatParams.filter((p) => p.get('size') === '30')).toHaveLength(1)
})

test('진행 중 사이클이 오면 그때 구간 목록으로 전환된다', async () => {
  const gate = cyclesGate()
  const { handlers, flatParams } = setupHandlers(gate.held, () => [createCycle({ id: 1, status: 'ACTIVE' })])
  renderPage(`/projects/${KEY}`, { handlers, projectTabs: { [KEY]: 'issues' } })

  // 판정 전엔 스켈레톤 — 평면 목록이 잠깐 떴다가 구간으로 바뀌지 않는다(#878, WP-1929 리뷰 반려).
  expect(await screen.findByTestId('issue-list-pending', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryByText(SEED_TITLE)).not.toBeInTheDocument()
  // 발사는 이미 끝났다(요청 1건) — 스켈레톤이 목록 쿼리를 막지 않음을 함께 고정한다.
  await waitFor(() => expect(flatParams.filter((p) => p.get('size') === '30')).toHaveLength(1), {
    timeout: PAGE_LOAD_TIMEOUT,
  })

  // 게이트 해제 — 진행 중 사이클이 생기면 groupBy=cycle 로 바뀌어 구간 목록이 스켈레톤을 대신한다.
  gate.release()
  expect(await screen.findByTestId('list-cycle-section-backlog', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.queryByTestId('issue-list-pending')).not.toBeInTheDocument()
  expect(screen.queryByText(SEED_TITLE)).not.toBeInTheDocument()
})