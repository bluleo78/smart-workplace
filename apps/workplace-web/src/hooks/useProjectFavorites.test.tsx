// 프로젝트 즐겨찾기 서버 저장(WP-1001) — 훅 테스트. 실제 api → 훅 경로를 MSW 로 지난다.
// 이관(서버가 비었을 때만 올리고 로컬 키 지움)·토글 요청(key 하나씩 PUT/DELETE)·여러 구독자 공유·실패 시 서버 상태로 되돌림·
// 로그인 전 조회 없음은 브라우저 없이 판정되므로 vitest 로 지킨다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/hooks/auth-context-value'
import { server } from '@/test/msw/server'
import { testAuthValue } from '@/test/renderWithProviders'

import { useProjectFavorites } from './useProjectFavorites'

const API = '/api/v1/me/project-favorites'
const LEGACY = 'project-favorites:1:1'

/** 서버처럼 상태를 가진 즐겨찾기 API — 받은 요청을 calls 에 쌓는다. fail 이면 추가·해제가 500. */
function favoritesApi(initial: string[] = [], opts: { fail?: boolean } = {}) {
  const keys = new Set(initial)
  const calls: string[] = []
  server.use(
    http.get(API, () => {
      calls.push('GET')
      return HttpResponse.json({ projectKeys: [...keys] })
    }),
    http.put(`${API}/:key`, async ({ params }) => {
      calls.push(`PUT ${params.key}`)
      // 응답 전 낙관 상태를 볼 수 있게 조금 늦게 답한다.
      await delay(200)
      if (opts.fail) return HttpResponse.json({ message: 'x' }, { status: 500 })
      keys.add(params.key as string)
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${API}/:key`, async ({ params }) => {
      calls.push(`DELETE ${params.key}`)
      await delay(200)
      if (opts.fail) return HttpResponse.json({ message: 'x' }, { status: 500 })
      keys.delete(params.key as string)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/import`, async ({ request }) => {
      const body = (await request.json()) as { projectKeys: string[] }
      calls.push(`IMPORT ${body.projectKeys.join(',')}`)
      body.projectKeys.filter((k) => k !== 'GONE').forEach((k) => keys.add(k))
      return HttpResponse.json({ projectKeys: [...keys] })
    }),
  )
  return { keys, calls }
}

/** 같은 QueryClient·인증 값으로 감싸는 래퍼 — 두 훅을 같은 캐시에 붙이려면 같은 래퍼를 쓴다. */
function wrapperFor(auth: AuthContextValue = testAuthValue) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    )
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('useProjectFavorites (WP-1001)', () => {
  test('서버 목록을 보여 주고, 서버가 비어 있어도 이 기기 값이 없으면 이관하지 않는다', async () => {
    const api = favoritesApi(['ENG', 'OPS'])
    const { result } = renderHook(() => useProjectFavorites(), { wrapper: wrapperFor() })
    await waitFor(() => expect([...result.current.favs]).toEqual(['ENG', 'OPS']))
    expect(result.current.isFav('ENG')).toBe(true)
    expect(result.current.isFav('WEB')).toBe(false)
    expect(api.calls).toEqual(['GET'])
  })

  test('서버가 비어 있고 이 기기에 예전 값이 있으면 한 번 올리고 로컬 키를 지운다', async () => {
    localStorage.setItem(LEGACY, JSON.stringify(['ENG', 'GONE']))
    // 다른 사용자·예전 브라우저 단위 키는 올리지 않고 건드리지도 않는다.
    localStorage.setItem('project-favorites:99:1', JSON.stringify(['OTHER']))
    const api = favoritesApi([])
    const { result } = renderHook(() => useProjectFavorites(), { wrapper: wrapperFor() })
    await waitFor(() => expect([...result.current.favs]).toEqual(['ENG']))
    expect(api.calls).toEqual(['GET', 'IMPORT ENG,GONE'])
    expect(localStorage.getItem(LEGACY)).toBeNull()
    expect(localStorage.getItem('project-favorites:99:1')).not.toBeNull()
  })

  test('서버에 이미 즐겨찾기가 있으면 이 기기에만 있던 것만 합쳐 올리고 로컬 키를 지운다', async () => {
    localStorage.setItem(LEGACY, JSON.stringify(['ENG', 'OLD']))
    const api = favoritesApi(['ENG'])
    const { result } = renderHook(() => useProjectFavorites(), { wrapper: wrapperFor() })
    await waitFor(() => expect([...result.current.favs].sort()).toEqual(['ENG', 'OLD']))
    expect(api.calls).toEqual(['GET', 'IMPORT OLD'])
    expect(localStorage.getItem(LEGACY)).toBeNull()
  })

  test('이 기기 값이 모두 서버에 있으면 올리지 않고 로컬 키만 지운다', async () => {
    localStorage.setItem(LEGACY, JSON.stringify(['ENG']))
    const api = favoritesApi(['ENG', 'OPS'])
    const { result } = renderHook(() => useProjectFavorites(), { wrapper: wrapperFor() })
    await waitFor(() => expect(result.current.favs.size).toBe(2))
    expect(api.calls).toEqual(['GET'])
    expect(localStorage.getItem(LEGACY)).toBeNull()
  })

  test('이관이 실패하면 로컬 키를 남겨 다음 조회에서 다시 시도한다', async () => {
    localStorage.setItem(LEGACY, JSON.stringify(['ENG']))
    favoritesApi([])
    server.use(http.post(`${API}/import`, () => HttpResponse.json({ message: 'x' }, { status: 500 })))
    const { result } = renderHook(() => useProjectFavorites(), { wrapper: wrapperFor() })
    await waitFor(() => expect(localStorage.getItem(LEGACY)).not.toBeNull())
    expect(result.current.favs.size).toBe(0)
  })

  test('토글은 key 하나씩 추가·해제를 보내고, 같은 캐시를 보는 다른 구독자에도 바로 보인다', async () => {
    const api = favoritesApi(['ENG'])
    const wrapper = wrapperFor()
    const { result } = renderHook(() => ({ a: useProjectFavorites(), b: useProjectFavorites() }), { wrapper })
    await waitFor(() => expect(result.current.a.isFav('ENG')).toBe(true))

    act(() => result.current.a.toggle('WEB'))
    // 낙관 반영 — 응답 전에 두 구독자 모두에 보인다.
    await waitFor(() => expect(result.current.b.isFav('WEB')).toBe(true))
    expect([...api.keys]).not.toContain('WEB')
    await waitFor(() => expect([...api.keys]).toContain('WEB'))

    act(() => result.current.b.toggle('ENG'))
    await waitFor(() => expect(result.current.a.isFav('ENG')).toBe(false))
    await waitFor(() => expect(api.calls).toContain('DELETE ENG'))
    await waitFor(() => expect([...api.keys]).toEqual(['WEB']))
    // 앞서 한 즐겨찾기(WEB)는 뒤 토글이 덮어쓰지 않는다 — 집합 전체를 보내지 않으므로.
    await waitFor(() => expect([...result.current.a.favs]).toEqual(['WEB']))
  })

  test('저장에 실패하면 서버 상태로 되돌린다', async () => {
    const api = favoritesApi(['ENG'], { fail: true })
    const { result } = renderHook(() => useProjectFavorites(), { wrapper: wrapperFor() })
    await waitFor(() => expect(result.current.isFav('ENG')).toBe(true))
    act(() => result.current.toggle('WEB'))
    await waitFor(() => expect(result.current.isFav('WEB')).toBe(true))
    await waitFor(() => expect(result.current.isFav('WEB')).toBe(false))
    expect(api.calls).toContain('PUT WEB')
  })

  test('첫 조회가 끝나기 전의 누르기는 무시한다 — 무엇이 즐겨찾기인지 몰라 추가·해제를 정할 수 없다', async () => {
    const api = favoritesApi(['ENG'])
    // 첫 조회를 늦춰 「아직 모름」 상태를 만든다.
    server.use(
      http.get(API, async () => {
        api.calls.push('GET')
        await delay(200)
        return HttpResponse.json({ projectKeys: [...api.keys] })
      }),
    )
    const { result } = renderHook(() => useProjectFavorites(), { wrapper: wrapperFor() })
    act(() => result.current.toggle('ENG'))
    await waitFor(() => expect(result.current.isFav('ENG')).toBe(true))
    expect(api.calls).toEqual(['GET'])
  })

  test('로그인 전에는 조회하지 않고 빈 집합이며, 토글해도 요청이 없다', async () => {
    const api = favoritesApi(['ENG'])
    const { result } = renderHook(() => useProjectFavorites(), {
      wrapper: wrapperFor({ ...testAuthValue, user: null, activeTenant: null, isAuthenticated: false }),
    })
    act(() => result.current.toggle('ENG'))
    expect(result.current.favs.size).toBe(0)
    expect(api.calls).toEqual([])
  })
})
