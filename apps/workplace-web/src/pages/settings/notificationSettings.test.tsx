// 설정 › 알림(NotificationSettingsPage) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 앱별 「사람이 / AI가」 매트릭스(WP-913)의 기본값·칸 하나만 저장하는 payload·앱 전체 끄기(칸 잠금·되살림)·채팅 카드 안내·
// 서버 푸시 비활성 안내와 그래도 저장되는 매트릭스·화면 참고(WP-1508)는 브라우저 없이 판정되므로
// e2e/pages/settings/notification-settings.spec.ts 에서 옮겼다.
// 기기 푸시 구독(SW·PushManager·권한, @platform)·저장 중 키보드 초점(@input)·새로고침 뒤 유지 배선(@wiring)은 E2E 에 남는다.
// 서버 푸시는 끈 상태(enabled=false)로 띄운다 — 기기 구독 경로(서비스워커)를 타지 않고 매트릭스만 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test, vi } from 'vitest'

import { currentScreenContext, withScreenContextProbe } from '@/test/kits/ai/ScreenContextProbe'
import { expectHelpTarget } from '@/test/kits/help/expectHelpTarget'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { MailAccountResponse } from '@/types/mailAccount'
import type { NotificationSettings, UpdateNotificationSettingsRequest } from '@/types/notificationSettings'

import { mailAccount } from '../../../e2e/factories/mail.factory'
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
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
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
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
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

// WP-1740 — 「메일」 절: 계정마다 새 메일 알림 범위(모든 새 메일/업무 메일만/끔)를 고른다.
// 이 기기 구독은 브라우저 API(SW)라 그 모듈만 목으로 갈아 subscribed 를 테스트마다 정한다.
const push = vi.hoisted(() => ({ subscribed: true, gate: null as Promise<void> | null }))
vi.mock('@/lib/push/subscription', async (orig) => {
  const actual = await orig<typeof import('@/lib/push/subscription')>()
  return { ...actual, currentSubscription: async () => {
      // gate 가 있으면 풀릴 때까지 조회가 끝나지 않는다(조회 중 상태 재현).
      if (push.gate) await push.gate
      return push.subscribed ? ({ endpoint: 'e' } as PushSubscription) : null
    },
  }
})

beforeEach(() => {
  push.subscribed = true
  push.gate = null
})

/** 공용 mailAccount 팩토리에 이 화면 테스트의 기본(a@x.com·AI 분류 켜짐)만 얹는다 — 안내 문구가 AI 켜짐을 전제로 판정된다. */
function account(over: Partial<MailAccountResponse>): MailAccountResponse {
  return mailAccount({ emailAddress: 'a@x.com', aiEnabled: true, ...over })
}

/** 푸시 서버 켜짐 + 메일 계정 목록으로 알림 화면을 띄운다. PATCH 는 patches 에 쌓인다(patch 로 응답을 바꾼다). */
function openMail(opts: { accounts: MailAccountResponse[]; pushEnabled?: boolean; patch?: (id: string) => Promise<Response> | Response }) {
  const patches: { url: string; body: unknown }[] = []
  // 서버처럼 PATCH 가 성공하면 목록 상태에 반영한다 — 저장 뒤 다시 불러온 목록이 새 값을 돌려준다.
  let current = opts.accounts
  let listGets = 0
  const view = renderScreen(withScreenContextProbe(<NotificationSettingsPage />), {
    path: '/settings/notifications',
    handlers: [
      ...helpBundleHandlers(),
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: opts.pushEnabled ?? true, vapidPublicKey: 'k' })),
      http.get('/api/v1/notification-settings', () => HttpResponse.json(defaultNotificationSettings())),
      http.get('/api/v1/mail/accounts', () => { listGets += 1; return HttpResponse.json(current) }),
      http.patch('/api/v1/mail/accounts/:id/notify-mode', async ({ request, params }) => {
        const body = (await request.json()) as { notifyMode: MailAccountResponse['notifyMode'] }
        patches.push({ url: new URL(request.url).pathname, body })
        const res = opts.patch ? await opts.patch(String(params.id)) : new HttpResponse(null, { status: 204 })
        if (res.ok) current = current.map((a) => (String(a.id) === params.id ? { ...a, notifyMode: body.notifyMode } : a))
        return res
      }),
      ...shellHandlers,
    ],
  })
  return { ...view, patches, listGets: () => listGets }
}

