/**
 * initAuth 가 첫 refresh 끝남 신호를 주는 때 (WP-2087).
 *
 * 첫 주소 청크 미리 받기(App)는 이 신호를 기다린다 — 성공·실패·로그인 흔적 없음 어느 쪽이든 신호가 와야 미리 받기가 시작된다.
 * 성공 경로는 users/me 를 붙잡아 두고도 신호가 먼저 오는지(= refresh 직후) 확인한다.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { authApi } from '@/api/auth'
import { setAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { writeActiveTenant } from '@/lib/activeTenant'
import { AUTH_FLAG_KEY } from '@/lib/auth/sessionFlag'
import { afterInitialRefresh, resetAuthBootForTest } from '@/lib/authBoot'

import { AuthProvider } from './AuthContext'
import { resetInitialIssuePrefetchForTest } from './useInitialIssuePrefetch'

vi.mock('@/api/auth', () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), memberships: vi.fn(), selectTenant: vi.fn(), signup: vi.fn() },
}))
vi.mock('@/api/users', () => ({ usersApi: { getMe: vi.fn() } }))
const detailFetch = vi.fn()
vi.mock('./queries/useIssue', () => ({
  issueDetailQuery: (projectKey: string, number: number) => ({
    queryKey: ['issue-test', projectKey, number],
    queryFn: () => detailFetch(projectKey, number),
    retry: false,
  }),
}))
vi.mock('@/lib/push/subscription', () => ({ clearPushOnLogout: vi.fn() }))

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

/** 다음 매크로태스크까지 기다린다 — 신호 구독자는 setTimeout 0 으로 불린다. */
async function nextTask() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** 테스트가 건 구독(안전망 타이머 포함)의 취소 함수 — afterEach 에서 모두 불러 타이머가 다른 테스트로 새지 않게 한다. */
const cancels: Array<() => void> = []

/** 신호를 기다리는 구독을 걸고, 불렸는지 보는 함수를 돌려준다(안전망 타이머는 길게 둬 신호만 본다). */
function watchSignal() {
  const cb = vi.fn()
  cancels.push(afterInitialRefresh(cb, 60_000))
  return cb
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <div />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetAuthBootForTest()
  resetInitialIssuePrefetchForTest()
  detailFetch.mockReset()
  detailFetch.mockResolvedValue({})
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  // 대비(fallback) 타이머 정리 — 60초 타이머가 남으면 다른 테스트로 새거나 프로세스를 붙잡는다.
  for (const cancel of cancels.splice(0)) cancel()
  setAccessToken(null)
  vi.clearAllMocks()
})

/** tenant 클레임만 가진 JWT 모양 토큰(서명 검증은 하지 않는다). */
function jwtWithTenant(tenant: number) {
  return `h.${btoa(JSON.stringify({ tenant }))}.s`
}

/**
 * 세션 흔적이 있는 첫 로드를 꾸민다 — token 으로 refresh 가 성공하고, stored 가 있으면 활성 테넌트로 보관한다.
 * users/me 는 끝나지 않게 붙잡아 「그 동안」을 볼 수 있게 한다. 주소는 이슈 상세.
 */
function setup({ token, stored }: { token: string; stored?: number }) {
  localStorage.setItem(AUTH_FLAG_KEY, 'true')
  if (stored !== undefined) writeActiveTenant({ tenantId: stored, name: 't', slug: 't' } as never)
  window.history.pushState({}, '', '/projects/WP/issues/7')
  vi.mocked(authApi.refresh).mockResolvedValue({ data: { accessToken: token } } as never)
  vi.mocked(usersApi.getMe).mockReturnValue(new Promise(() => {}) as never)
}

describe('initAuth 첫 refresh 끝남 신호 (WP-2087)', () => {
  test.each([
    ['initAuth_signalsWithoutSessionHint', () => {}, false],
    [
      'initAuth_signalsAfterRefreshFailure',
      () => {
        localStorage.setItem(AUTH_FLAG_KEY, 'true')
        vi.mocked(authApi.refresh).mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }))
      },
      true,
    ],
  ])('%s', async (_name, arrange, refreshes) => {
    arrange()
    const cb = watchSignal()
    mount()
    await flush()
    await nextTask()
    expect(vi.mocked(authApi.refresh).mock.calls.length > 0).toBe(refreshes)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('initAuth_signalsAfterRefreshSuccess', async () => {
    setup({ token: 'opaque-token' })
    const cb = watchSignal()
    mount()
    await flush()
    expect(usersApi.getMe).toHaveBeenCalled()
    await nextTask()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('initAuth_sendsMembershipsBeforeDeferredPreloadStarts', async () => {
    // 테넌트가 다른 토큰 — memberships 요청이 미리 받기(신호 뒤 다음 작업)보다 먼저 나간다.
    setup({ token: jwtWithTenant(9), stored: 5 })
    const order: string[] = []
    vi.mocked(authApi.memberships).mockImplementation((() => {
      order.push('memberships')
      return new Promise(() => {})
    }) as never)
    cancels.push(afterInitialRefresh(() => order.push('preload'), 60_000))
    mount()
    await flush()
    await nextTask()
    expect(order).toEqual(['memberships', 'preload'])
  })
})

describe('initAuth 이슈 상세 미리 요청 (WP-2087)', () => {
  test('initAuth_prefetchesDetailBeforeUsersMe', async () => {
    setup({ token: 'opaque-token', stored: 5 })
    mount()
    await flush()
    // users/me 는 끝나지 않는다 — 그 동안에도 상세 요청이 이미 나가 있어야 한다.
    expect(usersApi.getMe).toHaveBeenCalled()
    expect(detailFetch).toHaveBeenCalledTimes(1)
    expect(detailFetch).toHaveBeenCalledWith('WP', 7)
  })

  test('initAuth_prefetchesWhenTenantClaimMatchesStored', async () => {
    setup({ token: jwtWithTenant(5), stored: 5 })
    mount()
    await flush()
    expect(detailFetch).toHaveBeenCalledTimes(1)
  })

  test('initAuth_skipsPrefetchWhenTenantClaimDiffers', async () => {
    setup({ token: jwtWithTenant(9), stored: 5 })
    vi.mocked(authApi.memberships).mockReturnValue(new Promise(() => {}) as never)
    mount()
    await flush()
    expect(detailFetch).not.toHaveBeenCalled()
  })

  test('initAuth_skipsEarlyPrefetchWithoutStoredTenant', async () => {
    setup({ token: 'opaque-token' })
    mount()
    await flush()
    expect(usersApi.getMe).toHaveBeenCalled()
    expect(detailFetch).not.toHaveBeenCalled()
  })
})
