// 이슈 첨부 업로드 훅(WP-2118) — 남은 자리만 올리고 결과 토스트 하나로 알린다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUploadIssueAttachments } from './useUploadIssueAttachments'

const { uploadAttachments, success, error, warning } = vi.hoisted(() => ({
  uploadAttachments: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('../../api/issueAttachments', async (orig) => ({
  ...(await orig<typeof import('../../api/issueAttachments')>()),
  uploadAttachments,
}))
vi.mock('sonner', () => ({ toast: { success, error, warning } }))
vi.mock('../../lib/api-error', () => ({ handleApiError: vi.fn() }))

const mk = (names: string[]) => names.map((n) => new File(['x'], n))

function run(files: File[], currentCount: number) {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useUploadIssueAttachments('P', 1), { wrapper })
  return act(async () => {
    await result.current.mutateAsync({ files, currentCount })
  })
}

describe('useUploadIssueAttachments — 한도 20', () => {
  beforeEach(() => {
    uploadAttachments.mockReset()
    success.mockReset()
    error.mockReset()
    warning.mockReset()
  })

  it('17개 + 5개 → 3개만 올리고 결과 토스트 하나, 파일별 에러 토스트 없음', async () => {
    uploadAttachments.mockImplementation(async (_p: string, _n: number, fs: File[]) => fs.map((f, i) => ({ fileId: i, originalName: f.name })))
    await run(mk(['a.log', 'b.log', 'c.log', 'd.log', 'e.log']), 17)
    expect(uploadAttachments.mock.calls[0][2].map((f: File) => f.name)).toEqual(['a.log', 'b.log', 'c.log'])
    expect(success).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith('첨부 3개 · 제외 2개 — 이슈당 최대 20개', { description: '제외: d.log, e.log' })
    expect(error).not.toHaveBeenCalled()
  })

  it('20개 + 2개 → 업로드 요청 없이 결과 토스트 하나', async () => {
    await run(mk(['a.log', 'b.log']), 20)
    expect(uploadAttachments).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(warning).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('첨부 0개 · 제외 2개 — 이슈당 최대 20개', { description: '제외: a.log, b.log' })
  })

  it('17개 + [a, 26MB 초과, c, d, e] → 크기 초과는 파일별 토스트, 남은 자리 3개는 a·c·d, 넘침은 결과 토스트 하나', async () => {
    uploadAttachments.mockImplementation(async (_p: string, _n: number, fs: File[]) => fs.map((f, i) => ({ fileId: i, originalName: f.name })))
    const files = mk(['a.log', 'big.bin', 'c.log', 'd.log', 'e.log'])
    // 25MB 초과로 보이게 size 만 바꾼다(실제 바이트를 만들지 않는다).
    Object.defineProperty(files[1], 'size', { value: 26 * 1024 * 1024 })
    await run(files, 17)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toContain('big.bin')
    // 크기 초과 파일이 남은 자리를 차지하지 않는다 — 업로드는 a·c·d.
    expect(uploadAttachments.mock.calls[0][2].map((f: File) => f.name)).toEqual(['a.log', 'c.log', 'd.log'])
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith('첨부 3개 · 제외 1개 — 이슈당 최대 20개', { description: '제외: e.log' })
  })

  it('refetch 가 취소돼도 업로드 직후 상세 캐시 개수가 먼저 올라 다음 묶음이 남은 자리로 잘린다', async () => {
    uploadAttachments.mockImplementation(async (_p: string, _n: number, fs: File[]) => fs.map((f, i) => ({ fileId: i, originalName: f.name })))
    const qc = new QueryClient()
    const key = ['issues', 'P', 'detail', 1]
    qc.setQueryData(key, { summary: { attachmentCount: 17 } })
    // 무효화(refetch)는 아무것도 하지 않는다 — 취소된 것과 같다.
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined)
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useUploadIssueAttachments('P', 1), { wrapper })
    await act(async () => { await result.current.mutateAsync({ files: mk(['a.log', 'b.log']), currentCount: 17 }) })
    const count = (qc.getQueryData(key) as { summary: { attachmentCount: number } }).summary.attachmentCount
    expect(count).toBe(19)
    // 낡은 개수가 아니라 올라간 개수로 두 번째 묶음 → 남은 1자리만.
    await act(async () => { await result.current.mutateAsync({ files: mk(['c.log', 'd.log', 'e.log']), currentCount: count }) })
    expect(uploadAttachments.mock.calls[1][2].map((f: File) => f.name)).toEqual(['c.log'])
  })

  it('넘침 없으면 「n개 첨부를 추가했습니다」', async () => {
    uploadAttachments.mockResolvedValue([{ fileId: 1 }, { fileId: 2 }])
    await run(mk(['a.log', 'b.log']), 3)
    expect(success).toHaveBeenCalledWith('2개 첨부를 추가했습니다', undefined)
  })
})
