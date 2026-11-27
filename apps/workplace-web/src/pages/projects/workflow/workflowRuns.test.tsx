// 워크플로우 실행 목록 — 필터가 요청 쿼리로 가는지, 다음 쪽·줄 선택·모아 보기가 주소와 맞물리는지(WP-1991).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, it } from 'vitest'

import { mkModel } from '@/test/kits/projects/workflowRunFixtures'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'

import { WorkflowRuns } from './WorkflowRuns'

const base = '/api/v1'
const kim = { id: 3, username: 'kim', name: '김', kind: 'HUMAN' as const }
const item = (runId: number, extra: object = {}) => ({
  runId, issueId: runId * 10, issueNumber: runId * 10, issueKey: 'WP-' + runId, title: '제목 ' + runId, status: 'WAITING', currentNode: 'b',
  currentNodeName: '검토', assignees: [kim], enteredAt: new Date(Date.now() - 3600_000).toISOString(),
  startedAt: '2026-11-20T00:00:00Z', versionNo: 2, ...extra,
})

/** id 1(WP-1) 실행 상세 응답 — 워크플로우 42 의 실행. */
const runDetailBody = () => ({
  run: {
    runId: 1, workflowId: 42, versionNo: 2, issueId: 10, issueNumber: 10, issueKey: 'WP-1', title: '제목 1', status: 'WAITING', revision: 1,
    currentNode: 'b', startedBy: kim, startedAt: '2026-11-20T00:00:00Z', endedAt: null, context: {},
  },
  nodeRuns: [],
  events: [],
  model: mkModel(),
})

/** 요청 URL 을 모으며 응답하는 공통 핸들러. */
function setup(
  respond: (url: URL) => object = () => ({ items: [item(1)], nextCursor: null }),
  opts: { activeVersionNo?: number | null; search?: string; versionFails?: boolean; olderNotice?: string | null; counts?: object; countsFail?: boolean } = {},
) {
  const urls: URL[] = []
  const screenRun = renderScreen(
    <WorkflowRuns workflowId={42} projectKey="WP" activeVersionNo={opts.activeVersionNo === undefined ? 2 : opts.activeVersionNo} canManage canRecover meId={1} runningCount={4} runningFailed={false} onRetryRunning={() => {}} olderNotice={opts.olderNotice} />,
    {
      path: '/projects/WP/workflow?view=runs' + (opts.search ?? ''),
      handlers: [
        http.get(base + '/workflows/42/runs', ({ request }) => {
          const url = new URL(request.url)
          urls.push(url)
          return HttpResponse.json(respond(url))
        }),
        http.get(base + '/workflows/42/versions/2', () => (opts.versionFails
          ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ versionNo: 2, sourceYaml: '', model: mkModel() }))),
        http.get(base + '/projects/WP/members', () => HttpResponse.json([
          { userId: 3, username: 'kim', name: '김', kind: 'HUMAN', role: 'MEMBER', createdAt: null },
        ])),
        // id 1 만 상세가 있고 나머지는 404 — 열림 안내(WP-2053)와 없는 실행 분기를 함께 본다.
        http.get(base + '/workflow-runs/:id', ({ params }) => (params.id === '1'
          ? HttpResponse.json(runDetailBody())
          : HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 }))),
        http.get(base + '/workflows/42/run-counts', () => (opts.countsFail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(opts.counts ?? { counts: { b: 2 } }))),
      ],
    },
  )
  return { ...screenRun, urls }
}

