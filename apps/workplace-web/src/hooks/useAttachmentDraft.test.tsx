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

describe('commitSent (WP-1868)', () => {
  beforeEach(() => vi.clearAllMocks())

  /** 호출마다 다음 fileId 를 이어 매기는 업로드 흉내 — 여러 번 올려도 id 가 겹치지 않는다. */
  function seqUpload() {
    let next = 1
    return vi.fn((files: File[]): Promise<{ data: PendingFile[] }> => {
      const data = files.map((f) => ({ fileId: next++, originalName: f.name, mimeType: 'text/plain', sizeBytes: 1 }))
      return Promise.resolve({ data })
    })
  }

  it('보낸 fileId 만 빠지고 나머지 칩은 남는다', async () => {
    const upload = seqUpload()
    const { result } = renderHook(() => useAttachmentDraft(upload, { drive: false }), { wrapper })
    await act(async () => {
      await result.current.onFiles(mk(2))
    })
    // 전송 중 새로 붙은 칩 — id 3
    await act(async () => {
      await result.current.onFiles(mk(1))
    })
    act(() => result.current.commitSent([1, 2], []))
    expect(result.current.pending.map((p) => p.fileId)).toEqual([3])
  })

  it('보낸 드라이브 링크만 빠진다', () => {
    const { result } = renderHook(() => useAttachmentDraft(seqUpload(), { drive: false }), { wrapper })
    act(() => {
      result.current.addDrive(10, 'a')
      result.current.addDrive(11, 'b')
    })
    act(() => result.current.commitSent([], [10]))
    expect(result.current.driveFileIds).toEqual([11])
  })

  it('이미 지운 id 를 보내도 남은 칩은 그대로', async () => {
    const upload = seqUpload()
    const { result } = renderHook(() => useAttachmentDraft(upload, { drive: false }), { wrapper })
    await act(async () => {
      await result.current.onFiles(mk(2))
    })
    act(() => result.current.removeFile(1))
    act(() => result.current.commitSent([1], []))
    expect(result.current.pending.map((p) => p.fileId)).toEqual([2])
  })

  it('commitSent 뒤에 끝난 업로드의 칩도 남는다', async () => {
    // 전송이 끝날 때 아직 올라가던 파일 — 업로드 결과는 commitSent 뒤 pendingRef 에 더해져야 한다.
    let finishUpload: (v: { data: PendingFile[] }) => void = () => {}
    const upload = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({ data: [1, 2].map((id) => ({ fileId: id, originalName: `f${id}`, mimeType: 'text/plain', sizeBytes: 1 })) }),
      )
      .mockImplementationOnce(() => new Promise<{ data: PendingFile[] }>((resolve) => { finishUpload = resolve }))
    const { result } = renderHook(() => useAttachmentDraft(upload, { drive: false }), { wrapper })
    await act(async () => {
      await result.current.onFiles(mk(2))
    })
    let uploading: Promise<void> = Promise.resolve()
    act(() => {
      uploading = result.current.onFiles(mk(1))
    })
    act(() => result.current.commitSent([1], []))
    await act(async () => {
      finishUpload({ data: [{ fileId: 3, originalName: 'f3', mimeType: 'text/plain', sizeBytes: 1 }] })
      await uploading
    })
    expect(result.current.pending.map((p) => p.fileId)).toEqual([2, 3])
  })

  it('개수 집계가 남은 칩 수를 따른다', async () => {
    const upload = seqUpload()
    const { result } = renderHook(() => useAttachmentDraft(upload, { drive: false, maxFiles: 2 }), { wrapper })
    await act(async () => {
      await result.current.onFiles(mk(2))
    })
    act(() => result.current.commitSent([1], []))
    expect(upload).toHaveBeenCalledTimes(1)
    await act(async () => {
      await result.current.onFiles(mk(1))
    })
    expect(upload).toHaveBeenCalledTimes(2)
    await act(async () => {
      await result.current.onFiles(mk(1))
    })
    expect(upload).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledWith(
      '첨부는 메시지당 최대 2개예요 — 더 붙일 수 없어요',
      { id: 'attachment-count-limit' },
    )
  })
})
