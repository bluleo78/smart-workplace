// 이슈 생성·삭제 mutation 의 캐시 무효화(WP-1652) — 개요 화면에 머문 채 만들거나 지워도
// 같은 프로젝트의 개요(열린 이슈 수·활동)가 다시 불리도록 개요 캐시를 무효화하는지 확인한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { issuesApi } from '../../api/issues'
import { fetchProjectOverview } from '../../api/projectOverview'
import type { CreateIssueRequest } from '../../types/issue'
import { invalidateIssueCaches } from './useBulkIssueActions'
import { useRemoveIssue } from './useIssueRowMutations'
import { issueKeys, useCreateIssue, useDeleteIssue } from './useIssues'
import { projectOverviewKey, useProjectOverview } from './useProjectOverview'

vi.mock('../../api/issues', () => ({
  issuesApi: {
    create: vi.fn(),
    remove: vi.fn(),
  },
  updateIssueStatus: vi.fn(),
}))

vi.mock('../../api/projectOverview', () => ({ fetchProjectOverview: vi.fn() }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/** 개요·검색 캐시를 미리 넣어 둔 QueryClient 와 그 Provider wrapper 를 만든다. */
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(projectOverviewKey('P'), { openIssues: 1 })
  qc.setQueryData(projectOverviewKey('Q'), { openIssues: 2 })
  qc.setQueryData(issueKeys.search('P'), { pages: [] })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const isInvalidated = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

describe('useCreateIssue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공하면 같은 프로젝트의 개요와 검색 캐시를 무효화한다', async () => {
    vi.mocked(issuesApi.create).mockResolvedValue({ data: { number: 1 } } as never)
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useCreateIssue('P'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ title: 't' } as CreateIssueRequest)
    })

    expect(isInvalidated(qc, projectOverviewKey('P'))).toBe(true)
    expect(isInvalidated(qc, issueKeys.search('P'))).toBe(true)
  })

  it('다른 프로젝트의 개요는 무효화하지 않는다', async () => {
    vi.mocked(issuesApi.create).mockResolvedValue({ data: { number: 1 } } as never)
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useCreateIssue('P'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ title: 't' } as CreateIssueRequest)
    })

    expect(isInvalidated(qc, projectOverviewKey('Q'))).toBe(false)
  })

  it('생성이 실패하면 개요를 무효화하지 않는다', async () => {
    vi.mocked(issuesApi.create).mockRejectedValue(new Error('boom'))
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useCreateIssue('P'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ title: 't' } as CreateIssueRequest).catch(() => undefined)
    })

    expect(isInvalidated(qc, projectOverviewKey('P'))).toBe(false)
  })
})

describe('useDeleteIssue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공하면 같은 프로젝트의 개요를 무효화한다', async () => {
    vi.mocked(issuesApi.remove).mockResolvedValue({ data: undefined } as never)
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useDeleteIssue('P', 1), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(isInvalidated(qc, projectOverviewKey('P'))).toBe(true)
    expect(isInvalidated(qc, projectOverviewKey('Q'))).toBe(false)
  })

  // WP-2036: 지운 이슈의 상세를 무효화하면 닫히기 전에 다시 가져와 헛 GET(404)이 난다 — 캐시를 지운다.
  it('성공하면 지운 이슈의 상세 캐시를 무효화가 아니라 제거한다', async () => {
    vi.mocked(issuesApi.remove).mockResolvedValue({ data: undefined } as never)
    const { qc, wrapper } = setup()
    const detailKey = issueKeys.detail('P', 1)
    qc.setQueryData(detailKey, { id: 1 })
    const { result } = renderHook(() => useDeleteIssue('P', 1), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(qc.getQueryState(detailKey)).toBeUndefined()
  })
})

describe('개요 화면이 열려 있을 때(WP-1652)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('이슈를 만들면 보고 있는 개요를 다시 불러온다', async () => {
    vi.mocked(fetchProjectOverview).mockResolvedValue({ openIssues: 1 } as never)
    vi.mocked(issuesApi.create).mockResolvedValue({ data: { number: 1 } } as never)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    // 개요 구독자와 생성 mutation 을 한 화면에 함께 둔다 — 개요 탭에 머문 채 「+ 새 태스크」를 누르는 상황.
    const { result } = renderHook(() => ({ overview: useProjectOverview('P'), create: useCreateIssue('P') }), { wrapper })
    await waitFor(() => expect(result.current.overview.isSuccess).toBe(true))
    expect(fetchProjectOverview).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.create.mutateAsync({ title: 't' } as CreateIssueRequest)
    })

    await waitFor(() => expect(fetchProjectOverview).toHaveBeenCalledTimes(2))
    expect(fetchProjectOverview).toHaveBeenLastCalledWith('P')
  })
})

describe('다른 이슈 쓰기 경로의 개요 무효화(WP-1652)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('일괄 작업 공통 무효화(invalidateIssueCaches)는 같은 프로젝트 개요만 무효화한다', () => {
    const { qc } = setup()
    invalidateIssueCaches(qc, 'P')
    expect(isInvalidated(qc, projectOverviewKey('P'))).toBe(true)
    expect(isInvalidated(qc, projectOverviewKey('Q'))).toBe(false)
  })

  it('행 메뉴 단건 삭제(useRemoveIssue)가 성공하면 개요를 무효화한다', async () => {
    vi.mocked(issuesApi.remove).mockResolvedValue({ data: undefined } as never)
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useRemoveIssue('P'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(1)
    })

    expect(isInvalidated(qc, projectOverviewKey('P'))).toBe(true)
    expect(isInvalidated(qc, projectOverviewKey('Q'))).toBe(false)
  })
})
