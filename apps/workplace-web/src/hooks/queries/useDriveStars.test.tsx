// @vitest-environment jsdom
// 드라이브 별표 바꾸기(WP-1698) — 겹친 바꾸기에서 실패한 것은 자기 항목만 되돌리고(다른 바꾸기의 낙관값을 지우지 않는다),
// 다시 받기는 진행 중인 별표 바꾸기가 모두 끝날 때 한 번만 한다(도중에 받으면 서버 옛 상태로 행이 깜빡 돌아온다).
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/drive', () => ({
  listStarredDriveItems: vi.fn(),
  starDriveItem: vi.fn(),
  unstarDriveItem: vi.fn(),
}))

import { starDriveItem, unstarDriveItem } from '../../api/drive'
import type { DriveFile, DriveItemList, DriveStarredItem, DriveStarredPage } from '../../types/drive'
import { driveKeys } from './driveKeys'
import { useToggleDriveStar } from './useDriveStars'

const row = (kind: 'FILE' | 'FOLDER', id: number): DriveStarredItem => ({
  kind,
  id,
  name: `${kind}-${id}`,
  mimeType: null,
  sizeBytes: null,
  fileId: null,
  category: null,
  versionCount: null,
  available: null,
  folderCount: null,
  fileCount: null,
  parentFolderId: null,
  path: '',
  spaceId: 1,
  spaceName: '공간',
  updatedAt: '2026-11-12T03:00:00Z',
  starredAt: '2026-11-13T03:00:00Z',
})

const driveFile = (id: number, starred: boolean): DriveFile => ({
  id,
  folderId: null,
  fileId: id + 900,
  name: `f${id}.txt`,
  mimeType: 'text/plain',
  sizeBytes: 1,
  category: 'TEXT',
  createdAt: '2026-11-12T03:00:00Z',
  updatedAt: '2026-11-12T03:00:00Z',
  versionCount: 1,
  available: true,
  starred,
})

/** 손으로 끝낼 수 있는 응답 — 겹친 바꾸기의 순서를 테스트가 정한다. */
function deferred() {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useToggleDriveStar(), { wrapper })
  return { qc, invalidate, result }
}

const starredIds = (qc: QueryClient) =>
  qc.getQueryData<InfiniteData<DriveStarredPage>>(driveKeys.starred())!.pages.flatMap((p) => p.items.map((i) => `${i.kind}:${i.id}`))

describe('useToggleDriveStar 겹친 바꾸기', () => {
  it('먼저 뺀 행이 실패하면 그 행만 원래 자리로 돌아오고, 뒤에 뺀 행은 빠진 채로 둔다 — 다시 받기는 둘 다 끝난 뒤 한 번', async () => {
    const { qc, invalidate, result } = setup()
    qc.setQueryData<InfiniteData<DriveStarredPage>>(driveKeys.starred(), {
      pages: [{ items: [row('FILE', 1), row('FILE', 2), row('FOLDER', 3)], nextCursor: null }],
      pageParams: [null],
    })
    const a = deferred()
    const b = deferred()
    vi.mocked(unstarDriveItem).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)

    let pa!: Promise<void>
    let pb!: Promise<void>
    act(() => {
      pa = result.current.mutateAsync({ target: { kind: 'FILE', id: 1 }, spaceId: 1, starred: false })
    })
    await waitFor(() => expect(starredIds(qc)).toEqual(['FILE:2', 'FOLDER:3']))
    act(() => {
      pb = result.current.mutateAsync({ target: { kind: 'FILE', id: 2 }, spaceId: 1, starred: false })
    })
    await waitFor(() => expect(starredIds(qc)).toEqual(['FOLDER:3']))

    // A 실패 — B 가 아직 진행 중이다. A 만 제자리로, B 는 빠진 채, 다시 받지 않는다.
    await act(async () => {
      a.reject(new Error('500'))
      await pa.catch(() => undefined)
    })
    expect(starredIds(qc)).toEqual(['FILE:1', 'FOLDER:3'])
    expect(invalidate).not.toHaveBeenCalled()

    // B 성공 — 마지막 바꾸기가 끝나 이제 다시 받는다.
    await act(async () => {
      b.resolve()
      await pb
    })
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    // A 가 실패했으니 「별표」 목록도 다시 받고, 폴더 목록은 바꾸기가 닿은 공간(1)만.
    expect(keys).toEqual([JSON.stringify(['drive', 'starred']), JSON.stringify(['drive', 'items', 1])])
  })

  it('빼기가 모두 성공하면 「별표」 목록은 다시 받지 않고(낙관값이 이미 맞다) 닿은 공간의 폴더 목록만 맞춘다', async () => {
    const { qc, invalidate, result } = setup()
    qc.setQueryData<InfiniteData<DriveStarredPage>>(driveKeys.starred(), {
      pages: [{ items: [row('FILE', 1), row('FILE', 2)], nextCursor: null }],
      pageParams: [null],
    })
    const a = deferred()
    const b = deferred()
    vi.mocked(unstarDriveItem).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)

    let pa!: Promise<void>
    let pb!: Promise<void>
    // 서로 다른 공간(1·2)의 행을 겹쳐 뺀다.
    act(() => {
      pa = result.current.mutateAsync({ target: { kind: 'FILE', id: 1 }, spaceId: 1, starred: false })
    })
    await waitFor(() => expect(starredIds(qc)).toEqual(['FILE:2']))
    act(() => {
      pb = result.current.mutateAsync({ target: { kind: 'FILE', id: 2 }, spaceId: 2, starred: false })
    })
    await waitFor(() => expect(starredIds(qc)).toEqual([]))

    await act(async () => {
      a.resolve()
      await pa
    })
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => {
      b.resolve()
      await pb
    })
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toEqual([JSON.stringify(['drive', 'items', 1]), JSON.stringify(['drive', 'items', 2])])
    expect(starredIds(qc)).toEqual([])
  })

  it('넣기가 성공하면 새 행 내용이 없으니 「별표」 목록을 다시 받는다', async () => {
    const { invalidate, result } = setup()
    vi.mocked(starDriveItem).mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.mutateAsync({ target: { kind: 'FOLDER', id: 5 }, spaceId: 3, starred: true })
    })
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toEqual([JSON.stringify(['drive', 'starred']), JSON.stringify(['drive', 'items', 3])])
  })

  it('공간 폴더 목록에서도 실패한 항목의 별표만 되돌리고 다른 항목의 낙관값은 남긴다', async () => {
    const { qc, result } = setup()
    qc.setQueryData<DriveItemList>(driveKeys.items(1, null), { folders: [], files: [driveFile(10, false), driveFile(11, false)] })
    const a = deferred()
    const b = deferred()
    vi.mocked(starDriveItem).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const starredOf = () => qc.getQueryData<DriveItemList>(driveKeys.items(1, null))!.files.map((f) => [f.id, f.starred])

    let pa!: Promise<void>
    let pb!: Promise<void>
    act(() => {
      pa = result.current.mutateAsync({ target: { kind: 'FILE', id: 10 }, spaceId: 1, starred: true })
    })
    await waitFor(() => expect(starredOf()).toEqual([[10, true], [11, false]]))
    act(() => {
      pb = result.current.mutateAsync({ target: { kind: 'FILE', id: 11 }, spaceId: 1, starred: true })
    })
    await waitFor(() => expect(starredOf()).toEqual([[10, true], [11, true]]))

    await act(async () => {
      a.reject(new Error('500'))
      await pa.catch(() => undefined)
    })
    expect(starredOf()).toEqual([[10, false], [11, true]])

    await act(async () => {
      b.resolve()
      await pb
    })
  })
})
