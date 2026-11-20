import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type PendingFile, useAttachmentDraft } from '@/hooks/useAttachmentDraft'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

/** 업로드 응답 흉내 — 파일마다 칩 하나. */
function fakeUpload(files: File[]): Promise<{ data: PendingFile[] }> {
  return Promise.resolve({
    data: files.map((f, i) => ({ fileId: i + 1, originalName: f.name, mimeType: 'text/plain', sizeBytes: 1 })),
  })
}
// useDriveSpaces 가 useQuery 를 부르므로(drive:false 여도 훅은 호출된다) 공급자만 감싼다 — 요청은 나가지 않는다.
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)
const mk = (n: number) => Array.from({ length: n }, (_, i) => new File(['x'], `f${i}.txt`))

describe('useAttachmentDraft maxFiles (WP-1857)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('낡은 클로저의 removeFile 을 두 번 불러도 한도 판정은 실제 칩 수로 한다', async () => {
    const { result } = renderHook(() => useAttachmentDraft(fakeUpload, { drive: false, maxFiles: 10 }), { wrapper })
    await act(async () => {
      await result.current.onFiles(mk(3))
    })
    // 칩 3개가 보이는 render 의 removeFile 을 붙잡아 같은 칩을 두 번 지운다(낡은 클로저 재현).
    const staleRemove = result.current.removeFile
    act(() => {
      staleRemove(1)
      staleRemove(1)
    })
    expect(result.current.pending).toHaveLength(2)
    // 실제 칩 2개 → 9개 묶음은 거절되고 남은 자리는 8개여야 한다(집계가 어긋나면 9개로 나온다).
    await act(async () => {
      await result.current.onFiles(mk(9))
    })
    expect(toast.error).toHaveBeenCalledWith(
      '첨부는 메시지당 최대 10개예요 — 8개 더 붙일 수 있어요',
      { id: 'attachment-count-limit' },
    )
  })

  it('업로드가 끝난 직후 render 전에 들어온 같은 틱 묶음도 방금 올린 칩을 센다', async () => {
    const { result } = renderHook(() => useAttachmentDraft(fakeUpload, { drive: false, maxFiles: 10 }), { wrapper })
    // 한 act 안에서 업로드 응답 처리 → (render 전) 곧바로 다음 묶음 — 8개 + 3개는 한도 초과여야 한다.
    await act(async () => {
      await result.current.onFiles(mk(8))
      await result.current.onFiles(mk(3))
    })
    expect(toast.error).toHaveBeenCalledWith(
      '첨부는 메시지당 최대 10개예요 — 2개 더 붙일 수 있어요',
      { id: 'attachment-count-limit' },
    )
    expect(result.current.pending).toHaveLength(8)
  })
})