it('runs_filterByStatusNodeAssignee', async () => {
  const { user, urls } = setup((url) => (url.searchParams.get('status') === 'SUSPENDED' || url.searchParams.has('node') || url.searchParams.has('assigneeId')
    ? { items: [], nextCursor: null } : { items: [item(1, { status: 'SUSPENDED' })], nextCursor: null }))
  // 줄은 점+sr-only 상태 이름과 메타 한 줄(이슈 키·노드·담당·시간). 필터는 「필터」 팝오버 안(WP-2157).
  const row = (await screen.findByText('제목 1')).closest('li')!
  expect(within(row).getByText('조치 필요')).toHaveClass('sr-only')
  expect(row).toHaveTextContent('WP-1 · 검토 · 김')
  await user.click(screen.getByRole('button', { name: '필터' }))
  await screen.findByRole('option', { name: '검토' })
  await screen.findByRole('option', { name: '김' })
  await user.selectOptions(screen.getByLabelText('상태'), '조치 필요')
  await waitFor(() => expect(urls.at(-1)!.searchParams.get('status')).toBe('SUSPENDED'))
  await user.selectOptions(screen.getByLabelText('노드'), '검토')
  await waitFor(() => expect(urls.at(-1)!.searchParams.get('node')).toBe('b'))
  await user.selectOptions(screen.getByLabelText('담당'), '김')
  await waitFor(() => expect(urls.at(-1)!.searchParams.get('assigneeId')).toBe('3'))
  const last = urls.at(-1)!.searchParams
  expect(last.get('status')).toBe('SUSPENDED')
  expect(last.get('node')).toBe('b')
  expect(last.get('assigneeId')).toBe('3')
  expect(last.has('cursor')).toBe(false)
  expect(await screen.findByText('조건에 맞는 실행이 없습니다')).toBeVisible()
})

// 사람 차례 줄은 칩 없이 메타 줄이 경고색(WP-2157). sr-only 로 상태 이름은 남긴다.
it('runsList_rowMetaAndWaitingTone', async () => {
  setup(() => ({ items: [item(1, { currentNodeName: '개발 질문 답변', assignees: [{ ...kim, name: '양동희' }] })], nextCursor: null }))
  const row = (await screen.findByText('제목 1')).closest('li')!
  expect(within(row).getByText('사람 차례')).toHaveClass('sr-only')
  const meta = within(row).getByText(/^WP-1 · 개발 질문 답변 · 양동희 · /)
  expect(meta).toHaveClass('text-warning-text')
})

it('runsList_selectedRowHasLeftBar', async () => {
  setup(() => ({ items: [item(1), item(2)], nextCursor: null }), { search: '&run=1' })
  const sel = (await screen.findByRole('button', { name: /제목 1/ }))
  expect(sel).toHaveAttribute('aria-current', 'true')
  expect(sel).toHaveClass('border-primary')
  expect(screen.getByRole('button', { name: /제목 2/ })).not.toHaveAttribute('aria-current')
})

it('runsList_defaultActiveTabSendsActiveStatus', async () => {
  const { urls } = setup()
  await screen.findByText('제목 1')
  expect(urls[0].searchParams.get('status')).toBe('ACTIVE')
})

const byStatus = { RUNNING: 1, WAITING: 1, SUSPENDED: 0, COMPLETED: 1, CANCELED: 0 }

it('runsList_tabCountsFromByStatus', async () => {
  setup(undefined, { counts: { counts: {}, byStatus } })
  expect(await screen.findByRole('button', { name: '진행 중 2' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '완료 1' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: '전체' })).toBeVisible()
})

it('runsList_completedTabSendsCompleted', async () => {
  const { user, urls } = setup(undefined, { counts: { counts: {}, byStatus } })
  await user.click(await screen.findByRole('button', { name: '완료 1' }))
  await waitFor(() => expect(urls.at(-1)!.searchParams.get('status')).toBe('COMPLETED'))
})

it('runsList_allTabSendsNoStatus', async () => {
  const { user, urls } = setup(undefined, { counts: { counts: {}, byStatus } })
  await user.click(await screen.findByRole('button', { name: '전체' }))
  await waitFor(() => expect(urls.at(-1)!.searchParams.has('status')).toBe(false))
})

it('statusSelectOverridesTab', async () => {
  const { user, urls } = setup(undefined, { counts: { counts: {}, byStatus } })
  await user.click(await screen.findByRole('button', { name: '완료 1' }))
  await user.click(screen.getByRole('button', { name: '필터' }))
  await user.selectOptions(screen.getByLabelText('상태'), '조치 필요')
  await waitFor(() => expect(urls.at(-1)!.searchParams.get('status')).toBe('SUSPENDED'))
  expect(screen.getByRole('button', { name: '필터 1' })).toBeVisible()
})

