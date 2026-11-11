// 도움말 묶음 불러오기(fetchHelpJson) — 응답 상태·본문 형식별로 어떤 오류를 던지는지 지킨다(WP-1505).
// 정적 파일 404 는 nginx 의 html 이나 vite 의 빈 본문이 오므로 본문보다 res.ok 를 먼저 봐야 하고,
// 200 인데 JSON 이 아닌 응답(프록시가 끼운 html)은 「없음」이 아니라 일반 오류여야 패널이 「다시 시도」를 보인다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchHelpJson, HelpHttpError, HelpNotFoundError, helpRetry } from './helpBundle'

describe('fetchHelpJson', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('200 JSON 이면 파싱해 돌려준다', async () => {
    fetchMock.mockResolvedValue(new Response('[{"chapter":"home"}]', { status: 200 }))
    expect(await fetchHelpJson('manual-index.json')).toEqual([{ chapter: 'home' }])
    expect(fetchMock).toHaveBeenCalledWith('/help/manual-index.json', expect.anything())
  })

  it('404 면 본문을 읽지 않고 HelpNotFoundError', async () => {
    const res = new Response('<html>not found</html>', { status: 404 })
    const textSpy = vi.spyOn(res, 'text')
    const jsonSpy = vi.spyOn(res, 'json')
    fetchMock.mockResolvedValue(res)
    await expect(fetchHelpJson('manual/x.json')).rejects.toBeInstanceOf(HelpNotFoundError)
    expect(textSpy).not.toHaveBeenCalled()
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('500 이면 일반 Error(HelpNotFoundError 아님)', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }))
    const err = await fetchHelpJson('manual-index.json').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(HelpNotFoundError)
  })

  it('200 인데 html 이면 일반 Error', async () => {
    fetchMock.mockResolvedValue(new Response('<!doctype html><html></html>', { status: 200 }))
    const err = await fetchHelpJson('manual-index.json').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(HelpNotFoundError)
    expect((err as Error).message).toContain('manual-index.json')
  })

  it('네트워크 실패(TypeError)는 그대로 던진다', async () => {
    const netErr = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValue(netErr)
    await expect(fetchHelpJson('manual-index.json')).rejects.toBe(netErr)
  })

  it('signal 을 fetch 에 넘긴다', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    const ctrl = new AbortController()
    await fetchHelpJson('manual-vars.json', ctrl.signal)
    expect(fetchMock).toHaveBeenCalledWith('/help/manual-vars.json', expect.objectContaining({ signal: ctrl.signal }))
  })
})

// 재시도 정책은 앱 전역(shouldRetryQuery)과 같다 — 4xx 는 다시 받아도 같으므로 바로 실패, 5xx·네트워크·형식 오류만 한 번 더.
describe('helpRetry', () => {
  it('404(HelpNotFoundError)·그 밖의 4xx 는 첫 실패부터 재시도하지 않는다', () => {
    expect(helpRetry(0, new HelpNotFoundError('manual/x.json'))).toBe(false)
    for (const s of [400, 401, 403, 410]) expect(helpRetry(0, new HelpHttpError(s, 'manual-index.json'))).toBe(false)
  })

  it('5xx·네트워크 오류·형식 오류는 한 번만 재시도한다', () => {
    expect(helpRetry(0, new HelpHttpError(503, 'manual-index.json'))).toBe(true)
    expect(helpRetry(1, new HelpHttpError(503, 'manual-index.json'))).toBe(false)
    expect(helpRetry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(helpRetry(0, new Error('도움말 묶음 형식 오류: x'))).toBe(true)
    expect(helpRetry(1, new Error('도움말 묶음 형식 오류: x'))).toBe(false)
  })

  it('fetchHelpJson 의 403 은 상태를 든 HelpHttpError 다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 403 })))
    const err = await fetchHelpJson('manual-index.json').catch((e: unknown) => e)
    vi.unstubAllGlobals()
    expect(err).toBeInstanceOf(HelpHttpError)
    expect((err as HelpHttpError).status).toBe(403)
    expect(helpRetry(0, err as Error)).toBe(false)
  })
})
