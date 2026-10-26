// 서버 측(AI Chat 등) 이슈 생성·수정·삭제가 열린 화면에 새로고침 없이 반영되는지(WP-36/WP-59) — 페이지 테스트(WP-980).
// 통합 SSE(/api/v1/events)는 fetch 스트림이라 MSW 로 열린 스트림을 주고 resource.changed 프레임을 첫 렌더 뒤에 밀어 넣는다.
// 실제 서버 없이 프레임 → 캐시 무효화 → 재조회 → 행 변화만 보므로 e2e/pages/projects/resource-changed-realtime.spec.ts 에서 옮겼다(그 spec 은 지웠다).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { controllableEvents, resourceChangedFrame } from '@/test/kits/projects/issueDetailEvents'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueResponse } from '@/types/issue'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

/** 목록·상세 목 + 열린 SSE. release() 가 서버 상태를 바꾸고 resource.changed 를 보낸다(ids 는 이슈 DB id). */
function setup(initial: IssueResponse[]) {
  const state = { issues: initial, detailGone: false }
  const events = controllableEvents()
  const handlers = [
    events.handler,
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
    http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse(state.issues, null))),
    // 브라우저가 직접 쓰기 요청을 보내면 안 되는 시나리오 — 오면 404 로 드러난다.
    http.post(`/api/v1/projects/${KEY}/issues`, () => new HttpResponse(null, { status: 404 })),
    http.get(`/api/v1/projects/${KEY}/issues/:n`, ({ params }) => {
      const found = state.issues.find((i) => i.number === Number(params.n))
      if (state.detailGone || !found) return HttpResponse.json({ message: 'not found' }, { status: 404 })
      return HttpResponse.json(createIssueDetail({ summary: found }))
    }),
    ...['watchers', 'labels', 'attachments'].map((sub) => http.get(`/api/v1/projects/${KEY}/issues/:n/${sub}`, () => HttpResponse.json([]))),
  ]
  const release = async (next: IssueResponse[], op: string, issue: IssueResponse, { gone = false } = {}) => {
    state.issues = next
    state.detailGone = gone
    await events.push(
      resourceChangedFrame({ resource: 'issue', op, scopeType: 'PROJECT', scopeId: 1, ids: [issue.id], actorId: 99, projectKey: KEY, issueNumber: issue.number }),
    )
  }
  return { handlers, release }
}

describe('이슈 변경 실시간 반영 (WP-59)', () => {
  test('생성 — 새 행이 나타난다', async () => {
    const a = createIssue({ id: 1, number: 7, title: '기존 이슈' })
    const b = createIssue({ id: 2, number: 8, title: 'AI Chat 에서 만든 이슈' })
    const { handlers, release } = setup([a])
    renderPage(`/projects/${KEY}`, { handlers })
    await screen.findByTestId('issue-row-7', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('issue-row-8')).not.toBeInTheDocument()
    await release([b, a], 'created', b)
    expect(await screen.findByTestId('issue-row-8')).toHaveTextContent('AI Chat 에서 만든 이슈')
  })

  test('수정 — 행 제목이 바뀐다', async () => {
    const a = createIssue({ id: 1, number: 7, title: '수정 전 제목' })
    const { handlers, release } = setup([a])
    renderPage(`/projects/${KEY}`, { handlers })
    expect(await screen.findByTestId('issue-row-7', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('수정 전 제목')
    await release([{ ...a, title: 'AI 가 고친 제목' }], 'updated', a)
    await waitFor(() => expect(screen.getByTestId('issue-row-7')).toHaveTextContent('AI 가 고친 제목'))
  })

  test('삭제 — 행이 사라진다', async () => {
    const a = createIssue({ id: 1, number: 7, title: '남는 이슈' })
    const b = createIssue({ id: 2, number: 8, title: '지워질 이슈' })
    const { handlers, release } = setup([a, b])
    renderPage(`/projects/${KEY}`, { handlers })
    await screen.findByTestId('issue-row-8', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await release([a], 'deleted', b)
    await waitFor(() => expect(screen.queryByTestId('issue-row-8')).not.toBeInTheDocument())
    expect(screen.getByTestId('issue-row-7')).toBeInTheDocument()
  })

  // 원격 삭제 뒤 상세 GET 은 404 — 재조회가 실패해도 TanStack Query 가 마지막 data 를 쥐고 있어 stale 제목이 남던 회귀.
  test('삭제 — 열려 있던 상세는 stale 이슈 대신 not-found 상태로 바뀐다', async () => {
    const a = createIssue({ id: 1, number: 7, title: '곧 삭제될 이슈' })
    const { handlers, release } = setup([a])
    renderPage(`/projects/${KEY}/issues/7`, { handlers })
    await screen.findAllByText('곧 삭제될 이슈', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await release([], 'deleted', a, { gone: true })
    expect(await screen.findByText('이슈를 찾을 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByText('곧 삭제될 이슈')).not.toBeInTheDocument()
  })
})