it('tabsWithoutCountsWhenCountsFail', async () => {
  setup(undefined, { countsFail: true })
  expect(await screen.findByText('제목 1')).toBeVisible()
  expect(screen.getByRole('button', { name: '진행 중' })).toBeVisible()
  expect(screen.getByRole('button', { name: '완료' })).toBeVisible()
})

// WP-2157 리뷰: 탭 숫자(run-counts) 조회가 실패하면 안내와 다시 불러오기를 보이고, 누르면 다시 조회한다.
it('countsFail_showsRetryAndRefetches', async () => {
  let calls = 0
  let fail = true
  const { user } = setup(undefined, { countsFail: true })
  server.use(http.get(base + '/workflows/42/run-counts', () => {
    calls += 1
    return fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ counts: {}, byStatus: { RUNNING: 2, WAITING: 0, SUSPENDED: 0, COMPLETED: 5, CANCELED: 0 } })
  }))
  const retry = await screen.findByRole('button', { name: '다시 불러오기' })
  const before = calls
  fail = false
  await user.click(retry)
  await waitFor(() => expect(calls).toBeGreaterThan(before))
  expect(await screen.findByRole('button', { name: '완료 5' })).toBeVisible()
})

it('runsList_filterButtonInsideHasNodeAssignee', async () => {
  const { user } = setup()
  await screen.findByRole('button', { name: /제목 1/ })
  expect(screen.queryByLabelText('노드')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '필터' }))
  expect(screen.getByLabelText('노드')).toBeVisible()
  expect(screen.getByLabelText('담당')).toBeVisible()
  expect(screen.getByLabelText('상태')).toBeVisible()
})

it('runs_noFilterNoRuns_showsEmptyMessage', async () => {
  const { user } = setup(() => ({ items: [], nextCursor: null }))
  // 진행 중 탭에서는 「조건에 맞는…」, 전체 탭·필터 없음에서만 「아직…」.
  expect(await screen.findByText('조건에 맞는 실행이 없습니다')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '전체' }))
  expect(await screen.findByText('아직 실행이 없습니다')).toBeVisible()
})

it('runs_nextPage_appendsWithCursor', async () => {
  const { user, urls } = setup((url) => (url.searchParams.get('cursor') === 'c1'
    ? { items: [item(2)], nextCursor: null } : { items: [item(1)], nextCursor: 'c1' }))
  await screen.findByText(/^WP-1 · /)
  await user.click(screen.getByRole('button', { name: '더 보기' }))
  expect(await screen.findByText(/^WP-2 · /)).toBeVisible()
  expect(screen.getByText(/^WP-1 · /)).toBeVisible()
  expect(urls.at(-1)!.searchParams.get('cursor')).toBe('c1')
})

it('runs_selectRow_setsRunParam', async () => {
  const { user, location } = setup()
  await user.click((await screen.findByText(/^WP-1 · /)).closest('button')!)
  await waitFor(() => expect(location()).toContain('run=1'))
  expect(location()).toContain('view=runs')
  window.history.back()
  await waitFor(() => expect(location()).not.toContain('run='))
})

it('runs_selectRow_announcesOpenedDetail', async () => {
  const { user } = setup()
  const status = await screen.findByTestId('run-detail-status')
  await screen.findByText(/^WP-1 · /)
  expect(status).toHaveTextContent('')
  await user.click(screen.getByText(/^WP-1 · /).closest('button')!)
  await waitFor(() => expect(screen.getByTestId('run-detail-status')).toHaveTextContent('WP-1 실행 상세를 열었습니다'))
  const region = await screen.findByRole('region', { name: 'WP-1 제목 1' })
  const heading = within(region).getByRole('heading', { level: 2 })
  expect(heading.textContent).toBe('WP-1 제목 1')
})