const radio = (id: number, mode: string) => screen.getByTestId(`mail-notify-${id}-${mode}`)

test('메일 계정마다 알림 범위를 보여 주고 고르면 그 계정만 저장한다 (WP-1740)', async () => {
  const { user, patches } = openMail({ accounts: [account({ id: 1, notifyMode: 'WORK' }), account({ id: 2, emailAddress: 'b@x.com', notifyMode: 'OFF' })] })
  await screen.findByTestId('mail-notify-section')
  expect(radio(1, 'WORK')).toHaveAttribute('aria-checked', 'true')
  expect(radio(2, 'OFF')).toHaveAttribute('aria-checked', 'true')
  await user.click(radio(1, 'ALL'))
  await waitFor(() => expect(patches).toEqual([{ url: '/api/v1/mail/accounts/1/notify-mode', body: { notifyMode: 'ALL' } }]))
  await waitFor(() => expect(radio(1, 'ALL')).toHaveAttribute('aria-checked', 'true'))
})

test('저장이 실패하면 이전 값으로 돌아간다 (WP-1740)', async () => {
  const { user } = openMail({ accounts: [account({ id: 1, notifyMode: 'WORK' })], patch: () => new HttpResponse(null, { status: 500 }) })
  await screen.findByTestId('mail-notify-section')
  await user.click(radio(1, 'ALL'))
  expect(await screen.findByText('메일 알림 범위를 바꾸지 못했어요')).toBeInTheDocument()
  await waitFor(() => expect(radio(1, 'WORK')).toHaveAttribute('aria-checked', 'true'))
})

test('저장 중에는 그 계정 라디오를 잠근다 (WP-1740)', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const { user } = openMail({
    accounts: [account({ id: 1 }), account({ id: 2, emailAddress: 'b@x.com' })],
    patch: async () => {
      await gate
      return new HttpResponse(null, { status: 204 })
    },
  })
  await screen.findByTestId('mail-notify-section')
  await user.click(radio(1, 'ALL'))
  await waitFor(() => expect(radio(1, 'OFF')).toBeDisabled())
  expect(radio(2, 'ALL')).toBeEnabled()
  release()
  await waitFor(() => expect(radio(1, 'OFF')).toBeEnabled())
})

test('한 계정을 저장하는 중에 다른 계정을 골라도 앞 계정은 계속 잠겨 있다 (WP-1740)', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const { user } = openMail({
    accounts: [account({ id: 1 }), account({ id: 2, emailAddress: 'b@x.com' })],
    patch: async () => {
      await gate
      return new HttpResponse(null, { status: 204 })
    },
  })
  await screen.findByTestId('mail-notify-section')
  await user.click(radio(1, 'ALL'))
  await waitFor(() => expect(radio(1, 'OFF')).toBeDisabled())
  await user.click(radio(2, 'ALL'))
  await waitFor(() => expect(radio(2, 'OFF')).toBeDisabled())
  expect(radio(1, 'OFF')).toBeDisabled()
  release()
  await waitFor(() => expect(radio(1, 'OFF')).toBeEnabled())
  await waitFor(() => expect(radio(2, 'OFF')).toBeEnabled())
})

// 겹친 저장 — A 가 먼저 끝나도 B 가 저장 중이면 목록을 다시 받지 않아 B 의 낙관적 값이 유지되고, 마지막이 끝나면 다시 받는다.
test('두 계정 저장이 겹쳐 앞 계정이 먼저 끝나도 뒤 계정 선택은 유지되고 마지막에 목록을 다시 받는다 (WP-1740)', async () => {
  const releases: Record<string, () => void> = {}
  const gates: Record<string, Promise<void>> = {
    '1': new Promise<void>((r) => (releases['1'] = r)),
    '2': new Promise<void>((r) => (releases['2'] = r)),
  }
  const { user, listGets } = openMail({
    accounts: [account({ id: 1 }), account({ id: 2, emailAddress: 'b@x.com' })],
    patch: async (id) => {
      await gates[id]
      return new HttpResponse(null, { status: 204 })
    },
  })
  await screen.findByTestId('mail-notify-section')
  await waitFor(() => expect(listGets()).toBe(1))
  await user.click(radio(1, 'ALL'))
  await user.click(radio(2, 'ALL'))
  await waitFor(() => expect(radio(2, 'OFF')).toBeDisabled())
  // A 만 먼저 끝난다 — A 잠금이 풀린 뒤에도 B 는 저장 중이고 B 의 새 값(ALL)이 그대로 보여야 한다.
  releases['1']()
  await waitFor(() => expect(radio(1, 'OFF')).toBeEnabled())
  expect(radio(2, 'OFF')).toBeDisabled()
  expect(radio(2, 'ALL')).toHaveAttribute('aria-checked', 'true')
  expect(listGets()).toBe(1)
  // B 까지 끝나면 그제야 목록을 한 번 다시 받고 두 계정 모두 새 값이다.
  releases['2']()
  await waitFor(() => expect(listGets()).toBe(2))
  await waitFor(() => expect(radio(2, 'OFF')).toBeEnabled())
  expect(radio(1, 'ALL')).toHaveAttribute('aria-checked', 'true')
  expect(radio(2, 'ALL')).toHaveAttribute('aria-checked', 'true')
})

