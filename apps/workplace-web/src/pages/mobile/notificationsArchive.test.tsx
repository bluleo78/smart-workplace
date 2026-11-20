// 모바일 /notifications 「알림 | 보관함」 전환(WP-1690) — 페이지 테스트.
// 탭 루트 머리(MobileListHeader)와 푸시 화면 머리(MobileDetailBar) 둘 다에 전환이 있고,
// 보관함으로 바꾸면 머리의 모두 읽음·읽은 알림 보관이 숨으며, 줄의 되돌리기가 unarchive 를 보내는지 본다.
// 머리 한 줄에 넘치지 않는 기하(@layout)는 브라우저가 필요해 E2E 에 남는다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'

import { renderMobileScreen } from '@/test/kits/mobile/mobileScreen'
// 알림 1건(읽음 — 보관 가능한 줄) 기본값은 알림 창 테스트와 같은 공유 도우미를 쓴다(WP-1844).
import { notif } from '@/test/kits/notifications/inboxTestKit'
import { mockViewport } from '@/test/viewport'

import NotificationsPage from '../NotificationsPage'

mockViewport()

/** 알림 화면을 모바일로 띄운다. 탭 루트로 보려면 탭바 슬롯에 알림을 넣어 둔다. */
function renderNotifications(opts: { tabRoot: boolean; unread?: boolean }) {
  if (opts.tabRoot) localStorage.setItem('mobile-tabs', JSON.stringify(['notifications', 'home', 'chat', 'mail', 'calendar']))
  const unarchived: number[][] = []
  const view = renderMobileScreen(<NotificationsPage />, {
    path: '/notifications',
    handlers: [
      http.get('/api/v1/notifications', () => HttpResponse.json([notif({ id: 1, read: !opts.unread })])),
      http.get('/api/v1/notifications/archived', () => HttpResponse.json([notif({ id: 5, issueTitle: '보관된 이슈' })])),
      http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: opts.unread ? 1 : 0 })),
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
      http.post('/api/v1/notifications/read-all', () => new HttpResponse(null, { status: 204 })),
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

  // WP-1845 — 모두 읽음 뒤 버튼이 disabled 되어 포커스가 BODY 로 떨어지지 않도록 목록 영역으로 옮긴다.
  test('모바일 머리 모두 읽음 뒤 포커스가 목록 영역으로 간다', async () => {
    const { user } = renderNotifications({ tabRoot: false, unread: true })
    await screen.findAllByTestId('inbox-item')
    const button = screen.getByTestId('inbox-mark-all')
    button.focus()
    await user.click(button)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('inbox-scroll-area')))
    expect(await screen.findByText('읽음 처리했습니다')).toBeInTheDocument()
  })

  test('보관함에서 되돌리기를 누르면 unarchive 요청을 보낸다', async () => {
    const { user, unarchived } = renderNotifications({ tabRoot: false })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    await screen.findByText(/보관된 이슈/)
    await user.click(screen.getByTestId('inbox-unarchive'))
    await waitFor(() => expect(unarchived).toEqual([[5]]))
  })

  // WP-1731 — 360px 미만에서 글자 버튼이 아이콘 버튼으로 바뀌어도 접근 이름·툴팁은 그대로여야 한다(jsdom 은 폭을 못 재므로 마크업만 본다).
  test.each([
    { label: '탭 루트', tabRoot: true, headerId: 'mobile-list-header' },
    { label: '푸시 화면', tabRoot: false, headerId: 'notifications-header' },
  ])('좁은 폭 대비: $label 머리 두 액션은 접근 이름·툴팁이 그대로이고 아이콘을 품는다', async ({ tabRoot, headerId }) => {
    renderNotifications({ tabRoot })
    await screen.findAllByTestId('inbox-item')
    const header = screen.getByTestId(headerId)
    expect(tabRoot ? screen.queryByTestId('notifications-header') : screen.queryByTestId('mobile-list-header')).toBeNull()
    for (const name of ['모두 읽음', '읽은 알림 보관']) {
      const button = screen.getByRole('button', { name })
      expect(header).toContainElement(button)
      expect(button).toHaveAttribute('title', name)
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
  })

  // WP-1731 — 제목은 sr-only(시각적으로만 숨김)라 h1 과 접근 이름이 남는다. 액션이 없는 보관함 보기에서는 숨기지 않는다.
  test.each([
    { label: '탭 루트', tabRoot: true, title: () => screen.getByRole('heading', { name: '알림' }) },
    { label: '푸시 화면', tabRoot: false, title: () => screen.getByTestId('mobile-back-title') },
  ])('좁은 폭 대비: $label 제목은 360px 미만에 시각적으로만 숨고 보관함에서는 보인다', async ({ tabRoot, title }) => {
    const { user } = renderNotifications({ tabRoot })
    await screen.findAllByTestId('inbox-item')
    expect(title().className).toContain('max-[360px]:sr-only')
    await user.click(screen.getByTestId('inbox-tab-archive'))
    await screen.findByText(/보관된 이슈/)
    expect(title().className).not.toContain('sr-only')
  })
})
