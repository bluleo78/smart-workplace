// 설정 › 알림(NotificationSettingsPage) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 앱별 「사람이 / AI가」 매트릭스(WP-913)의 기본값·칸 하나만 저장하는 payload·앱 전체 끄기(칸 잠금·되살림)·채팅 카드 안내·
// 서버 푸시 비활성 안내와 그래도 저장되는 매트릭스·화면 참고(WP-1508)는 브라우저 없이 판정되므로
// e2e/pages/settings/notification-settings.spec.ts 에서 옮겼다.
// 기기 푸시 구독(SW·PushManager·권한, @platform)·저장 중 키보드 초점(@input)·새로고침 뒤 유지 배선(@wiring)은 E2E 에 남는다.
// 서버 푸시는 끈 상태(enabled=false)로 띄운다 — 기기 구독 경로(서비스워커)를 타지 않고 매트릭스만 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { currentScreenContext, withScreenContextProbe } from '@/test/kits/ai/ScreenContextProbe'
import { expectHelpTarget } from '@/test/kits/help/expectHelpTarget'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { NotificationSettings, UpdateNotificationSettingsRequest } from '@/types/notificationSettings'

import { defaultNotificationSettings } from '../../../e2e/factories/notificationSettings.factory'
import NotificationSettingsPage from './NotificationSettingsPage'
import { withAssistant } from './testkit-b7'

/** PUT 본문을 상태에 반영 — 서버처럼 칸 값은 앱 스위치와 따로 보존한다(e2e/fixtures/notification-settings-mock 과 같은 규칙). */
function apply(state: NotificationSettings, req: UpdateNotificationSettingsRequest): NotificationSettings {
  return {
    apps: state.apps.map((a) => ({
      ...a,
      enabled: req.apps?.[a.app] ?? a.enabled,
      items: a.items.map((it) => {
        const next = { ...it }
        for (const c of req.cells ?? []) {
          if (c.item !== it.item) continue
          if (c.actor === 'HUMAN') next.human = c.enabled
          else next.agent = c.enabled
        }
        return next
      }),
    })),
  }
}

/** 알림 화면을 띄운다 — 설정 PUT 본문은 puts 에 쌓이고 상태에 반영돼 응답으로 돌아간다. */
async function openNotifications() {
  let state = defaultNotificationSettings()
  const puts: UpdateNotificationSettingsRequest[] = []
  const view = renderScreen(withAssistant(<NotificationSettingsPage />), {
    path: '/settings/notifications',
    handlers: [
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
      http.get('/api/v1/notification-settings', () => HttpResponse.json(state)),
      http.put('/api/v1/notification-settings', async ({ request }) => {
        const body = (await request.json()) as UpdateNotificationSettingsRequest
        puts.push(body)
        state = apply(state, body)
        return HttpResponse.json(state)
      }),
    ],
  })
  await screen.findByTestId('notif-settings-matrix')
  return { ...view, puts }
}

const cell = (id: string) => screen.getByTestId(`notif-cell-${id}`)

// WP-913 — 기본값(AI 가 나를 할당·사람이 바꾼 상태 변경은 꺼짐), AI 작업 알림엔 「사람이」 칸이 없고, 칸 하나를 바꾸면 그 칸만 PUT 한다.
test('칸 기본값을 그리고, 칸을 바꾸면 그 칸만 저장한다 (WP-913)', async () => {
  const { user, puts } = await openNotifications()
  expect(cell('ISSUE_ASSIGNED-AGENT')).toHaveAttribute('aria-checked', 'false')
  expect(cell('ISSUE_STATUS_CHANGED-HUMAN')).toHaveAttribute('aria-checked', 'false')
  expect(screen.queryByTestId('notif-cell-ISSUE_AI_NEEDS_INPUT-HUMAN')).not.toBeInTheDocument()

  await user.click(cell('ISSUE_COMMENTED-AGENT'))
  await waitFor(() => expect(puts).toEqual([{ cells: [{ item: 'ISSUE_COMMENTED', actor: 'AGENT', enabled: true }] }]))
  await waitFor(() => expect(cell('ISSUE_COMMENTED-AGENT')).toHaveAttribute('aria-checked', 'true'))
})

// 채팅은 알림 목록에 쌓이지 않고 푸시로만 알려 화면 위 공통 안내와 달라, 채팅 카드에만 안내를 둔다.
test('채팅 카드에만 푸시로만 알린다는 안내가 있다', async () => {
  await openNotifications()
  expect(within(screen.getByTestId('notif-app-CHAT')).getByTestId('notif-app-note-CHAT')).toHaveTextContent(
    '채팅은 알림 목록에 쌓이지 않고 푸시로만 알려요. 꺼도 메시지와 안 읽음 표시는 채팅에 그대로 있어요.',
  )
  expect(within(screen.getByTestId('notif-app-ISSUE')).queryByTestId(/^notif-app-note-/)).not.toBeInTheDocument()
})

