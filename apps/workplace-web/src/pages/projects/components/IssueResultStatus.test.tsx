// IssueResultStatus 화면 테스트(WP-1777) — 조건이 바뀐 뒤에만 총계를 요청해 스크린리더용 live region 에 건수를 알린다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { parseFilters } from '@/lib/issueFilters'
import { renderScreen } from '@/test/renderScreen'

import { IssueResultStatus } from './IssueResultStatus'

/** 검색어·정렬·프로젝트를 상태로 바꾸는 작은 감싸개 — 실제 페이지가 URL 파라미터로 filters 를 바꾸고 key={projectKey} 로 다시 마운트하는 것을 흉내낸다. */
function Harness() {
  const [params, setParams] = useState('')
  const [project, setProject] = useState('WP')
  return (
    <>
      <button onClick={() => { setProject('OTHER'); setParams('q=c') }}>프로젝트 전환</button>
      <button onClick={() => setParams('q=a')}>검색 a</button>
      <button onClick={() => setParams('q=b')}>검색 b</button>
      <button onClick={() => setParams('sort=priority&direction=desc')}>정렬</button>
      <button onClick={() => setParams('closedLast=off')}>끝난 이슈 아래로 끔</button>
      <IssueResultStatus key={project} projectKey={project} filters={parseFilters(new URLSearchParams(params))} />
    </>
  )
}

/** 프로젝트의 group-counts 를 q 별 건수로 답하는 핸들러('error' 면 500, 없는 q 는 0건). 요청 수는 calls 에 쌓는다. */
function setup(counts: Record<string, number | 'error'>, projectKey = 'WP') {
  const calls: URL[] = []
  const handler = http.get(`*/api/v1/projects/${projectKey}/issues/group-counts`, ({ request }) => {
    const url = new URL(request.url)
    calls.push(url)
    const n = counts[url.searchParams.get('q') ?? '']
    if (n === 'error') return new HttpResponse(null, { status: 500 })
    return HttpResponse.json({ groupBy: 'priority', groups: n ? [{ key: 'HIGH', count: n }] : [] })
  })
  return { calls, handler }
}

/** 「일어나지 않음」을 볼 때 잠깐 기다린다 — 요청·채우기 타이머가 돌 시간을 준다. */
const settle = () => new Promise((r) => setTimeout(r, 50))

const region = () => screen.getByTestId('issue-result-status')

