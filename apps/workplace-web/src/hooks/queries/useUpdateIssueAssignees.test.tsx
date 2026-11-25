// 담당 저장 뒤 캐시 무효화(WP-2120 리뷰 후속) — 담당이 바뀌면 그 이슈의 담당 미리보기(카드 안내·팝오버)도 지워 다시 묻게 한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { issueWorkflowKeys } from './issueWorkflowKeys'
import { useUpdateIssueAssignees } from './useUpdateIssueAssignees'

vi.mock('../../api/issueAssignees', () => ({ replaceIssueAssignees: vi.fn(() => Promise.resolve([])) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

function setup(qc: QueryClient, issueId?: number) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return renderHook(() => useUpdateIssueAssignees('WP', 1, issueId), { wrapper })
}

/** 카드·팝오버가 쓰는 미리보기 키 모양(useAssignPreview) — 접두사 previewAll + 이슈 id + 판정 방식 + 담당 id. */
const previewKey = (issueId: number, current: boolean, ids: number[]) => [...issueWorkflowKeys.previewAll, issueId, 'assign', current, ids]

describe('useUpdateIssueAssignees — 담당 미리보기 무효화', () => {
  it('저장에 성공하면 그 이슈의 미리보기만 무효화하고 다른 이슈의 미리보기는 그대로 둔다', async () => {
    const qc = new QueryClient()
    qc.setQueryData(previewKey(7, true, [4]), { start: null })
    qc.setQueryData(previewKey(7, false, [4, 9]), { start: null })
    qc.setQueryData(previewKey(8, true, [4]), { start: null })
    const { result } = setup(qc, 7)

    await act(async () => { await result.current.mutateAsync({ userIds: [9] }) })

    expect(qc.getQueryState(previewKey(7, true, [4]))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(previewKey(7, false, [4, 9]))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(previewKey(8, true, [4]))?.isInvalidated).toBe(false)
  })

  it('이슈 id 를 모르면(옛 호출부) 미리보기를 건드리지 않는다', async () => {
    const qc = new QueryClient()
    qc.setQueryData(previewKey(7, true, [4]), { start: null })
    const { result } = setup(qc)

    await act(async () => { await result.current.mutateAsync({ userIds: [9] }) })

    expect(qc.getQueryState(previewKey(7, true, [4]))?.isInvalidated).toBe(false)
  })
})
