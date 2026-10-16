// useConvertedPreview — 변환 미리보기 폴링(WP-431): 1.5초 간격, 시도당 90초 상한(서버 변환 예산 75초 + BUSY 대기보다 길게), start=true 는 시도 첫 요청만.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConvertedPreviewResponse } from '../../api/drive'

const fetchConvertedPreview = vi.fn<(path: string, signal?: AbortSignal) => Promise<ConvertedPreviewResponse>>()
vi.mock('../../api/drive', () => ({ driveApi: { fetchConvertedPreview: (p: string, s?: AbortSignal) => fetchConvertedPreview(p, s) } }))

import type { ViewerItem } from './types'
import { useConvertedPreview } from './useConvertedPreview'

const item = (id = 7): ViewerItem => ({
  key: `drive:${id}`,
  name: 'a.hwp',
  mimeType: 'application/x-hwp',
  sizeBytes: 10,
  contentPath: `/drive/files/${id}/content`,
  downloadPath: `/drive/files/${id}/download`,
  previewPath: `/drive/files/${id}/preview`,
})

const pdf = new Blob(['%PDF-'], { type: 'application/pdf' })
/** 마이크로태스크(응답 처리)까지 흘려 보내며 시간을 민다. */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.useFakeTimers()
  fetchConvertedPreview.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('useConvertedPreview', () => {
  it('202 두 번 뒤 200 이면 1.5초 간격으로 세 번 요청하고 ready', async () => {
    fetchConvertedPreview
      .mockResolvedValueOnce({ status: 202 })
      .mockResolvedValueOnce({ status: 202 })
      .mockResolvedValueOnce({ status: 200, blob: pdf })
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    await advance(0)
    expect(result.current.state).toEqual({ s: 'converting' })
    await advance(1499)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(2)
    await advance(1500)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(3)
    expect(result.current.state).toEqual({ s: 'ready', blob: pdf })
    await advance(10_000)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(3)
  })

  it('계속 202 면 90초에 POLL_TIMEOUT 일시 실패이고 그 뒤 요청하지 않는다', async () => {
    fetchConvertedPreview.mockResolvedValue({ status: 202 })
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    // 서버 예산(75초 변환 타임아웃)을 넘긴 시점에도 아직 기다린다.
    await advance(80_000)
    expect(result.current.state).toEqual({ s: 'converting' })
    await advance(9_999)
    expect(result.current.state).toEqual({ s: 'converting' })
    await advance(1)
    expect(result.current.state).toEqual({ s: 'failed', code: 'POLL_TIMEOUT', transient: true })
    const calls = fetchConvertedPreview.mock.calls.length
    await advance(10_000)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(calls)
  })

  it('첫 요청과 retry 첫 요청만 start=true 이고 폴링은 붙이지 않는다', async () => {
    fetchConvertedPreview.mockResolvedValue({ status: 202 })
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    await advance(3000)
    act(() => result.current.retry())
    await advance(1500)
    expect(fetchConvertedPreview.mock.calls.map((c) => c[0])).toEqual([
      '/drive/files/7/preview?start=true',
      '/drive/files/7/preview',
      '/drive/files/7/preview',
      '/drive/files/7/preview?start=true',
      '/drive/files/7/preview',
    ])
  })

  it('422 면 실패를 보이고 폴링을 멈춘다(일시 실패도 다시 묻지 않는다)', async () => {
    fetchConvertedPreview.mockResolvedValueOnce({ status: 202 }).mockResolvedValue({ status: 422, code: 'BUSY', transient: true })
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    await advance(1500)
    expect(result.current.state).toEqual({ s: 'failed', code: 'BUSY', transient: true })
    await advance(10_000)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(2)
  })

  it('404 면 unsupported', async () => {
    fetchConvertedPreview.mockResolvedValue({ status: 404 })
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    await advance(0)
    expect(result.current.state).toEqual({ s: 'unsupported' })
  })

  it('NOT_APPLICABLE 이 아닌 404(error)면 오류 상태로 멈추고 더 묻지 않는다', async () => {
    fetchConvertedPreview.mockResolvedValue({ status: 'error' })
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    await advance(0)
    expect(result.current.state).toEqual({ s: 'error' })
    await advance(10_000)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(1)
  })

  it('요청이 throw 하면 UNAVAILABLE 일시 실패', async () => {
    fetchConvertedPreview.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    await advance(0)
    expect(result.current.state).toEqual({ s: 'failed', code: 'UNAVAILABLE', transient: true })
  })

  it('retry 하면 처음부터 다시 요청한다', async () => {
    fetchConvertedPreview.mockResolvedValueOnce({ status: 422, code: 'TIMEOUT', transient: true }).mockResolvedValueOnce({ status: 202 })
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    await advance(0)
    expect(result.current.state?.s).toBe('failed')
    fetchConvertedPreview.mockResolvedValueOnce({ status: 200, blob: pdf })
    act(() => result.current.retry())
    expect(result.current.state).toEqual({ s: 'converting' })
    await advance(0)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(2)
    await advance(1500)
    expect(result.current.state).toEqual({ s: 'ready', blob: pdf })
  })

  it('retry 는 90초 상한도 새로 잡는다', async () => {
    fetchConvertedPreview.mockResolvedValue({ status: 202 })
    const { result } = renderHook(() => useConvertedPreview(item(), true))
    await advance(30_000)
    act(() => result.current.retry())
    await advance(89_999)
    expect(result.current.state).toEqual({ s: 'converting' })
    await advance(1)
    expect(result.current.state).toEqual({ s: 'failed', code: 'POLL_TIMEOUT', transient: true })
  })

  it('언마운트하면 더 요청하지 않고 abort 한다', async () => {
    fetchConvertedPreview.mockResolvedValue({ status: 202 })
    const { unmount } = renderHook(() => useConvertedPreview(item(), true))
    await advance(0)
    const signal = fetchConvertedPreview.mock.calls[0][1]!
    expect(signal.aborted).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)
    await advance(10_000)
    expect(fetchConvertedPreview).toHaveBeenCalledTimes(1)
  })

  it('항목을 바꾸면 이전 요청을 끊고 새 항목을 start=true 로 처음부터', async () => {
    fetchConvertedPreview.mockResolvedValueOnce({ status: 200, blob: pdf }).mockResolvedValue({ status: 202 })
    const { result, rerender } = renderHook(({ it }) => useConvertedPreview(it, true), { initialProps: { it: item(7) } })
    await advance(0)
    expect(result.current.state?.s).toBe('ready')
    const prevSignal = fetchConvertedPreview.mock.calls[0][1]!
    rerender({ it: item(8) })
    expect(prevSignal.aborted).toBe(true)
    expect(result.current.state).toEqual({ s: 'converting' })
    await advance(0)
    expect(fetchConvertedPreview.mock.calls[1][0]).toBe('/drive/files/8/preview?start=true')
  })

  it('enabled 거짓이면 요청하지 않고 상태는 null 이다', async () => {
    const { result } = renderHook(() => useConvertedPreview(item(), false))
    await advance(10_000)
    expect(fetchConvertedPreview).not.toHaveBeenCalled()
    // 꺼진 훅은 상태가 없다(호출부가 변환 항목인지 다시 따지지 않게).
    expect(result.current.state).toBeNull()
  })
})
