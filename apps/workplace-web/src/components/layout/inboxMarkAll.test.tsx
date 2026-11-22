// 알림 창 「모두 읽음」 완료·실패 토스트(WP-1845) — InboxList 제목 행 버튼으로 본다.
// InboxList 만 renderScreen 으로 띄우고, MSW 로 알림·카운트·모두 읽음 API 를 모킹한다.
import { act, screen, waitFor } from '@testing-library/react'
import { http, type HttpHandler,HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'

import { InboxList, type InboxView } from '@/components/layout/InboxList'
import { renderScreen } from '@/test/renderScreen'
import type { NotificationResponse } from '@/types/notification'

/** 알림 1건 — inboxArchive.test.tsx 와 같은 기본값(안 읽음). */
function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 9,
    actorName: '업무 비서',
    actorKind: 'AGENT',
    issueId: 7,
    projectKey: 'WP',
    issueNumber: 3,
    issueTitle: '리팩터링',
    commentId: 55,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

/** 모두 읽음 성공 뒤 포커스 판정(rAF 한 번 + 매크로태스크 한 번)이 끝날 때까지 기다린다 — 「옮기지 않음」 단언이 판정 전에 통과하지 않게. */
async function afterRefocusCheck() {
  await new Promise((r) => requestAnimationFrame(() => r(undefined)))
  await new Promise((r) => setTimeout(r, 20))
}

/** InboxList 는 보기 상태를 바깥이 들고 있어야 해서(제어 전용), 상태만 쥐는 얇은 래퍼로 띄운다. */
function InboxHarness() {
  const [view, setView] = useState<InboxView>('inbox')
  return <InboxList enabled view={view} onViewChange={setView} screenEmpty={false} />
}

/**
 * InboxList 를 띄운다. readAll 로 모두 읽음 핸들러를 갈아 끼울 수 있다(지연 핸들러 등 — 이후 테스트가 쓴다).
 */
function renderInbox(
  opts: { readAll?: HttpHandler; beforeReadAll?: () => Promise<void>; onReadAll?: () => void } = {},
) {
  // 기본 핸들러는 처리 뒤 안 읽음 수를 0 으로 돌려 실서버처럼 버튼이 disabled 되게 한다.
  // onReadAll 은 요청이 서버에 닿은 횟수를 세는 용도(WP-1961 — 같은 틱 연타가 실제로 두 요청인지 보인다).
  let allRead = false
  const readAll =
    opts.readAll ??
    http.post('/api/v1/notifications/read-all', async () => {
      opts.onReadAll?.()
      await opts.beforeReadAll?.()
      allRead = true
      return new HttpResponse(null, { status: 204 })
    })
  return renderScreen(<InboxHarness />, {
    path: '/',
    handlers: [
      http.get('/api/v1/notifications', () => HttpResponse.json([notif({ id: 1 }), notif({ id: 2 })])),
      http.get('/api/v1/notifications/archived', () => HttpResponse.json([])),
      http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: allRead ? 0 : 2 })),
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
      readAll,
    ],
  })
}

