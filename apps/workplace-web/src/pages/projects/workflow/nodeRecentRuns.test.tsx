// 노드 서랍 「최근 실행」 — node 필터로 묻는지, 5건 제한·링크·빈 상태·탭 열기 전 무요청(WP-2091).
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, it } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { NodeRecentRuns } from './NodeRecentRuns'

const base = '/api/v1'
const item = (runId: number) => ({
  runId, issueId: runId * 10, issueNumber: runId * 10, issueKey: 'WP-' + runId, title: '제목 ' + runId, status: 'WAITING', currentNode: 'b',
  currentNodeName: '검토', assignees: [], enteredAt: new Date(Date.now() - 3600_000).toISOString(), startedAt: '2026-11-20T00:00:00Z', versionNo: 2,
})

function setup(items: object[], enabled = true, path = '/projects/WP/workflow') {
  const urls: URL[] = []
  const view = renderScreen(<NodeRecentRuns workflowId={42} nodeKey="b" enabled={enabled} />, {
    path,
    handlers: [
      http.get(base + '/workflows/42/runs', ({ request }) => {
        urls.push(new URL(request.url))
        return HttpResponse.json({ items, nextCursor: null })
      }),
    ],
  })
  return { ...view, urls }
}

it('nodeRecentRuns_listsFiveWithLink', async () => {
  const { urls } = setup([1, 2, 3, 4, 5, 6].map(item))
  expect(await screen.findByText('WP-1')).toBeVisible()
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  expect(screen.queryByText('WP-6')).toBeNull()
  expect(screen.getByText('WP-1').closest('a')!.getAttribute('href')).toContain('view=runs&run=1')
  expect(screen.getByText('실행 목록에서 모두 보기')).toBeVisible()
  expect(screen.getAllByText('사람 차례')).toHaveLength(5)
  expect(urls[0].searchParams.get('node')).toBe('b')
})

// WP-2091 최종 리뷰 — 링크가 지금 주소의 다른 검색 파라미터(?workflow=)를 지킨다: 잃으면 첫 정의로 넘어간다
it('nodeRecentRuns_links_keepWorkflowParam', async () => {
  setup([1, 2, 3, 4, 5, 6].map(item), true, '/projects/WP/workflow?workflow=7&view=graph&run=99')
  expect(await screen.findByText('WP-1')).toBeVisible()
  const row = new URL(screen.getByText('WP-1').closest('a')!.getAttribute('href')!, 'http://x')
  expect(row.searchParams.get('workflow')).toBe('7')
  expect(row.searchParams.get('view')).toBe('runs')
  expect(row.searchParams.get('run')).toBe('1')
  const all = new URL(screen.getByText('실행 목록에서 모두 보기').getAttribute('href')!, 'http://x')
  expect(all.searchParams.get('workflow')).toBe('7')
  expect(all.searchParams.get('view')).toBe('runs')
  expect(all.searchParams.has('run')).toBe(false)
})

it('nodeRecentRuns_empty', async () => {
  setup([])
  expect(await screen.findByText('이 노드에 머문 실행이 없습니다')).toBeVisible()
  expect(screen.queryByText('실행 목록에서 모두 보기')).toBeNull()
})

it('nodeRecentRuns_notFetchedUntilTabOpen', async () => {
  const { urls } = setup([item(1)], false)
  expect(await screen.findByText('불러오는 중…')).toBeVisible()
  // 「요청이 없다」는 부재 확인이라 일이 일어날 틈이 필요하다 — 고정 대기 100ms 는 첫 조회가 나갔다면 충분히 잡히는 길이(조건이 없어 폴링 불가)
  await new Promise((r) => setTimeout(r, 100))
  expect(urls).toHaveLength(0)
})

it('nodeRecentRuns_error_retry', async () => {
  let fail = true
  const { user } = renderScreen(<NodeRecentRuns workflowId={42} nodeKey="b" enabled />, {
    handlers: [http.get(base + '/workflows/42/runs', () => (fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ items: [item(1)], nextCursor: null })))],
  })
  const retry = await screen.findByRole('button', { name: '다시 시도' })
  fail = false
  await user.click(retry)
  expect(await screen.findByText('WP-1')).toBeVisible()
})
