// useIssueRecurrence(WP-1114) — 작업 완료·취소·AI 담당 해제는 이슈 상세를 무효화한다. 서버가 그때 반복을 거두므로, 반복 캐시가 이슈 상세 키
// 아래에 있어 함께 다시 받아져 「다음 실행 …」이 남지 않는지 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { server } from '@/test/msw/server'

import { useIssueRecurrence } from './useIssueRecurrence'
import { issueKeys } from './useIssues'

describe('useIssueRecurrence', () => {
  it('이슈 상세를 무효화하면 반복도 다시 받는다 — 완료 뒤 서버가 거둔 반복이 사라진다', async () => {
    let retired = false
    server.use(
      http.get('/api/v1/projects/P1/issues/3/recurrence', () =>
        retired
          ? new HttpResponse(null, { status: 204 })
          : HttpResponse.json({
              rrule: 'FREQ=DAILY',
              time: '09:00',
              enabled: true,
              nextRunAt: '2026-10-29T00:00:00Z',
              consecutiveFailures: 0,
              lastRunAt: null,
              agentUserId: 9,
              agentName: '비서',
            }),
      ),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useIssueRecurrence('P1', 3), { wrapper })
    await waitFor(() => expect(result.current.data?.nextRunAt).toBe('2026-10-29T00:00:00Z'))

    // 작업을 완료하면 서버가 반복을 거두고, 화면은 상태 변경 뒤 이슈 상세를 무효화한다.
    retired = true
    await act(() => client.invalidateQueries({ queryKey: issueKeys.detail('P1', 3) }))
    await waitFor(() => expect(result.current.data).toBeNull())
  })
})
