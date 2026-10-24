// 모바일 설정 › 알림(WP-913) — 열 머리는 「사람·AI」로 줄고, 앱 카드는 접고 펼친다(처음엔 이슈만 펼침).
// 앱 스위치는 펼침 버튼 바깥 형제라 스위치를 눌러도 펼침이 바뀌지 않는다.
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockNotificationSettings } from '../../fixtures/notification-settings-mock'
import { mockPushApis } from '../../fixtures/push-mock'

test.describe('모바일 알림 설정', () => {
  test('열 머리는 사람·AI 로 줄고 이슈 카드만 펼쳐져 있다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    await mockNotificationSettings(page)
    await page.goto('/settings/notifications')

    const issue = page.getByTestId('notif-app-ISSUE')
    await expect(issue.getByTestId('notif-col-HUMAN')).toHaveText('사람')
    await expect(issue.getByTestId('notif-col-AGENT')).toHaveText('AI')
    await expect(page.getByTestId('notif-app-expand-ISSUE')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('notif-app-expand-CHAT')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('notif-cell-CHAT_DM-HUMAN')).toBeHidden()
    await expectNoHorizontalOverflow(page)
  })

  test('카드를 누르면 펼쳐지고, 앱 스위치를 눌러도 펼침은 그대로다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    const { nextSettingsPut } = await mockNotificationSettings(page)
    await page.goto('/settings/notifications')

    await page.getByTestId('notif-app-expand-CHAT').click()
    await expect(page.getByTestId('notif-cell-CHAT_DM-HUMAN')).toBeVisible()
    // 채팅 안내(푸시로만 알림)는 펼친 카드 첫 줄에 보인다.
    await expect(page.getByTestId('notif-app-note-CHAT')).toBeVisible()

    const put = nextSettingsPut()
    await page.getByTestId('notif-app-toggle-CALENDAR').click()
    expect((await put).postDataJSON()).toEqual({ apps: { CALENDAR: false } })
    await expect(page.getByTestId('notif-app-toggle-CALENDAR')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('notif-app-expand-CALENDAR')).toHaveAttribute('aria-expanded', 'false')
  })
})
