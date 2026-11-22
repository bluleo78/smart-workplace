// WP-1929: 이슈 목록 쿼리는 두 게이트(ProjectStatusesGate 의 상태 목록, 사이클 그룹 판정 groupPending)를 기다리지 않고
// 페이지 진입과 함께 발사돼야 한다 — 26개 API 사슬 뒤 4.4초에 발사되던 것을 고친다.
// 상태 목록 응답을 게이트(약속)로 멈춰 「상태 목록이 늦게 오는」 화면을 만들고, 목록 검색(size=30) 요청이 그 응답이
// 끝나기 전에 MSW 에 도착하는지 단언한다. 요청이 게이트 아래(목록 뷰 마운트)에서만 나가면 게이트를 열기 전에
// 도착하지 못해 시간초과로 실패한다 — 고정 지연(300ms)과 달리 기계 부하에 흔들리지 않는다.
// lazy 라우트 모듈 미리 불러오기(WP-1874) — 레이아웃(이미 eager 인 IssueCreateDialog 포함)이 상태 목록을 부른 뒤
// 페이지 청크가 변환·로드되는 몇 밀리초~수 초가 판정 시각에 끼면, 게이트가 아니라 청크 로드 시간을 재는 꼴이 된다.
// 모듈을 미리 등록하면 본문(ProjectIssuesSection)은 레이아웃과 같은 커밋에서 그려지고, 판정은 오직 게이트 유무로만 갈린다.
import '@/pages/projects/ProjectDetailPage'

import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { API } from '@/test/kits/projects/projectScreens'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'

const KEY = 'PRF1'
const SEED_TITLE = 'WP-1929 씨앗 이슈'

