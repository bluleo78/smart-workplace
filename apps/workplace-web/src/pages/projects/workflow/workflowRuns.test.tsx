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

/** 요청 URL 을 모으며 응답하는 공통 핸들러. */
function setup(
  respond: (url: URL) => object = () => ({ items: [item(1)], nextCursor: null }),
  opts: { activeVersionNo?: number | null; search?: string; versionFails?: boolean; olderNotice?: string | null } = {},
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
        http.get(base + '/workflow-runs/:id', () => HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 })),
        http.get(base + '/workflows/42/run-counts', () => HttpResponse.json({ counts: { b: 2 } })),
      ],
    },
  )
  return { ...screenRun, urls }
}

it('runs_filterByStatusNodeAssignee', async () => {
  const { user, urls } = setup((url) => (url.searchParams.has('status') || url.searchParams.has('node') || url.searchParams.has('assigneeId')
    ? { items: [], nextCursor: null } : { items: [item(1, { status: 'SUSPENDED' })], nextCursor: null }))
  // 줄 셀 단위 — 칩 문구·이슈 키·노드 이름·담당 이름.
  const row = (await screen.findByText('WP-1')).closest('li')!
  expect(within(row).getByText('조치 필요')).toBeVisible()
  expect(within(row).getByText('검토')).toBeVisible()
  expect(within(row).getByText('김')).toBeVisible()

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

it('runs_noFilterNoRuns_showsEmptyMessage', async () => {
  setup(() => ({ items: [], nextCursor: null }))
  expect(await screen.findByText('아직 실행이 없습니다')).toBeVisible()
})

it('runs_nextPage_appendsWithCursor', async () => {
  const { user, urls } = setup((url) => (url.searchParams.get('cursor') === 'c1'
    ? { items: [item(2)], nextCursor: null } : { items: [item(1)], nextCursor: 'c1' }))
  await screen.findByText('WP-1')
  await user.click(screen.getByRole('button', { name: '더 보기' }))
  expect(await screen.findByText('WP-2')).toBeVisible()
  expect(screen.getByText('WP-1')).toBeVisible()
  expect(urls.at(-1)!.searchParams.get('cursor')).toBe('c1')
})

it('runs_selectRow_setsRunParam', async () => {
  const { user, location } = setup()
  await user.click((await screen.findByText('WP-1')).closest('button')!)
  await waitFor(() => expect(location()).toContain('run=1'))
  expect(location()).toContain('view=runs')
  window.history.back()
  await waitFor(() => expect(location()).not.toContain('run='))
})

it('runs_graphView_showsCountsBadges', async () => {
  const { user, location } = setup()
  await screen.findByText('WP-1')
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
  expect(screen.getByText('WP-1')).toBeVisible()
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
