// 모바일 설정 › 알림(WP-913) — 페이지 테스트(WP-981).
// 열 머리 「사람·AI」 문구, 처음 펼침 상태(이슈만), 카드 펼침과 앱 스위치가 서로 독립인 것·스위치 payload 는
// 브라우저 없이 판정되므로 e2e/pages/mobile/notification-settings-mobile.spec.ts 에서 옮겼다.
// 「앱 전체」 글자·스위치 정렬과 320px 가로 넘침(@layout)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 알림 설정 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { defaultNotificationSettings } from '../../../e2e/factories/notificationSettings.factory'
import NotificationSettingsPage from '../settings/NotificationSettingsPage'

mockViewport()

/** 알림 설정 화면 — 푸시 설정(켜짐)과 종류별 설정. PUT 본문은 puts 에 쌓고 그대로 반영해 돌려준다. */
function open() {
  const puts: unknown[] = []
  let settings = defaultNotificationSettings()
  const page = renderMobileRoute('/settings/notifications', <NotificationSettingsPage />, {
    path: '/settings/notifications',
    handlers: [
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: true, vapidPublicKey: 'B' + 'A'.repeat(86) })),
      http.get('/api/v1/notification-settings', () => HttpResponse.json(settings)),
      http.put('/api/v1/notification-settings', async ({ request }) => {
        const body = (await request.json()) as { apps?: Record<string, boolean> }
        puts.push(body)
        // 서버처럼 앱 스위치만 바꿔 돌려준다(칸 값은 보존).
        settings = { apps: settings.apps.map((a) => ({ ...a, enabled: body.apps?.[a.app] ?? a.enabled })) }
        return HttpResponse.json(settings)
      }),
    ],
  })
  return { ...page, puts }
}

describe('모바일 알림 설정', () => {
  test('열 머리는 사람·AI 로 줄고 이슈 카드만 펼쳐져 있다', async () => {
    open()
    const issue = await screen.findByTestId('notif-app-ISSUE')
    expect(within(issue).getByTestId('notif-col-HUMAN')).toHaveTextContent(/^사람$/)
    expect(within(issue).getByTestId('notif-col-AGENT')).toHaveTextContent(/^AI$/)
    expect(screen.getByTestId('notif-app-expand-ISSUE')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('notif-app-expand-CHAT')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('notif-cell-CHAT_DM-HUMAN')).not.toBeInTheDocument()
  })

  test('「앱 전체」 글자는 스위치의 label — 글자를 눌러도 앱 스위치가 바뀌고, 스위치 이름은 「이슈 앱 전체」', async () => {
    const { user, puts } = open()
    const issue = await screen.findByTestId('notif-app-ISSUE')
    const appToggle = screen.getByTestId('notif-app-toggle-ISSUE')
    expect(appToggle).toHaveAccessibleName('이슈 앱 전체')
    await user.click(within(issue).getByText('앱 전체', { exact: true }))
    await waitFor(() => expect(puts).toEqual([{ apps: { ISSUE: false } }]))
    await waitFor(() => expect(appToggle).toHaveAttribute('aria-checked', 'false'))
  })

  test('카드를 누르면 펼쳐지고, 앱 스위치를 눌러도 펼침은 그대로다', async () => {
    const { user, puts } = open()
    await user.click(await screen.findByTestId('notif-app-expand-CHAT'))
    expect(await screen.findByTestId('notif-cell-CHAT_DM-HUMAN')).toBeInTheDocument()
    // 채팅 안내(푸시로만 알림)는 펼친 카드 첫 줄에 보인다.
    expect(screen.getByTestId('notif-app-note-CHAT')).toBeInTheDocument()

    await user.click(screen.getByTestId('notif-app-toggle-CALENDAR'))
    await waitFor(() => expect(puts).toEqual([{ apps: { CALENDAR: false } }]))
    await waitFor(() => expect(screen.getByTestId('notif-app-toggle-CALENDAR')).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByTestId('notif-app-expand-CALENDAR')).toHaveAttribute('aria-expanded', 'false')
  })
})
