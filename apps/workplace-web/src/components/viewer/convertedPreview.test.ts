// 변환 미리보기 응답 → 화면 상태 매핑(WP-431)과 API 의 422 본문 해석.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
vi.mock('../../api/client', () => ({ client: { get: (...a: unknown[]) => get(...a) }, getAccessToken: () => 't' }))

import { driveApi } from '../../api/drive'
import { toConvertedState } from './convertedPreview'

describe('toConvertedState', () => {
  it('200 → ready(blob 그대로)', () => {
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' })
    expect(toConvertedState({ status: 200, blob })).toEqual({ s: 'ready', blob })
  })

  it("202 → 'poll'(다시 묻는다)", () => {
    expect(toConvertedState({ status: 202 })).toBe('poll')
  })

  it('422 BUSY transient → 일시 실패', () => {
    expect(toConvertedState({ status: 422, code: 'BUSY', transient: true })).toEqual({ s: 'failed', code: 'BUSY', transient: true })
  })

  it('422 CONVERT_FAILED → 영구 실패', () => {
    expect(toConvertedState({ status: 422, code: 'CONVERT_FAILED', transient: false })).toEqual({
      s: 'failed',
      code: 'CONVERT_FAILED',
      transient: false,
    })
  })

  it('404 → unsupported', () => {
    expect(toConvertedState({ status: 404 })).toEqual({ s: 'unsupported' })
  })

  it("'error'(대상 아님이 아닌 404) → error", () => {
    expect(toConvertedState({ status: 'error' })).toEqual({ s: 'error' })
  })
})

describe('driveApi.fetchConvertedPreview', () => {
  beforeEach(() => get.mockReset())

  it('/api/v1 접두어를 떼고 blob·signal·허용 상태로 요청한다', async () => {
    const blob = new Blob(['%PDF-'])
    get.mockResolvedValue({ status: 200, data: blob })
    const signal = new AbortController().signal
    expect(await driveApi.fetchConvertedPreview('/api/v1/drive/files/3/preview?start=true', signal)).toEqual({ status: 200, blob })
    const [path, cfg] = get.mock.calls[0]
    expect(path).toBe('/drive/files/3/preview?start=true')
    expect(cfg.responseType).toBe('blob')
    expect(cfg.signal).toBe(signal)
    expect([200, 202, 404, 422].every(cfg.validateStatus)).toBe(true)
    expect(cfg.validateStatus(500)).toBe(false)
  })

  it('422 는 blob 본문을 JSON 으로 읽어 code·transient 를 꺼낸다', async () => {
    get.mockResolvedValue({ status: 422, data: new Blob([JSON.stringify({ status: 'FAILED', code: 'TOO_LARGE', transient: false })]) })
    expect(await driveApi.fetchConvertedPreview('/drive/files/3/preview')).toEqual({ status: 422, code: 'TOO_LARGE', transient: false })
  })

  it('422 본문을 못 읽으면 UNAVAILABLE 일시 실패로 본다', async () => {
    get.mockResolvedValue({ status: 422, data: new Blob(['<html>']) })
    expect(await driveApi.fetchConvertedPreview('/drive/files/3/preview')).toEqual({ status: 422, code: 'UNAVAILABLE', transient: true })
  })

  it('202 는 본문 없이 상태만', async () => {
    get.mockResolvedValueOnce({ status: 202, data: new Blob(['{"status":"CONVERTING"}']) })
    expect(await driveApi.fetchConvertedPreview('/p')).toEqual({ status: 202 })
  })

  it('404 는 NOT_APPLICABLE 본문일 때만 404(대상 아님)', async () => {
    get.mockResolvedValueOnce({ status: 404, data: new Blob([JSON.stringify({ status: 'NOT_APPLICABLE' })]) })
    expect(await driveApi.fetchConvertedPreview('/p')).toEqual({ status: 404 })
  })

  it("그 밖의 404(예외 봉투·빈 본문·HTML)는 'error'", async () => {
    get.mockResolvedValueOnce({ status: 404, data: new Blob([JSON.stringify({ status: 404, error: 'Not Found', message: '파일을 찾을 수 없습니다' })]) })
    expect(await driveApi.fetchConvertedPreview('/p')).toEqual({ status: 'error' })
    get.mockResolvedValueOnce({ status: 404, data: new Blob([]) })
    expect(await driveApi.fetchConvertedPreview('/p')).toEqual({ status: 'error' })
    get.mockResolvedValueOnce({ status: 404, data: new Blob(['<html>']) })
    expect(await driveApi.fetchConvertedPreview('/p')).toEqual({ status: 'error' })
  })
})