describe('IssueResultStatus', () => {
  it('첫 진입은 안내하지 않고 총계를 요청하지 않는다', async () => {
    const { calls, handler } = setup({})
    renderScreen(<Harness />, { path: '/projects/WP', handlers: [handler] })
    expect(region().textContent).toBe('')
    expect(region().getAttribute('role')).toBe('status')
    expect(region().getAttribute('aria-live')).toBe('polite')
    await settle()
    expect(calls).toHaveLength(0)
  })

  it('검색어를 바꾸면 새 총계로 「이슈 N건」을 알린다', async () => {
    const { handler } = setup({ a: 3 })
    const { user } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [handler] })
    await user.click(screen.getByText('검색 a'))
    await waitFor(() => expect(region().textContent).toBe('이슈 3건'))
  })

  it('0건이면 없음 문구', async () => {
    const { handler } = setup({ a: 0 })
    const { user } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [handler] })
    await user.click(screen.getByText('검색 a'))
    await waitFor(() => expect(region().textContent).toBe('조건에 맞는 이슈가 없습니다'))
  })

  it('같은 건수라도 조건이 바뀌면 비웠다가 다시 채운다', async () => {
    const { handler } = setup({ a: 3, b: 3 })
    const { user } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [handler] })
    await user.click(screen.getByText('검색 a'))
    await waitFor(() => expect(region().textContent).toBe('이슈 3건'))
    await user.click(screen.getByText('검색 b'))
    expect(region().textContent).toBe('')
    await waitFor(() => expect(region().textContent).toBe('이슈 3건'))
  })

  it('같은 조건의 재조회로는 바꾸지 않는다', async () => {
    const counts: Record<string, number> = { a: 3 }
    const { calls, handler } = setup(counts)
    const { user, queryClient } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [handler] })
    await user.click(screen.getByText('검색 a'))
    await waitFor(() => expect(region().textContent).toBe('이슈 3건'))
    counts.a = 4
    await queryClient.invalidateQueries({ queryKey: ['issues', 'search', 'WP'] })
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2))
    await settle()
    expect(region().textContent).toBe('이슈 3건')
  })

  it('정렬만 바꾸면 안내하지 않는다', async () => {
    const { calls, handler } = setup({ '': 5 })
    const { user } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [handler] })
    await user.click(screen.getByText('정렬'))
    await settle()
    expect(region().textContent).toBe('')
    expect(calls).toHaveLength(0)
  })

  // WP-2103: 「끝난 이슈 아래로」도 순서만 바꾸므로 건수 안내·총계 요청 조건이 아니다.
  it('끝난 이슈 아래로만 끄면 안내하지 않는다', async () => {
    const { calls, handler } = setup({ '': 5 })
    const { user } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [handler] })
    await user.click(screen.getByText('끝난 이슈 아래로 끔'))
    await settle()
    expect(region().textContent).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('총계 요청 실패면 비운다', async () => {
    const { calls, handler } = setup({ a: 'error' })
    const { user } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [handler] })
    await user.click(screen.getByText('검색 a'))
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1))
    await settle()
    expect(region().textContent).toBe('')
  })

  it('프로젝트를 바꾸면 새 프로젝트 첫 진입으로 보고 안내·요청하지 않는다', async () => {
    const wp = setup({ a: 3 })
    const other = setup({ c: 7, d: 2 }, 'OTHER')
    const { user } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [wp.handler, other.handler] })
    await user.click(screen.getByText('검색 a'))
    await waitFor(() => expect(region().textContent).toBe('이슈 3건'))
    await user.click(screen.getByText('프로젝트 전환'))
    expect(region().textContent).toBe('')
    await settle()
    expect(region().textContent).toBe('')
    expect(other.calls).toHaveLength(0)
  })

  it('프로젝트를 바꾼 뒤 그 프로젝트에서 조건을 바꾸면 정상 안내한다', async () => {
    const wp = setup({ a: 3 })
    const other = setup({ c: 7, b: 2 }, 'OTHER')
    const { user } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [wp.handler, other.handler] })
    await user.click(screen.getByText('프로젝트 전환'))
    await user.click(screen.getByText('검색 b'))
    await waitFor(() => expect(region().textContent).toBe('이슈 2건'))
    expect(other.calls.length).toBeGreaterThanOrEqual(1)
  })
  it('예전에 본 조건으로 돌아오면 캐시의 옛 건수가 아니라 새로 받은 건수를 알린다', async () => {
    const counts: Record<string, number | 'error'> = { a: 3, b: 1 }
    const wp = setup(counts)
    const { user, queryClient } = renderScreen(<Harness />, { path: '/projects/WP', handlers: [wp.handler] })
    await user.click(screen.getByText('검색 a'))
    await waitFor(() => expect(region().textContent).toBe('이슈 3건'))
    await user.click(screen.getByText('검색 b'))
    await waitFor(() => expect(region().textContent).toBe('이슈 1건'))
    // 그 사이 다른 사람이 이슈를 더해 a 의 건수가 바뀌었고, 캐시는 오래돼(staleTime 지남) 돌아오면 다시 받는다 — 다시 받지는 않고 오래됨만 표시한다.
    counts.a = 5
    await queryClient.invalidateQueries({ queryKey: ['issues', 'search', 'WP'], refetchType: 'none' })
    await user.click(screen.getByText('검색 a'))
    await waitFor(() => expect(region().textContent).toBe('이슈 5건'))
  })
})
