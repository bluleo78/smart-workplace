// 뷰어 항목 출처(WP-1227) — item.source 가 있으면 원본·변환 PDF·다운로드를 그 출처로 받고, 없으면 기존 driveApi 그대로다.
// 공유 링크 화면(공개 경로 + 열람 토큰)이 이 틈으로 뷰어를 재사용한다. 드라이브·메일·채팅 뷰어의 기본 동작이 바뀌지 않는지도 함께 본다.
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConvertedPreviewResponse } from '../../api/drive'

const fetchBlobByPath = vi.fn<(path: string, opts?: unknown) => Promise<Blob>>()
const fetchConvertedPreview = vi.fn<(path: string, signal?: AbortSignal) => Promise<ConvertedPreviewResponse>>()
const downloadByPath = vi.fn<(path: string, name: string) => Promise<void>>()
vi.mock('../../api/drive', () => ({
  driveApi: {
    fetchBlobByPath: (p: string, o?: unknown) => fetchBlobByPath(p, o),
    fetchConvertedPreview: (p: string, s?: AbortSignal) => fetchConvertedPreview(p, s),
    downloadByPath: (p: string, n: string) => downloadByPath(p, n),
  },
}))

import { downloadViewerItem } from './downloadViewerItem'
import type { ViewerItem, ViewerItemSource } from './types'
import { useConvertedPreview } from './useConvertedPreview'
import { usePreviewBlob } from './usePreviewBlob'

const item = (over: Partial<ViewerItem> = {}): ViewerItem => ({
  key: 'drive:1',
  name: 'a.txt',
  mimeType: 'text/plain',
  sizeBytes: 5,
  contentPath: '/drive/files/1/content',
  downloadPath: '/drive/files/1/download',
  previewPath: '/drive/files/1/preview',
  ...over,
})

const blob = new Blob(['hello'], { type: 'text/plain' })

/** 호출을 모으는 가짜 출처. */
function fakeSource() {
  return {
    fetchBlob: vi.fn<ViewerItemSource['fetchBlob']>(async () => blob),
    fetchConverted: vi.fn<ViewerItemSource['fetchConverted']>(async () => ({ status: 202 }) as const),
    download: vi.fn<ViewerItemSource['download']>(async () => {}),
  }
}

beforeEach(() => {
  fetchBlobByPath.mockReset().mockResolvedValue(blob)
  fetchConvertedPreview.mockReset().mockResolvedValue({ status: 202 })
  downloadByPath.mockReset().mockResolvedValue()
})

describe('뷰어 항목 출처', () => {
  it('출처가 없으면 원본·변환·다운로드 모두 driveApi 로 받는다(기존 동작)', async () => {
    const { result } = renderHook(() => usePreviewBlob(item(), true))
    await waitFor(() => expect(result.current.blob).not.toBeNull())
    expect(fetchBlobByPath).toHaveBeenCalledWith('/drive/files/1/content', expect.anything())

    const conv = renderHook(() => useConvertedPreview(item(), true))
    await waitFor(() => expect(fetchConvertedPreview).toHaveBeenCalledWith('/drive/files/1/preview?start=true', expect.anything()))
    conv.unmount()

    await downloadViewerItem(item(), null)
    expect(downloadByPath).toHaveBeenCalledWith('/drive/files/1/download', 'a.txt')
  })

  it('출처가 있으면 원본·변환·다운로드를 그 출처로 받고 driveApi 는 부르지 않는다', async () => {
    const source = fakeSource()
    const it1 = item({ key: 'share:t', contentPath: '/api/v1/public/drive/share/t/content', previewPath: '/api/v1/public/drive/share/t/preview', downloadPath: '/api/v1/public/drive/share/t/download', source })
    const { result } = renderHook(() => usePreviewBlob(it1, true))
    await waitFor(() => expect(result.current.blob).not.toBeNull())
    expect(source.fetchBlob).toHaveBeenCalledWith('/api/v1/public/drive/share/t/content', expect.objectContaining({ signal: expect.any(AbortSignal) }))

    const conv = renderHook(() => useConvertedPreview(it1, true))
    await waitFor(() => expect(source.fetchConverted).toHaveBeenCalledWith('/api/v1/public/drive/share/t/preview?start=true', expect.any(AbortSignal)))
    conv.unmount()

    await downloadViewerItem(it1, null)
    expect(source.download).toHaveBeenCalledWith(it1)
    expect(fetchBlobByPath).not.toHaveBeenCalled()
    expect(fetchConvertedPreview).not.toHaveBeenCalled()
    expect(downloadByPath).not.toHaveBeenCalled()
  })
})
