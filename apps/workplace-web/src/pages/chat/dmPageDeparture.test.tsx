// DM 나가기(WP-1677)·숨기기(WP-1676) 직후 「대화를 찾을 수 없습니다」 깜빡임 회귀 테스트.
//
// 원인: BrowserRouter 는 navigate('/chat') 를 startTransition 으로 그린다 — 주소는 곧바로 /chat 이 되지만 새 화면이 커밋되기 전까지
// 옛 화면(DmPage)이 그대로 남는다. 그 사이 나가기·숨기기 무효화(또는 서버 SSE dm/updated)로 다시 받은 DM 목록(그 DM 이 빠진)이
// 도착하면, 목록 갱신은 급한 업데이트라 전환을 앞질러 옛 DmPage 를 다시 그리고 → 「대화 없음」이 잠깐 커밋된다.
// 라이브(vite 개발 빌드)는 전환 렌더가 느려 이 순서가 매번 나지만, jsdom 은 전환이 목록 재조회보다 먼저 끝나 dmPage.test 의
// MutationObserver 테스트로는 잡히지 않았다. 여기서는 /chat 첫 화면(ChannelListPage)을 잠시 멈춰(Suspense) 전환이 끝나지 않은 채
// DM 목록 재조회가 먼저 도착하는 라이브 순서를 그대로 만든다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { use } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { messagingKeys } from '@/hooks/queries/messagingKeys'
import { API, renderChat } from '@/test/kits/chat/testkit-b5'
import { testAuthValue } from '@/test/renderWithProviders'
import type { DmResponse } from '@/types/messaging'

import { createChannel, createDm, createDmParticipant } from '../../../e2e/factories/messaging.factory'

// /chat 첫 화면을 멈추는 문 — hold 가 있으면 그 promise 가 풀릴 때까지 Suspense 로 멈춘다(전환이 커밋되지 않는다).
const gate = vi.hoisted(() => ({ hold: null as Promise<void> | null }))

vi.mock('@/pages/chat/ChannelListPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/chat/ChannelListPage')>()
  const Actual = actual.default
  // 문이 닫혀 있으면 멈추고, 열려 있으면 원래 화면을 그린다.
  function GatedChannelListPage() {
    if (gate.hold) use(gate.hold)
    return <Actual />
  }
  return { default: GatedChannelListPage }
})

const auth = { user: { ...testAuthValue.user!, name: '테스트 사용자' } }

/** 문을 닫고 여는 함수를 돌려준다. */
function closeGate() {
  let release: () => void = () => {}
  gate.hold = new Promise<void>((resolve) => {
    release = () => {
      gate.hold = null
      resolve()
    }
  })
  return () => release()
}

