// 공개 공유 요청의 만료 토큰 갱신(WP-1540) — shareFetch 가 Bearer 를 보낸 401 만 한 번 갱신해 다시 보내고,
// fetchShareInfo 가 Bearer 를 보낸 loginRequired 를 한 번 갱신해 다시 묻는지 본다. 비로그인(/s/:token 익명)은 그대로다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchShareBlob, fetchShareChildren, fetchShareInfo } from './drivePublicShare'

const auth = vi.hoisted(() => ({ token: null as string | null, refresh: vi.fn<() => Promise<boolean>>() }))

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  getAccessToken: () => auth.token,
  refreshAccessToken: () => auth.refresh(),
}))

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()

const status = (code: number) => new Response(null, { status: code })
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const listing = { folderId: 5, path: [{ id: 5, name: '분기 보고' }], folders: [], files: [], truncated: false }
const locked = { loginRequired: true, passwordRequired: false, target: 'FOLDER' }
const folderInfo = { passwordRequired: false, loginRequired: false, kind: 'FOLDER', name: '분기 보고', folderCount: 0, fileCount: 0 }

/** n 번째 요청의 Authorization 헤더. */
const bearerOf = (n: number) => (fetchMock.mock.calls[n][1]?.headers as Record<string, string>).Authorization

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  auth.token = 'old'
  // 갱신 성공이면 새 토큰이 메모리에 들어간다 — 다시 보낸 요청이 새 헤더를 쓰는지 본다.
  auth.refresh.mockImplementation(async () => {
    auth.token = 'new'
    return true
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  auth.refresh.mockReset()
})

describe('shareFetch (하위 목록·원본 등 공개 GET)', () => {
  it('Bearer 를 보냈는데 401 이면 한 번 갱신하고 새 토큰으로 한 번만 다시 보낸다', async () => {
    fetchMock.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(json(listing))
    await expect(fetchShareChildren('sl_f', null, null)).resolves.toEqual(listing)
    expect(auth.refresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bearerOf(0)).toBe('Bearer old')
    expect(bearerOf(1)).toBe('Bearer new')
  })

  it('갱신이 실패하면 원래 401 을 던진다', async () => {
    auth.refresh.mockResolvedValue(false)
    fetchMock.mockResolvedValue(status(401))
    await expect(fetchShareChildren('sl_f', null, null)).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('다시 보낸 요청도 401 이면 더 갱신하지 않고 401', async () => {
    fetchMock.mockResolvedValue(status(401))
    await expect(fetchShareBlob('/api/v1/public/drive/share/sl_f/files/1/content', null)).rejects.toMatchObject({ status: 401 })
    expect(auth.refresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('비로그인(Bearer 없음)의 401 은 열람 토큰 만료 — 갱신하지 않는다', async () => {
    auth.token = null
    fetchMock.mockResolvedValue(status(401))
    await expect(fetchShareChildren('sl_f', null, 'view')).rejects.toMatchObject({ status: 401 })
    expect(auth.refresh).not.toHaveBeenCalled()
  })

  it('401 이 아닌 실패는 갱신하지 않는다', async () => {
    fetchMock.mockResolvedValue(status(404))
    await expect(fetchShareChildren('sl_f', 9, null)).rejects.toMatchObject({ status: 404 })
    expect(auth.refresh).not.toHaveBeenCalled()
  })
})

describe('fetchShareInfo', () => {
  it('Bearer 를 보냈는데 loginRequired 면 갱신 뒤 한 번 다시 묻는다', async () => {
    fetchMock.mockResolvedValueOnce(json(locked)).mockResolvedValueOnce(json(folderInfo))
    await expect(fetchShareInfo('sl_f', null)).resolves.toEqual(folderInfo)
    expect(auth.refresh).toHaveBeenCalledTimes(1)
    expect(bearerOf(1)).toBe('Bearer new')
  })

  it('갱신이 실패하면 첫 loginRequired 응답을 그대로 돌려준다', async () => {
    auth.refresh.mockResolvedValue(false)
    fetchMock.mockResolvedValue(json(locked))
    await expect(fetchShareInfo('sl_f', null)).resolves.toEqual(locked)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('다시 물어도 loginRequired 면 그 응답 — 더 갱신하지 않는다', async () => {
    fetchMock.mockImplementation(async () => json(locked))
    await expect(fetchShareInfo('sl_f', null)).resolves.toEqual(locked)
    expect(auth.refresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('비로그인의 loginRequired 는 그대로(갱신 없음)', async () => {
    auth.token = null
    fetchMock.mockResolvedValue(json(locked))
    await expect(fetchShareInfo('sl_f', null)).resolves.toEqual(locked)
    expect(auth.refresh).not.toHaveBeenCalled()
  })

  it('정보 요청의 401 도 갱신 뒤 다시 묻는다', async () => {
    fetchMock.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(json(folderInfo))
    await expect(fetchShareInfo('sl_f', null)).resolves.toEqual(folderInfo)
    expect(auth.refresh).toHaveBeenCalledTimes(1)
  })
})
