// useChatSession 의 owner(사용자·워크스페이스) effect 테스트(WP-1664).
// 첫 진입의 생성 중 대화 동기화는 SSE 첫 연결(useEventStream onOpen, 늦으면 대체 타이머)이 맡는다 — 여기서 또 부르면 GET /ai/chat/active 가 겹친다.
// owner effect 는 저장소 주인만 맞춘다(setOwner). owner 가 바뀌는 경로는 리로드·셸 재마운트라 새 SSE 연결이 다시 맞춘다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { type ReactNode, StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/chatStreamsSync', () => ({ resyncActiveChats: vi.fn(() => Promise.resolve()) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }))

import { resyncActiveChats } from '@/hooks/chatStreamsSync'
import { useAuth } from '@/hooks/useAuth'
import { useChatSession } from '@/hooks/useChatSession'
import { chatStreams } from '@/lib/ai/chatStreams'

type Who = { userId: number; tenantId: number } | null

/** 테스트용 인증 상태 — 훅이 읽는 user·activeTenant 만 채운다. */
function authOf(who: Who) {
  return (who
    ? { user: { id: who.userId }, activeTenant: { tenantId: who.tenantId } }
    : { user: null, activeTenant: null }) as unknown as ReturnType<typeof useAuth>
}

/** who 를 rerender 로 바꿀 수 있게 훅을 띄운다. strict 면 StrictMode 로 감싸 effect 를 두 번 돌린다. */
function renderSession(initial: Who, strict = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    return strict ? <StrictMode>{tree}</StrictMode> : tree
  }
  vi.mocked(useAuth).mockReturnValue(authOf(initial))
  const view = renderHook(({ who }: { who: Who }) => {
    // rerender 의 props 로 인증 상태를 바꾼다(실제 앱에서는 AuthContext 값이 바뀌는 자리).
    vi.mocked(useAuth).mockReturnValue(authOf(who))
    return useChatSession()
  }, { wrapper, initialProps: { who: initial } })
  return { ...view, rerenderWho: (who: Who) => view.rerender({ who }) }
}

describe('useChatSession owner effect (WP-1664)', () => {
  beforeEach(() => {
    vi.mocked(resyncActiveChats).mockClear()
    chatStreams.setOwner(null)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    // 저장소는 모듈 싱글턴이다 — 다음 테스트 파일로 owner 가 새지 않게 비운다.
    chatStreams.setOwner(null)
  })

  it('첫 마운트에서 owner 를 설정하지만 활성 대화 재동기화는 하지 않는다(SSE 첫 연결이 맡는다)', () => {
    const setOwner = vi.spyOn(chatStreams, 'setOwner')
    renderSession({ userId: 1, tenantId: 10 })
    expect(setOwner).toHaveBeenCalledWith('1:10')
    expect(resyncActiveChats).not.toHaveBeenCalled()
  })

  it('StrictMode 로 effect 가 두 번 돌아도 재동기화하지 않는다', () => {
    renderSession({ userId: 1, tenantId: 10 }, true)
    expect(resyncActiveChats).not.toHaveBeenCalled()
  })

  it('owner 가 A → B 로 바뀌면 저장소 주인만 바꾸고 재동기화하지 않는다', () => {
    const setOwner = vi.spyOn(chatStreams, 'setOwner')
    const view = renderSession({ userId: 1, tenantId: 10 })
    view.rerenderWho({ userId: 1, tenantId: 20 })
    expect(setOwner).toHaveBeenLastCalledWith('1:20')
    expect(resyncActiveChats).not.toHaveBeenCalled()
  })

  it('owner 가 A → null(로그아웃)이면 저장소만 비우고 재동기화하지 않는다', () => {
    const setOwner = vi.spyOn(chatStreams, 'setOwner')
    const view = renderSession({ userId: 1, tenantId: 10 })
    view.rerenderWho(null)
    expect(setOwner).toHaveBeenLastCalledWith(null)
    expect(resyncActiveChats).not.toHaveBeenCalled()
  })
})