/** dm-not-found 가 DOM 에 한 번이라도 붙었는지 기록한다(잠깐 떴다 사라지는 것까지). */
function watchNotFound() {
  const seen = { value: false }
  const observer = new MutationObserver(() => {
    if (document.querySelector('[data-testid="dm-not-found"]')) seen.value = true
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return { seen, stop: () => observer.disconnect() }
}

/**
 * 나가기·숨기기 요청이 오면 DM 목록에서 그 DM 을 빼는(서버와 같은) DM 하나를 연다.
 * respondAfter 를 주면 목록에서는 곧바로 빼되 응답(204)은 그 promise 가 풀린 뒤에 돌려준다 — SSE 가 응답보다 먼저 오는 순서.
 */
function openDepartingDm(dm: DmResponse, action: 'leave' | 'hide', respondAfter?: Promise<void>) {
  let dms = [dm]
  const path = action === 'leave' ? `${API}/messaging/channels/:id/leave` : `${API}/messaging/dms/:id/hide`
  return renderChat(`/chat/dms/${dm.id}`, {
    auth,
    channels: [],
    handlers: [
      http.get(`${API}/messaging/dms`, () => HttpResponse.json(dms)),
      http.get(`${API}/messaging/channels/${dm.id}`, () => HttpResponse.json(createChannel({ id: dm.id, kind: 'DM', member: true }))),
      http.post(path, async () => {
        dms = []
        if (respondAfter) await respondAfter
        return new HttpResponse(null, { status: 204 })
      }),
    ],
    messages: { [dm.id]: [] },
  })
}

const GROUP = createDm({
  id: 940,
  participants: [
    createDmParticipant({ userId: 1, name: '테스트 사용자' }),
    createDmParticipant({ userId: 2, name: '가' }),
    createDmParticipant({ userId: 3, name: '나' }),
  ],
})
const ONE = createDm({ id: 941, participants: [createDmParticipant({ userId: 1, name: '테스트 사용자' }), createDmParticipant({ userId: 2, name: '김민준' })] })

describe('DM 나가기·숨기기 직후 대화 없음 깜빡임(WP-1677)', () => {
  afterEach(() => {
    gate.hold = null
  })

  test('그룹 DM 나가기 — /chat 전환이 끝나기 전에 DM 목록이 다시 와도 대화 없음이 한 번도 붙지 않는다', async () => {
    const watch = watchNotFound()
    const release = closeGate()
    try {
      const { user, queryClient } = openDepartingDm(GROUP, 'leave')
      await user.click(within(await screen.findByTestId('dm-header')).getByRole('button', { name: '대화 메뉴' }))
      await user.click(await screen.findByTestId('dm-leave-action'))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '나가기' }))
      // 주소는 이미 /chat 이지만 전환은 멈춰 있다 — 그 사이 나간 DM 이 빠진 목록이 도착한다(라이브 순서).
      await waitFor(() => expect(window.location.pathname).toBe('/chat'))
      await waitFor(() => expect(queryClient.getQueryData<DmResponse[]>(messagingKeys.dms())).toEqual([]))
      // 급한 업데이트(목록 갱신)가 반영될 틈을 준다.
      await new Promise((r) => setTimeout(r, 50))
      expect(watch.seen.value).toBe(false)
      // 전환이 끝나기 전에는 마지막으로 본 대화가 그대로 남는다(빈 화면·대화 없음으로 바뀌지 않는다).
      expect(screen.getByTestId('dm-header')).toBeInTheDocument()
      release()
      expect(await screen.findByTestId('channel-empty')).toBeInTheDocument()
      expect(watch.seen.value).toBe(false)
    } finally {
      release()
      watch.stop()
    }
  })

  test('DM 숨기기 — /chat 전환이 끝나기 전에 DM 목록이 다시 와도 대화 없음이 한 번도 붙지 않는다', async () => {
    const watch = watchNotFound()
    const release = closeGate()
    try {
      const { user, queryClient } = openDepartingDm(ONE, 'hide')
      await user.click(within(await screen.findByTestId('dm-header')).getByRole('button', { name: '대화 메뉴' }))
      await user.click(await screen.findByTestId('dm-hide-action'))
      await waitFor(() => expect(window.location.pathname).toBe('/chat'))
      await waitFor(() => expect(queryClient.getQueryData<DmResponse[]>(messagingKeys.dms())).toEqual([]))
      await new Promise((r) => setTimeout(r, 50))
      expect(watch.seen.value).toBe(false)
      // 전환이 끝나기 전에는 마지막으로 본 대화가 그대로 남는다(빈 화면·대화 없음으로 바뀌지 않는다).
      expect(screen.getByTestId('dm-header')).toBeInTheDocument()
      release()
      expect(await screen.findByTestId('channel-empty')).toBeInTheDocument()
      expect(watch.seen.value).toBe(false)
    } finally {
      release()
      watch.stop()
    }
  })

  // 서버는 나가기 때 행위자에게도 dm/updated SSE 를 보낸다 — 그 재조회가 leave 응답(204)보다 먼저 끝나도
  // 대화 없음이 붙지 않고, 헤더가 남아 있어 응답 뒤 /chat 이동(mutate onSuccess)이 끊기지 않는다.
  test('그룹 DM 나가기 — DM 목록 재조회(SSE)가 나가기 응답보다 먼저 와도 대화 없음 없이 /chat 으로 간다', async () => {
    const watch = watchNotFound()
    let respond: () => void = () => {}
    const responded = new Promise<void>((resolve) => {
      respond = resolve
    })
    try {
      const { user, queryClient, location } = openDepartingDm(GROUP, 'leave', responded)
      await user.click(within(await screen.findByTestId('dm-header')).getByRole('button', { name: '대화 메뉴' }))
      await user.click(await screen.findByTestId('dm-leave-action'))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '나가기' }))
      // SSE dm/updated 와 같은 무효화 — 나간 DM 이 빠진 목록이 응답보다 먼저 도착한다.
      await waitFor(() => expect(queryClient.isMutating()).toBe(1))
      await queryClient.invalidateQueries({ queryKey: messagingKeys.dms() })
      expect(queryClient.getQueryData<DmResponse[]>(messagingKeys.dms())).toEqual([])
      // 목록 갱신이 화면에 반영될 틈을 준다(관찰자 알림은 다음 틱에 묶여 온다).
      await new Promise((r) => setTimeout(r, 50))
      expect(watch.seen.value).toBe(false)
      expect(screen.getByTestId('dm-header')).toBeInTheDocument()
      respond()
      await waitFor(() => expect(location()).toBe('/chat'))
      expect(await screen.findByTestId('channel-empty')).toBeInTheDocument()
      expect(watch.seen.value).toBe(false)
    } finally {
      respond()
      watch.stop()
    }
  })

  // 화면을 열기 전에 이미 목록에 없던 DM(다른 곳에서 숨기거나 나간 DM)은 그대로 「대화 없음」이다.
  test('예전에 나간 DM 을 다시 열면 대화 없음이 보인다', async () => {
    const { user, queryClient } = openDepartingDm(GROUP, 'leave')
    await user.click(within(await screen.findByTestId('dm-header')).getByRole('button', { name: '대화 메뉴' }))
    await user.click(await screen.findByTestId('dm-leave-action'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '나가기' }))
    expect(await screen.findByTestId('channel-empty')).toBeInTheDocument()
    // 같은 탭에서 나간 DM 주소로 다시 들어간다 — 그 나가기는 이번 화면을 열기 전의 일이다.
    await waitFor(() => expect(queryClient.getQueryData<DmResponse[]>(messagingKeys.dms())).toEqual([]))
    window.history.pushState(null, '', `/chat/dms/${GROUP.id}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByTestId('dm-not-found')).toBeInTheDocument()
  })
})
