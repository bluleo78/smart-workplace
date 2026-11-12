/**
 * 로그아웃·로그인 때 업로드 큐를 토큰보다 먼저 끊는지 (WP-1534).
 *
 * 로그아웃은 푸시 정리(최대 3초)·서버 로그아웃을 기다린 뒤 토큰을 비우고, 로그인은 새 토큰을 깐 뒤에야 user 가 다시 그려진다.
 * user id effect 만으로 큐를 끊으면 그 틈에 남은 파일이 빈 토큰이나 다음 사용자의 토큰으로 나간다. 그래서 AuthProvider 가
 * 토큰을 건드리기 전에 신원 바뀜을 알리고, DriveUploadProvider 가 그 자리에서 끊는지를 본다.
 * 네트워크는 vi.mock 으로 끊어 기다리는 시점을 테스트가 쥔다(푸시 정리를 붙잡아 「아직 토큰이 있을 때」를 만든다).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { authApi } from '@/api/auth'
import { getAccessToken, setAccessToken } from '@/api/client'
import { usersApi } from '@/api/users'
import { type DriveUploadContextValue, useDriveUpload } from '@/components/drive/upload/driveUploadContext'
import { DriveUploadProvider } from '@/components/drive/upload/DriveUploadProvider'
import type { AuthContextValue } from '@/hooks/auth-context-value'
import { useAuth } from '@/hooks/useAuth'
import { onIdentityChange } from '@/lib/auth/identityChange'
import { clearPushOnLogout } from '@/lib/push/subscription'
import { files } from '@/pages/drive/uploadTestUtils'

import { AuthProvider } from './AuthContext'

vi.mock('@/api/auth', () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), memberships: vi.fn(), selectTenant: vi.fn(), signup: vi.fn() },
}))
vi.mock('@/api/users', () => ({ usersApi: { getMe: vi.fn() } }))
vi.mock('@/lib/push/subscription', () => ({ clearPushOnLogout: vi.fn() }))

const ROOT = { sid: 1, folderId: 1 }

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function setup() {
  const signals: AbortSignal[] = []
  // 업로드는 끝나지 않는다 — 끊겼는지(signal)만 본다.
  const upload = vi.fn((_r: unknown, _f: unknown, _file: File, signal: AbortSignal) => {
    signals.push(signal)
    return new Promise(() => {})
  })
  const queue: { current: DriveUploadContextValue | null } = { current: null }
  const auth: { current: AuthContextValue | null } = { current: null }
  function Probe() {
    queue.current = useDriveUpload()
    auth.current = useAuth()
    return null
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <DriveUploadProvider upload={upload as never} resolveFolder={async () => 1}>
          <Probe />
        </DriveUploadProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { signals, queue, auth }
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  setAccessToken(null)
  vi.clearAllMocks()
})

describe('신원 바뀜에 업로드 큐 끊기 (WP-1534)', () => {
  test('로그아웃을 시작하면 토큰을 비우기 전에 업로드를 끊는다', async () => {
    const t = setup()
    await flush()
    setAccessToken('old-token')
    // 푸시 정리를 붙잡아 둔다 — 그동안 토큰은 아직 남아 있다.
    let releasePush!: () => void
    vi.mocked(clearPushOnLogout).mockReturnValue(new Promise<void>((r) => (releasePush = r)))
    vi.mocked(authApi.logout).mockResolvedValue(undefined as never)
    act(() => {
      t.queue.current!.start(files(2), ROOT)
    })
    await flush()
    expect(t.signals).toHaveLength(1)

    let done!: Promise<void>
    act(() => {
      done = t.auth.current!.logout()
    })
    // 로그아웃이 아직 기다리는 중(토큰 그대로)인데 업로드는 이미 끊겼다.
    expect(getAccessToken()).toBe('old-token')
    expect(t.signals[0].aborted).toBe(true)
    await flush()
    expect(t.queue.current!.batch).toBeNull()
    // 대기 중이던 두 번째 파일이 나가지 않는다.
    expect(t.signals).toHaveLength(1)

    releasePush()
    await act(async () => {
      await done
    })
    expect(getAccessToken()).toBeNull()
    expect(t.signals).toHaveLength(1)
  })

  test('로그인은 새 토큰을 깔기 전에 이전 큐를 끊는다', async () => {
    const t = setup()
    await flush()
    setAccessToken('old-token')
    act(() => {
      t.queue.current!.start(files(1), ROOT)
    })
    await flush()
    // 알림 순간의 토큰을 적어 둔다 — 아직 이전 토큰이어야 한다.
    const seen: Array<string | null> = []
    const off = onIdentityChange(() => seen.push(getAccessToken()))
    vi.mocked(authApi.login).mockResolvedValue({
      data: { accessToken: 'new-token', memberships: [{ tenantId: 1, tenantName: '회사', tenantSlug: 'co' }] },
    } as never)
    vi.mocked(usersApi.getMe).mockResolvedValue({
      data: { id: 2, username: 'bob', email: null, name: '밥', isActive: true, createdAt: '2026-01-01T00:00:00Z', kind: 'HUMAN', aiAvailable: true, hasPassword: true, roles: [] },
    } as never)
    try {
      await act(async () => {
        await t.auth.current!.login({ username: 'bob', password: 'pw' })
      })
      expect(seen).toEqual(['old-token'])
      expect(t.signals[0].aborted).toBe(true)
      expect(getAccessToken()).toBe('new-token')
      expect(t.queue.current!.batch).toBeNull()
    } finally {
      off()
    }
  })
})
