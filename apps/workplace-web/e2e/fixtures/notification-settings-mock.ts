// e2e/fixtures/notification-settings-mock.ts
// 알림 설정 API mock(WP-913) — GET/PUT 을 한 핸들러가 상태로 처리해, PUT 의 apps·cells 가 이후 GET(새로고침)에 반영된다.
// auth.fixture 의 GET 기본 스텁 위에 나중에 등록되므로(LIFO) 이쪽이 우선한다.
import type { Page } from '@playwright/test'

import type { NotificationSettings, UpdateNotificationSettingsRequest } from '../../src/types/notificationSettings'
import { defaultNotificationSettings } from '../factories/notificationSettings.factory'

export const NOTIFICATION_SETTINGS_PATH = '/api/v1/notification-settings'

/** PUT 본문을 상태에 반영 — 서버처럼 칸 값은 앱 스위치와 따로 보존한다. */
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

export async function mockNotificationSettings(page: Page, initial: NotificationSettings = defaultNotificationSettings()) {
  let state = initial
  await page.route(`**${NOTIFICATION_SETTINGS_PATH}`, async (route) => {
    const method = route.request().method()
    if (method === 'PUT') state = apply(state, route.request().postDataJSON() as UpdateNotificationSettingsRequest)
    else if (method !== 'GET') return route.fallback()
    await route.fulfill({ json: state })
  })
  /** 다음 설정 PUT 요청 대기 — 클릭 전에 호출해 Promise 를 잡아 둔다. */
  const nextSettingsPut = () =>
    page.waitForRequest((r) => new URL(r.url()).pathname === NOTIFICATION_SETTINGS_PATH && r.method() === 'PUT')
  return { nextSettingsPut }
}