test('앱 전체를 끄면 그 앱 칸이 꺼진 채 잠기고 다시 켜면 돌아온다 (WP-913)', async () => {
  const { user, puts } = await openNotifications()
  const assigned = cell('ISSUE_ASSIGNED-HUMAN')
  expect(assigned).toHaveAttribute('aria-checked', 'true')

  await user.click(screen.getByTestId('notif-app-toggle-ISSUE'))
  await waitFor(() => expect(puts).toEqual([{ apps: { ISSUE: false } }]))
  await waitFor(() => expect(cell('ISSUE_ASSIGNED-HUMAN')).toHaveAttribute('aria-checked', 'false'))
  expect(cell('ISSUE_ASSIGNED-HUMAN')).toBeDisabled()
  // 다른 앱 칸은 그대로다.
  expect(cell('CHAT_DM-HUMAN')).toHaveAttribute('aria-checked', 'true')

  await waitFor(() => expect(screen.getByTestId('notif-app-toggle-ISSUE')).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(screen.getByTestId('notif-app-toggle-ISSUE'))
  await waitFor(() => expect(puts).toHaveLength(2))
  expect(puts[1]).toEqual({ apps: { ISSUE: true } })
  // 칸 값은 서버에 보존돼 있어 앱을 다시 켜면 원래 값으로 돌아온다.
  await waitFor(() => expect(cell('ISSUE_ASSIGNED-HUMAN')).toHaveAttribute('aria-checked', 'true'))
  expect(cell('ISSUE_ASSIGNED-HUMAN')).toBeEnabled()
})

// WP-913: 알림 종류 설정은 푸시가 아니라 알림 자체를 끄고 켜므로, 서버 푸시가 꺼져 있어도 보이고 저장된다.
test('서버가 푸시 비활성이어도 안내와 함께 알림 매트릭스가 보이고 저장된다 (WP-913)', async () => {
  const { user, puts } = await openNotifications()
  expect(await screen.findByTestId('push-disabled-notice')).toBeInTheDocument()
  expect(screen.queryByTestId('push-device-toggle')).not.toBeInTheDocument()

  await user.click(cell('CHAT_DM-AGENT'))
  await waitFor(() => expect(cell('CHAT_DM-AGENT')).toHaveAttribute('aria-checked', 'false'))
  expect(puts).toEqual([{ cells: [{ item: 'CHAT_DM', actor: 'AGENT', enabled: false }] }])
})

// WP-1508 — 칸을 만지면 도움말 패널이 여는 절은 가장 가까운 [data-help] 조상의 값이다. 푸시가 꺼진 서버의 안내 섹션도 이 기기 절이다.
test('칸이 맞는 도움말 절로 이어진다 — 푸시가 꺼진 서버면 안내 섹션이 이 기기 절로 (WP-1508)', async () => {
  // 푸시가 켜진 서버 — 이 기기 섹션과 스위치가 이 기기 절이다.
  const on = renderScreen(<NotificationSettingsPage />, {
    path: '/settings/notifications',
    handlers: [
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: true, vapidPublicKey: 'key' })),
      http.get('/api/v1/notification-settings', () => HttpResponse.json(defaultNotificationSettings())),
    ],
  })
  expectHelpTarget(await screen.findByRole('heading', { level: 2, name: '이 기기' }), 'notifications.device')
  expectHelpTarget(await screen.findByTestId('push-device-toggle'), 'notifications.device')
  expectHelpTarget(screen.getByRole('heading', { level: 2, name: '알림 종류' }), 'notifications.types')
  on.unmount()
  // 푸시가 꺼진 서버 — 「이 기기」 섹션 대신 안내 섹션이 같은 절로 이어진다.
  await openNotifications()
  expectHelpTarget(await screen.findByRole('heading', { level: 2, name: '푸시 알림을 사용할 수 없습니다' }), 'notifications.device')
  expect(screen.queryByRole('heading', { name: '이 기기' })).not.toBeInTheDocument()
})

// 설정 가이드 대신 매뉴얼 대표 절 요약이 AI 화면 참고에 실린다.
test('가이드 없이 화면 참고에 「설정 · 알림」과 매뉴얼 설명이 실린다 (WP-1508)', async () => {
  renderScreen(withScreenContextProbe(<NotificationSettingsPage />), {
    path: '/settings/notifications',
    handlers: [
      ...helpBundleHandlers(),
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: true, vapidPublicKey: 'key' })),
      http.get('/api/v1/notification-settings', () => HttpResponse.json(defaultNotificationSettings())),
      ...shellHandlers,
    ],
  })
  await screen.findByTestId('notif-settings-matrix')
  await waitFor(() => expect(currentScreenContext()?.scope?.facts).toContainEqual({ label: '소개', value: '알림 본문.' }))
  expect(currentScreenContext()!.view).toBe('설정 · 알림')
  const facts = currentScreenContext()!.scope!.facts!
  expect(facts).toContainEqual({ label: '이 기기', value: '이 기기 본문.' })
  expect(facts).toContainEqual({ label: '푸시 알림(서버)', value: '사용 가능' })
})
