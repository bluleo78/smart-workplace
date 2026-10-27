// 그룹 보드 순차 로드(WP-996) — 페이지 테스트(WP-971).
// 그룹(담당자) 보드는 마지막 페이지까지 하나씩 이어 받는다. 예전엔 다음 요청을 「로딩 표시가 true → false 로 바뀜」으로만 다시 정해,
// 응답이 한 번 그리는 사이에 오면(즉시 응답하는 MSW·캐시·빠른 로컬 서버) true 가 그려지지 않아 3페이지부터 멈췄다.
// 응답을 늦추지 않고(MSW 즉시 응답) 마지막 페이지까지 받는지 본다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { BASE, KEY, versionApi } from '@/test/msw/versionHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'

/** 커서마다 이슈 하나씩 — 늦추지 않고 바로 답한다. 받은 커서를 cursors 에 쌓는다. */
function pagedIssues(count: number) {
  const cursors: (string | null)[] = []
  const handler = http.get(`${BASE}/issues`, ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor')
    cursors.push(cursor)
    const idx = cursor ? Number(cursor) : 0
    const next = idx + 1 < count ? String(idx + 1) : null
    const n = idx + 1
    return HttpResponse.json(createIssueSearchResponse([createIssue({ id: n, number: n, title: `P${n}`, status: 'TODO' })], next))
  })
  return { handler, cursors }
}

describe('그룹 보드 — 마지막 페이지까지 순차 로드 (WP-996)', () => {
  test('응답을 늦추지 않아도 3페이지 이후까지 모두 받아 그린다', async () => {
    const paged = pagedIssues(5)
    // 이슈 검색 핸들러를 앞에 둬 versionApi 의 기본(한 페이지) 응답보다 먼저 받게 한다.
    renderPage(`/projects/${KEY}?view=board&group=assignee`, { handlers: [paged.handler, ...versionApi().handlers] })
    await screen.findByTestId('issue-card-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
    // 남은 4페이지를 차례로 받는다 — 부하가 큰 전체 실행에서도 기본 1초에 걸리지 않게 첫 로딩과 같은 여유를 준다.
    await waitFor(() => expect(screen.getByTestId('issue-card-5')).toBeInTheDocument(), { timeout: PAGE_LOAD_TIMEOUT })
    // 첫 페이지는 화면 준비 중 한 번 더 조회될 수 있어, 받은 커서 종류로 본다.
    expect([...new Set(paged.cursors)]).toEqual([null, '1', '2', '3', '4'])
    await waitFor(() => expect(screen.queryByTestId('board-loading-more')).not.toBeInTheDocument())
  })
})