test('상태 목록이 오기 전에 이슈 목록 요청이 나간다', async () => {
  // 두 시각 모두 첫 응답의 것만 적는다(??=) — 뒤에 오는 재응답(무효화 등)이 upper bound 를 밀어
  // 회귀(게이트 아래 발사)가 통과해 버리지 못하게 한다(이슈 쪽 issuesRequestedAt 과 같은 규칙).
  let statusesCompletedAt: number | null = null
  let issuesRequestedAt: number | null = null
  // 관측한 검색 요청의 파라미터 — 평면 요청이 하나뿐인지 세는 데 쓴다(issueListCycleGroup.test.tsx 와 같은 수집 방식).
  const requestedParams: URLSearchParams[] = []
  // 상태 목록 응답 게이트 — issueListPendingGroup.test.tsx 와 같은 약속 패턴. 게이트를 열기 전에
  // 평면 요청이 안 오면(게이트 아래에서만 발사하는 회귀) 시간초과로 실패하고, 열 뒤 시각 비교는 이미 성립한다.
  let releaseStatuses: () => void = () => {}
  const statusesGate = new Promise<void>((r) => (releaseStatuses = r))
  const handlers = [
    // 프로젝트 메타 — 레이아웃(ProjectTabsLayout)이 본문을 그리기 전에 받는다.
    http.get(`${API}/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, name: '성능 검증 프로젝트' }))),
    // 상태 목록(WP-870 게이트) — 응답을 게이트에 묶어 게이트가 늦게 열리게 한다. 게이트를 연 응답의 시각을 적는다.
    http.get(`${API}/projects/${KEY}/statuses`, async () => {
      await statusesGate
      statusesCompletedAt ??= Date.now()
      return HttpResponse.json(seedStatuses())
    }),
    // 이슈 목록 검색 — size=30(목록 페이지) 요청이 나간 시점을 적는다. 같은 queryKey 라 게이트 위 호출과 목록 뷰 호출은 하나로 합쳐진다.
    http.get(`${API}/projects/${KEY}/issues`, ({ request }) => {
      const url = new URL(request.url)
      requestedParams.push(url.searchParams)
      if (url.searchParams.get('size') === '30') issuesRequestedAt ??= Date.now()
      return HttpResponse.json(createIssueSearchResponse([createIssue({ id: 1, number: 1, title: SEED_TITLE })], null))
    }),
  ]
  renderPage(`/projects/${KEY}`, { handlers, projectTabs: { [KEY]: 'issues' } })

  // 게이트가 닫혀 있는 동안(상태 목록 응답이 아직 안 나간 상태)에 평면 요청이 이미 도착해야 한다 —
  // 게이트 아래에서만 발사하는 회귀라면 이 대기가 시간초과로 실패한다.
  await waitFor(() => expect(issuesRequestedAt).not.toBeNull(), { timeout: PAGE_LOAD_TIMEOUT })
  releaseStatuses()
  // 상태 목록 응답이 끝날 때까지 기다렸다 시각을 비교한다 — 게이트 위에서 시작하면 응답이 끝나기 전에 이미 도착해 있다.
  await waitFor(() => expect(statusesCompletedAt).not.toBeNull(), { timeout: PAGE_LOAD_TIMEOUT })
  // 게이트보다 위에서 시작한 요청은 상태 목록 응답이 끝나기 전에 이미 MSW 에 도착해 있다.
  expect(issuesRequestedAt!).toBeLessThan(statusesCompletedAt!)
  // 요청만 먼저 나가는 게 아니라 상태 목록 도착 후 게이트를 통해 행이 실제로 그려진다.
  expect(await screen.findByText(SEED_TITLE, {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  // WP-1929 — 이 평면 목록 모드에서도 플랫(사이클 파라미터 없는) 요청은 정확히 하나여야 한다.
  // 게이트 위 hoist 와 IssueListView 가 같은 queryKey 를 공유하는 한 합쳐져 1건 — 두 키가 갈라지면(회귀)
  // 목록 뷰가 자기 키로 다시 요청해 2건이 되고 여기서 실패한다.
  expect(requestedParams.filter((p) => !p.has('cycle'))).toHaveLength(1)
})

// WP-1929 리뷰 — 「목록 첫 페이지가 상태 목록보다 먼저 오면 refreshStatusesOnUnknown 이 캐시가 비어 있어 그냥
// 돌아간다」는 지적에 대한 페이지 수준 회귀: 목록(모르는 statusId)이 먼저 도착한 뒤 상태 목록이 오면,
// useProjectStatuses 가 캐시된 목록 페이지를 다시 훑어 모르는 상태로 한 번 더 받아야 한다(WP-870·WP-936).
test('목록이 상태 목록보다 먼저 와도, 상태 목록이 오면 모르는 상태로 한 번 더 받는다', async () => {
  // 상태 목록 응답 게이트 — 위 테스트와 같은 약속 패턴. 게이트가 닫힌 동안 목록 응답만 먼저 간다.
  let releaseStatuses: () => void = () => {}
  const statusesGate = new Promise<void>((r) => (releaseStatuses = r))
  let statusesRequests = 0
  let issuesArrivedAt: number | null = null
  const handlers = [
    http.get(`${API}/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, name: '상태 재검사 프로젝트' }))),
    http.get(`${API}/projects/${KEY}/statuses`, async () => {
      statusesRequests += 1
      if (statusesRequests === 1) await statusesGate
      return HttpResponse.json(seedStatuses())
    }),
    http.get(`${API}/projects/${KEY}/issues`, () => {
      issuesArrivedAt ??= Date.now()
      // 상태 목록(1~4)에 없는 statusId — 목록이 먼저 왔을 때의 판정 대상.
      return HttpResponse.json(
        createIssueSearchResponse([createIssue({ id: 1, number: 1, title: SEED_TITLE, statusId: 99, statusName: '방금 만든 상태' })], null),
      )
    }),
  ]
  renderPage(`/projects/${KEY}`, { handlers, projectTabs: { [KEY]: 'issues' } })

  // 목록 응답이 상태 목록보다 먼저 도착했음을 확인한다 — 이 시점에 refreshStatusesOnUnknown 은 캐시가 비어 있어 판정하지 못한다.
  await waitFor(() => expect(issuesArrivedAt).not.toBeNull(), { timeout: PAGE_LOAD_TIMEOUT })
  expect(statusesRequests).toBe(1)
  // 게이트 해제 — 상태 목록이 오면 캐시된 목록 페이지를 훑어 모르는 상태(99)를 발견, 한 번 더 받아야 한다.
  releaseStatuses()
  // 정확히 두 번(처음 조회 + 모르는 상태 발견으로 인한 재검사) — 재검사(useProjectStatuses 도착 시 캐시 검사)를
  // 지우면 이 단언이 실패해야 한다(WP-1929 리뷰 nit — >= 는 다른 재요청으로도 통과해 허용했다).
  await waitFor(() => expect(statusesRequests).toBe(2), { timeout: PAGE_LOAD_TIMEOUT })
  // 목록은 그대로 화면에 있다(깨지지 않는다).
  expect(await screen.findByText(SEED_TITLE, {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
})
