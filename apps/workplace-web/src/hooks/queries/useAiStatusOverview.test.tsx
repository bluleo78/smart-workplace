// useAiStatusOverview(WP-1824) — 「AI 현황 › 개요」 데이터 계층: 기간이 곧 period 파라미터로 이어지고 요청 주소가
// /api/v1/admin/ai-status/overview 인지 네트워크 계층(MSW)에서 본다 — 훅을 목으로 끊지 않고 실제 api 경로를 지나게 한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'

import type { AiStatusPeriod } from '@/api/aiStatus'
import { server } from '@/test/msw/server'

import { useAiStatusOverview } from './useAiStatusOverview'

/** 개요 응답 최소 픽스처 — 기간·구간 크기·지표 runCount·종류·경고만 갖추면 이 테스트가 단언하는 값은 모두 나온다. */
const OVERVIEW = {
  period: '24h',
  bucketSeconds: 900,
  from: '2026-11-21T22:00:00Z',
  to: '2026-11-22T22:00:00Z',
  generatedAt: '2026-11-22T22:00:05Z',
  metrics: { runCount: { current: 12, previous: 8 } },
  kinds: [{ kind: 'MAIL', count: 5 }],
  alerts: [{ code: 'KIND_FAILURE', severity: 'WARNING', kind: 'MAIL', accountId: null, label: null, value: 0.5, threshold: 0.2 }],
}

/** 개요 조회를 MSW 로 받으며 훅을 띄운다 — 나간 요청 주소를 모아 파라미터를 단언한다(helpMetrics.test.tsx 의 metricsApi 패턴). */
function renderOverview(initial: AiStatusPeriod) {
  const urls: URL[] = []
  server.use(
    http.get('/api/v1/admin/ai-status/overview', ({ request }) => {
      urls.push(new URL(request.url))
      return HttpResponse.json(OVERVIEW)
    }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const view = renderHook(({ period }: { period: AiStatusPeriod }) => useAiStatusOverview(period), {
    wrapper,
    initialProps: { period: initial },
  })
  return { ...view, last: () => urls.at(-1) }
}

test('기간 24h 로 overview 를 period=24h 로 부른다', async () => {
  const { result, last } = renderOverview('24h')
  await waitFor(() => expect(result.current.data?.bucketSeconds).toBe(900))
  expect(last()?.searchParams.get('period')).toBe('24h')
  expect(result.current.data?.metrics.runCount.current).toBe(12)
})

test('기간을 7d 로 바꾸면 period=7d 로 다시 부른다', async () => {
  const { result, rerender, last } = renderOverview('24h')
  await waitFor(() => expect(result.current.data?.metrics.runCount.current).toBe(12))
  rerender({ period: '7d' })
  await waitFor(() => expect(last()?.searchParams.get('period')).toBe('7d'))
})

test('요청 주소는 /api/v1/admin/ai-status/overview 다', async () => {
  const { result, last } = renderOverview('24h')
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(last()?.pathname).toBe('/api/v1/admin/ai-status/overview')
})