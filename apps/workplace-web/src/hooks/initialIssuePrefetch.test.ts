// @vitest-environment jsdom
// startInitialIssuePrefetch — 문서당 한 번, 이슈 상세 주소에서만, 관찰자 없이 실패하면 캐시를 지운다 (WP-2087).
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetInitialIssuePrefetchForTest, startInitialIssuePrefetch } from './useInitialIssuePrefetch'

const fetcher = vi.fn()
vi.mock('./queries/useIssue', () => ({
  issueDetailQuery: (projectKey: string, number: number) => ({
    queryKey: ['issue-test', projectKey, number],
    queryFn: () => fetcher(projectKey, number),
    retry: false,
  }),
}))

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  resetInitialIssuePrefetchForTest()
  fetcher.mockReset()
  window.history.pushState({}, '', '/')
})

describe('startInitialIssuePrefetch', () => {
  it('startInitialIssuePrefetch_requestsOnceForDetailPath', async () => {
    window.history.pushState({}, '', '/projects/WP/issues/7')
    fetcher.mockResolvedValue({ ok: true })
    const client = newClient()
    startInitialIssuePrefetch(client)
    startInitialIssuePrefetch(client)
    await vi.waitFor(() => expect(client.getQueryData(['issue-test', 'WP', 7])).toEqual({ ok: true }))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('startInitialIssuePrefetch_noopOffDetailPath', () => {
    window.history.pushState({}, '', '/projects/WP')
    startInitialIssuePrefetch(newClient())
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('startInitialIssuePrefetch_laterCallOnDetailPathStillFetchesOnce', async () => {
    fetcher.mockResolvedValue({ ok: true })
    const client = newClient()
    window.history.pushState({}, '', '/login')
    startInitialIssuePrefetch(client)
    expect(fetcher).not.toHaveBeenCalled()
    window.history.pushState({}, '', '/projects/WP/issues/7')
    startInitialIssuePrefetch(client)
    startInitialIssuePrefetch(client)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  })

  it('startInitialIssuePrefetch_removesUnobservedErrorCache', async () => {
    window.history.pushState({}, '', '/projects/WP/issues/7')
    fetcher.mockRejectedValue(new Error('500'))
    const client = newClient()
    startInitialIssuePrefetch(client)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(client.getQueryState(['issue-test', 'WP', 7])).toBeUndefined())
  })
})