it('runs_selectMissingRun_noOpenedStatus', async () => {
  const { user } = setup(() => ({ items: [item(2)], nextCursor: null }))
  await user.click((await screen.findByText(/^WP-2 · /)).closest('button')!)
  expect(await screen.findByText('실행을 찾을 수 없습니다')).toBeVisible()
  expect(screen.getByTestId('run-detail-status')).toHaveTextContent('')
})

// 다른 워크플로우의 실행이면 상세가 그 안내를 보이니 「열었습니다」를 알리지 않는다(WP-2053 최종 리뷰).
it('runs_selectOtherWorkflowRun_noOpenedStatus', async () => {
  const { user } = setup(() => ({ items: [item(3)], nextCursor: null }))
  const body = runDetailBody()
  server.use(http.get(base + '/workflow-runs/3', () => HttpResponse.json({ ...body, run: { ...body.run, runId: 3, workflowId: 99, issueKey: 'WP-3' } })))
  await user.click((await screen.findByText(/^WP-3 · /)).closest('button')!)
  expect(await screen.findByText('이 실행은 다른 워크플로우의 실행입니다')).toBeVisible()
  expect(screen.getByTestId('run-detail-status')).toHaveTextContent('')
})

it('runs_graphView_showsCountsBadges', async () => {
  const { user, location } = setup()
  await screen.findByText(/^WP-1 · /)
  await user.click(screen.getByRole('button', { name: '그래프에 모아 보기' }))
  expect(await screen.findByText('진행 중 2')).toBeVisible()
  expect(location()).toContain('runsView=graph')
  expect(screen.queryByText(/옛 버전 실행/)).not.toBeInTheDocument()
})

it('runs_graphView_olderVersionRuns_showsNotice', async () => {
  const { user, location } = setup(undefined, { olderNotice: '옛 버전 실행 2개는 이 그래프에 표시하지 않습니다 (v1 2개) — 게시 버전 v2의 실행만 단계에 셉니다.', search: '&runsView=graph' })
  const notice = await screen.findByRole('note')
  // 안내는 그래프를 가리지 않는다 — 게시 버전 배지는 그대로 보인다.
  expect(await screen.findByText('진행 중 2')).toBeVisible()
  expect(notice).toHaveTextContent('옛 버전 실행 2개는 이 그래프에 표시하지 않습니다 (v1 2개) — 게시 버전 v2의 실행만 단계에 셉니다.')
  await user.click(within(notice).getByRole('button', { name: '목록에서 보기' }))
  await waitFor(() => expect(location()).not.toContain('runsView'))
})

it('graphView_versionsUnknown_noNotice', async () => {
  setup(undefined, { search: '&runsView=graph' })
  expect(await screen.findByText('진행 중 2')).toBeVisible()
  expect(screen.queryByText(/옛 버전 실행/)).not.toBeInTheDocument()
})

it('runDetail_404_showsNotFound_keepsList', async () => {
  const screenRun = setup()
  server.use(http.get(base + '/workflow-runs/999', () => HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 })))
  window.history.replaceState(null, '', '/projects/WP/workflow?view=runs&run=999')
  window.dispatchEvent(new PopStateEvent('popstate'))
  expect(await screen.findByText('실행을 찾을 수 없습니다')).toBeVisible()
  expect(screen.getByText(/^WP-1 · /)).toBeVisible()
  void screenRun
})

it('runs_graphView_noPublishedVersion_saysSo', async () => {
  setup(undefined, { activeVersionNo: null, search: '&runsView=graph' })
  expect(await screen.findByText('게시된 버전이 없습니다')).toBeVisible()
  expect(screen.queryByText('게시 버전을 불러오는 중…')).not.toBeInTheDocument()
})

it('runs_graphView_versionFails_showsErrorWithRetry', async () => {
  setup(undefined, { search: '&runsView=graph', versionFails: true })
  expect(await screen.findByText(/게시 버전을 불러오지 못했습니다/, undefined, { timeout: 10000 })).toBeVisible()
  expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeVisible()
  expect(screen.queryByText('게시 버전을 불러오는 중…')).not.toBeInTheDocument()
})