test('AI 분류가 꺼진 계정의 업무 메일만에 안내가 보인다 (WP-1740)', async () => {
  openMail({
    accounts: [
      account({ id: 1, aiEnabled: false, notifyMode: 'WORK' }),
      account({ id: 2, emailAddress: 'b@x.com', aiEnabled: false, notifyMode: 'ALL' }),
    ],
  })
  await screen.findByTestId('mail-notify-section')
  expect(screen.getByTestId('mail-notify-ai-off-1')).toHaveTextContent('AI 분류가 꺼져 있어 모든 새 메일로 알려요.')
  expect(screen.queryByTestId('mail-notify-ai-off-2')).not.toBeInTheDocument()
})

test('이 기기 푸시가 꺼져 있으면 켜기 안내가 보인다 (WP-1740)', async () => {
  push.subscribed = false
  const off = openMail({ accounts: [account({ id: 1 })] })
  expect(await screen.findByTestId('mail-notify-push-off')).toBeInTheDocument()
  expect(screen.getByTestId('mail-notify-enable-push')).toBeInTheDocument()
  off.unmount()
  push.subscribed = true
  openMail({ accounts: [account({ id: 1 })] })
  await screen.findByTestId('mail-notify-section')
  // 기기 구독 조회가 끝나(스위치가 켜짐으로 바뀌어) 상태가 확정된 뒤에도 안내가 없어야 한다 — 조회 중 거짓 통과 방지.
  await waitFor(() => expect(screen.getByTestId('push-device-toggle')).toHaveAttribute('aria-checked', 'true'))
  expect(screen.queryByTestId('mail-notify-push-off')).not.toBeInTheDocument()
})

test('이 기기 구독 조회 중에는 켜기 안내를 보이지 않는다 (WP-1740)', async () => {
  let release!: () => void
  push.gate = new Promise<void>((r) => (release = r))
  openMail({ accounts: [account({ id: 1 })] })
  await screen.findByTestId('mail-notify-section')
  expect(screen.queryByTestId('mail-notify-push-off')).not.toBeInTheDocument()
  release()
  await waitFor(() => expect(screen.getByTestId('push-device-toggle')).toHaveAttribute('aria-checked', 'true'))
  expect(screen.queryByTestId('mail-notify-push-off')).not.toBeInTheDocument()
})

test('계정이 없거나 서버 푸시가 꺼져 있으면 메일 절이 없다 (WP-1740)', async () => {
  const none = openMail({ accounts: [] })
  await screen.findByRole('heading', { level: 2, name: '이 기기' })
  await waitFor(() => expect(screen.queryByTestId('mail-notify-section')).not.toBeInTheDocument())
  none.unmount()
  openMail({ accounts: [account({ id: 1 })], pushEnabled: false })
  await screen.findByTestId('push-disabled-notice')
  expect(screen.queryByTestId('mail-notify-section')).not.toBeInTheDocument()
})

test('메일 절이 도움말 notifications.mail 을 가리킨다 (WP-1740)', async () => {
  openMail({ accounts: [account({ id: 1 })] })
  expectHelpTarget(await screen.findByRole('heading', { level: 2, name: '메일' }), 'notifications.mail')
  expectHelpTarget(screen.getByTestId('mail-notify-1-ALL'), 'notifications.mail')
})
