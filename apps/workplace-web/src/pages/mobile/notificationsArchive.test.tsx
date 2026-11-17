// 모바일 /notifications 「알림 | 보관함」 전환(WP-1690) — 페이지 테스트.
// 탭 루트 머리(MobileListHeader)와 푸시 화면 머리(MobileDetailBar) 둘 다에 전환이 있고,
// 보관함으로 바꾸면 머리의 모두 읽음·읽은 알림 보관이 숨으며, 줄의 되돌리기가 unarchive 를 보내는지 본다.
// 머리 한 줄에 넘치지 않는 기하(@layout)는 브라우저가 필요해 E2E 에 남는다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'

import { renderMobileScreen } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'
import type { NotificationResponse } from '@/types/notification'

import NotificationsPage from '../NotificationsPage'

mockViewport()

/** 알림 1건(읽음) — 보관 가능한 줄. */
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
    read: true,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

/** 알림 화면을 모바일로 띄운다. 탭 루트로 보려면 탭바 슬롯에 알림을 넣어 둔다. */
function renderNotifications(opts: { tabRoot: boolean }) {
  if (opts.tabRoot) localStorage.setItem('mobile-tabs', JSON.stringify(['notifications', 'home', 'chat', 'mail', 'calendar']))
  const unarchived: number[][] = []
  const view = renderMobileScreen(<NotificationsPage />, {
    path: '/notifications',
    handlers: [
      http.get('/api/v1/notifications', () => HttpResponse.json([notif({ id: 1 })])),
      http.get('/api/v1/notifications/archived', () => HttpResponse.json([notif({ id: 5, issueTitle: '보관된 이슈' })])),
      http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 })),
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
      http.post('/api/v1/notifications/unarchive', async ({ request }) => {
        const body = (await request.json()) as { ids: number[] }
        unarchived.push(body.ids)
        return HttpResponse.json({ restoredIds: body.ids })
      }),
    ],
  })
  return { ...view, unarchived }
}

describe('모바일 알림 화면 보관함 전환', () => {
  beforeEach(() => localStorage.clear())

  test('모바일 탭 루트 머리에 알림|보관함 전환이 있고 보관함으로 바꾸면 모두 읽음·읽은 알림 보관이 숨는다', async () => {
    const { user } = renderNotifications({ tabRoot: true })
    await screen.findAllByTestId('inbox-item')
    expect(screen.getByTestId('mobile-list-header')).toContainElement(screen.getByTestId('inbox-tab-archive'))
    expect(screen.getByTestId('inbox-mark-all')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-archive-read')).toBeInTheDocument()
    await user.click(screen.getByTestId('inbox-tab-archive'))
    expect(await screen.findByText(/보관된 이슈/)).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-mark-all')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbox-archive-read')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('inbox-tab-inbox'))
    expect(await screen.findByTestId('inbox-mark-all')).toBeInTheDocument()
  })

  test('푸시 화면(MobileDetailBar) 머리에도 같은 전환이 있다', async () => {
    const { user } = renderNotifications({ tabRoot: false })
    await screen.findAllByTestId('inbox-item')
    expect(screen.getByTestId('notifications-header')).toContainElement(screen.getByTestId('inbox-tab-archive'))
    await user.click(screen.getByTestId('inbox-tab-archive'))
    expect(await screen.findByText(/보관된 이슈/)).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-mark-all')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbox-archive-read')).not.toBeInTheDocument()
  })

  test('보관함에서 되돌리기를 누르면 unarchive 요청을 보낸다', async () => {
    const { user, unarchived } = renderNotifications({ tabRoot: false })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    await screen.findByText(/보관된 이슈/)
    await user.click(screen.getByTestId('inbox-unarchive'))
    await waitFor(() => expect(unarchived).toEqual([[5]]))
  })
})
