// 첫 주소가 이슈 상세일 때 셸이 상세 데이터를 미리 요청하는지(WP-2074).
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { act, lazy, Suspense, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { DriveUploadProvider } from '@/components/drive/upload/DriveUploadProvider'
import { AppLayout } from '@/components/layout/AppLayout'
import { useIssue } from '@/hooks/queries/useIssue'
import { issueKeys } from '@/hooks/queries/useIssues'
import { resetInitialIssuePrefetchForTest, startInitialIssuePrefetch } from '@/hooks/useInitialIssuePrefetch'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

// 끝나지 않는 lazy 페이지 — 페이지 청크가 걸린 상태.
const Never = lazy(() => new Promise<never>(() => {}))

// 오류 화면을 한 번이라도 화면에 올렸는지 — 잠깐 비쳤다 사라지는 오류도 잡는다(커밋되면 effect 가 돈다).
let sawError = false

function ErrorView() {
  // 렌더 중에 바깥 변수를 바꾸지 않도록 커밋 뒤에 적는다.
  useEffect(() => {
    sawError = true
  }, [])
  return <div>load-error</div>
}

// 실제 상세 페이지 대신 useIssue 로 제목만 보여 주는 작은 페이지.
function TitlePage() {
  const { data, isError } = useIssue('WP', 7)
  if (isError) return <ErrorView />
  return <div>{data?.summary.title ?? 'loading'}</div>
}

// 페이지가 미리 요청이 끝난 뒤에 그려지는 실제 순서를 흉내 낸다 — showPage() 를 부르기 전까지는 청크가 걸린 것처럼 아무것도 그리지 않는다.
let showPage: () => void = () => {}
function LatePage() {
  const [ready, setReady] = useState(false)
  // 렌더 중에 바깥 변수를 바꾸지 않도록 마운트 뒤에 연결한다.
  useEffect(() => {
    showPage = () => setReady(true)
  }, [])
  return ready ? <TitlePage /> : null
}

function shell(Page: React.ComponentType) {
  return (
    <DriveUploadProvider>
      <Suspense fallback={<div>outer-fallback</div>}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="*" element={<Page />} />
          </Route>
        </Routes>
      </Suspense>
    </DriveUploadProvider>
  )
}

const detail = createIssueDetail({ summary: createIssue({ projectKey: 'WP', number: 7, title: '미리 받은 이슈' }) })

// 상세 조회 핸들러와 요청 수 — statuses 의 n 번째 값이 n 번째 요청의 실패 상태다(없거나 다 쓰면 성공). waitMs 만큼 늦게 답한다.
function detailApi(statuses: number[] = [], waitMs = 0) {
  const counter = { calls: 0 }
  const handlers = [
    http.get('/api/v1/projects/WP/issues/7', async () => {
      const status = statuses[counter.calls]
      counter.calls += 1
      if (waitMs) await delay(waitMs)
      return status ? new HttpResponse(null, { status }) : HttpResponse.json(detail)
    }),
    ...shellHandlers,
  ]
  return { counter, handlers }
}

// 미리 요청이 끝나 응답(또는 오류)이 캐시에 들어갈 틈을 준 뒤 페이지를 그린다.
async function showPageAfterPrefetch() {
  await new Promise(r => setTimeout(r, 50))
  act(() => showPage())
}

describe('AppLayout 이슈 상세 미리 요청 (WP-2074)', () => {
  beforeEach(() => {
    resetInitialIssuePrefetchForTest()
    sawError = false
  })

  it('첫 주소가 이슈 상세면 페이지 청크를 기다리지 않고 상세를 한 번 요청한다', async () => {
    const { counter, handlers } = detailApi()
    renderScreen(shell(Never), { path: '/projects/WP/issues/7', handlers })
    await waitFor(() => expect(counter.calls).toBe(1))
  })

  it('appLayout_skipsPrefetchWhenAlreadyStarted', async () => {
    // 토큰 직후 경로(AuthContext)가 이미 요청했다면 셸 훅은 다시 요청하지 않는다 — 같은 주소에서 먼저 한 번 부른 뒤 셸을 띄운다.
    const { counter, handlers } = detailApi()
    window.history.pushState({}, '', '/projects/WP/issues/7')
    startInitialIssuePrefetch(new QueryClient())
    renderScreen(shell(Never), { path: '/projects/WP/issues/7', handlers })
    expect((await screen.findAllByRole('navigation')).length).toBeGreaterThan(0)
    await new Promise(r => setTimeout(r, 50))
    expect(counter.calls).toBe(1)
  })

  it('셸이 다시 마운트돼도 다시 요청하지 않는다', async () => {
    const { counter, handlers } = detailApi()
    const opts = { path: '/projects/WP/issues/7', handlers }
    const first = renderScreen(shell(Never), opts)
    await waitFor(() => expect(counter.calls).toBe(1))
    first.unmount()
    renderScreen(shell(Never), opts)
    await new Promise(r => setTimeout(r, 50))
    expect(counter.calls).toBe(1)
  })

  it('이슈 상세가 아닌 주소는 요청하지 않는다', async () => {
    const { counter, handlers } = detailApi()
    renderScreen(shell(Never), { path: '/projects/WP', handlers })
    expect((await screen.findAllByRole('navigation')).length).toBeGreaterThan(0)
    await new Promise(r => setTimeout(r, 50))
    expect(counter.calls).toBe(0)
  })

  it('미리 요청이 끝난 뒤 페이지가 useIssue 로 그려져도 다시 요청하지 않는다', async () => {
    const { counter, handlers } = detailApi()
    renderScreen(shell(LatePage), { path: '/projects/WP/issues/7', handlers })
    await waitFor(() => expect(counter.calls).toBe(1))
    // staleTime 안이라 페이지는 다시 요청하지 않고 캐시를 쓴다.
    await showPageAfterPrefetch()
    expect(await screen.findByText('미리 받은 이슈')).toBeTruthy()
    expect(counter.calls).toBe(1)
  })

  it('미리 요청이 실패로 끝난 뒤 페이지가 그려지면 오류 화면을 먼저 비추지 않고 새로 요청한다', async () => {
    const { counter, handlers } = detailApi([500])
    const { queryClient } = renderScreen(shell(LatePage), { path: '/projects/WP/issues/7', handlers })
    await waitFor(() => expect(counter.calls).toBe(1))
    // 미리 요청이 실패로 끝나면(테스트 QueryClient 는 재시도 끔) 아무도 보기 전이라 실패 캐시가 지워진다.
    await waitFor(() => expect(queryClient.getQueryState(issueKeys.detail('WP', 7))).toBeUndefined())
    await showPageAfterPrefetch()
    expect(await screen.findByText('미리 받은 이슈')).toBeTruthy()
    expect(counter.calls).toBe(2)
    expect(sawError).toBe(false)
  })

  it('페이지가 진행 중인 미리 요청에 붙어도 일시 5xx 는 전역 정책대로 재시도한다', async () => {
    // 첫 요청은 늦게 500 — 그 사이 페이지(청크)가 먼저 와서 진행 중인 미리 요청에 붙는다.
    const { counter, handlers } = detailApi([500], 150)
    renderScreen(shell(LatePage), { path: '/projects/WP/issues/7', handlers, queryRetry: 1 })
    await waitFor(() => expect(counter.calls).toBe(1))
    act(() => showPage())
    expect(await screen.findByText('미리 받은 이슈')).toBeTruthy()
    expect(counter.calls).toBe(2)
    expect(sawError).toBe(false)
  })

  it('없는 이슈(404)는 페이지가 오류 화면을 낸다', async () => {
    const { handlers } = detailApi([404, 404])
    renderScreen(shell(LatePage), { path: '/projects/WP/issues/7', handlers })
    await showPageAfterPrefetch()
    expect(await screen.findByText('load-error')).toBeTruthy()
  })
})