describe('알림 창 모두 읽음 토스트', () => {
  test('모두 읽음 성공 뒤 「읽음 처리했습니다」 토스트', async () => {
    const { user } = renderInbox()
    await screen.findAllByTestId('inbox-item')
    await user.click(screen.getByTestId('inbox-mark-all'))
    expect(await screen.findByText('읽음 처리했습니다')).toBeInTheDocument()
  })

  test('모두 읽음 실패(500)면 「읽음 처리하지 못했습니다」 토스트', async () => {
    const { user } = renderInbox({
      readAll: http.post('/api/v1/notifications/read-all', () => new HttpResponse(null, { status: 500 })),
    })
    await screen.findAllByTestId('inbox-item')
    await user.click(screen.getByTestId('inbox-mark-all'))
    expect(await screen.findByText('읽음 처리하지 못했습니다')).toBeInTheDocument()
    expect(screen.queryByText('읽음 처리했습니다')).not.toBeInTheDocument()
  })

  // 처리 중 잠금은 native disabled 가 아니라 aria-disabled — 브라우저가 포커스를 빼지 않아 실패 뒤에도 버튼에 그대로 남는다.
  test('처리 중엔 aria-disabled 이고 클릭을 무시하며, 실패 뒤 포커스가 버튼에 그대로 있다', async () => {
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderInbox({
      readAll: http.post('/api/v1/notifications/read-all', async () => {
        calls += 1
        await gate
        return new HttpResponse(null, { status: 500 })
      }),
    })
    await screen.findAllByTestId('inbox-item')
    const button = screen.getByTestId('inbox-mark-all')
    await user.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
    expect(button).toBeEnabled()
    await user.click(button)
    release()
    expect(await screen.findByText('읽음 처리하지 못했습니다')).toBeInTheDocument()
    expect(calls).toBe(1)
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
    expect(document.activeElement).toBe(button)
  })

  test('모두 읽음 뒤 포커스가 목록 영역으로 간다', async () => {
    const { user } = renderInbox()
    await screen.findAllByTestId('inbox-item')
    const button = screen.getByTestId('inbox-mark-all')
    button.focus()
    await user.click(button)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('inbox-scroll-area')))
    expect(button).toBeDisabled()
  })

  // 성공 사이 새 안 읽음이 와서 버튼이 여전히 눌리면 포커스를 버튼에 둔다 — 비활성이 된 때만 목록으로 옮긴다(WP-1845 리뷰).
  test('모두 읽음이 성공해도 안 읽음이 남아 버튼이 눌리면 포커스는 버튼에 그대로 있다', async () => {
    const { user } = renderInbox({
      // 처리는 성공하지만 안 읽음 수는 2 그대로(그 사이 새 알림이 온 상황) — 버튼이 disabled 되지 않는다.
      readAll: http.post('/api/v1/notifications/read-all', () => new HttpResponse(null, { status: 204 })),
    })
    await screen.findAllByTestId('inbox-item')
    const button = screen.getByTestId('inbox-mark-all')
    button.focus()
    await user.click(button)
    expect(await screen.findByText('읽음 처리했습니다')).toBeInTheDocument()
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
    // 성공 콜백의 판정(rAF 뒤 매크로태스크)이 지난 뒤에도 버튼에 남는지 본다.
    await afterRefocusCheck()
    expect(button).toBeEnabled()
    expect(document.activeElement).toBe(button)
  })

  // 같은 틱 연타는 React 가 isPending 을 다시 그리기 전이라 isPending 으로는 못 막는다 — 훅의 재진입 막기로 요청 한 번·토스트 한 장이어야 한다.
  // user.click 은 사이에 재렌더가 끼므로 쓰지 않고 native click 두 번을 같은 틱에 보낸다.
  test('같은 틱에 두 번 눌러도 요청은 한 번, 「읽음 처리했습니다」 토스트는 한 장(WP-1961)', async () => {
    let calls = 0
    renderInbox({ onReadAll: () => { calls += 1 } })
    await screen.findAllByTestId('inbox-item')
    const btn = screen.getByTestId('inbox-mark-all')
    // act 하나 안에서 두 번 — 사이에 다시 그리기가 끼지 않아 같은 틱 연타가 된다(apps/workplace-web/CLAUDE.md 「같은 틱에 두 번 클릭」).
    act(() => {
      btn.click()
      btn.click()
    })
    expect(await screen.findByText('읽음 처리했습니다')).toBeInTheDocument()
    await afterRefocusCheck()
    // 두 번째 클릭은 처리 중이라 버려져 요청이 한 번만 간다(막지 않으면 2 — 고치기 전 실패로 확인).
    expect(calls).toBe(1)
    expect(screen.getAllByText('읽음 처리했습니다')).toHaveLength(1)
  })

  test('처리 중 다른 곳에 포커스를 옮겼으면 빼앗지 않는다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderInbox({
      // 기본 핸들러를 gate 로 늦춘다 — 성공 뒤 안 읽음 수가 0 으로 바뀌어 버튼이 disabled 된다.
      beforeReadAll: () => gate,
    })
    await screen.findAllByTestId('inbox-item')
    await user.click(screen.getByTestId('inbox-mark-all'))
    const tab = screen.getByTestId('inbox-tab-archive')
    tab.focus()
    release()
    expect(await screen.findByText('읽음 처리했습니다')).toBeInTheDocument()
    // 토스트는 무효화·rAF 보다 먼저 뜬다 — 안 읽음 0 재조회가 끝나고 한 프레임 흘린 뒤에야 가드를 지나는지 볼 수 있다.
    await waitFor(() => expect(screen.getByTestId('inbox-mark-all')).toBeDisabled())
    await afterRefocusCheck()
    expect(document.activeElement).toBe(tab)
  })
})
