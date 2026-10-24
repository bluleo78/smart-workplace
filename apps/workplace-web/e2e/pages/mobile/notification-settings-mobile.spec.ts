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

  // WP-935 — 카드 머리에도 데스크톱처럼 「앱 전체」 글자를 스위치 왼쪽에 둔다. 스위치 중심은 아래 AI 열 칸 스위치와 같은 x.
  test('카드 머리에 「앱 전체」 글자가 스위치 왼쪽에 보이고, 글자를 눌러도 스위치가 바뀌며, 스위치는 AI 열과 줄을 맞춘다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    const { nextSettingsPut } = await mockNotificationSettings(page)
    await page.goto('/settings/notifications')

    const issue = page.getByTestId('notif-app-ISSUE')
    const label = issue.getByText('앱 전체', { exact: true })
    await expect(label).toBeVisible()
    const appToggle = page.getByTestId('notif-app-toggle-ISSUE')
    const [labelBox, toggleBox, cellBox] = await Promise.all([
      label.boundingBox(),
      appToggle.boundingBox(),
      page.getByTestId('notif-cell-ISSUE_ASSIGNED-AGENT').boundingBox(),
    ])
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(toggleBox!.x)
    expect(Math.abs(toggleBox!.x + toggleBox!.width / 2 - (cellBox!.x + cellBox!.width / 2))).toBeLessThanOrEqual(1)
    // 글자는 낭독에서 빠지고 스위치 이름으로 듣는다.
    await expect(appToggle).toHaveAccessibleName('이슈 앱 전체')

    // 「앱 전체」 글자는 스위치의 label — 글자를 눌러도 앱 스위치가 바뀐다.
    const put = nextSettingsPut()
    await label.click()
    expect((await put).postDataJSON()).toEqual({ apps: { ISSUE: false } })
    await expect(appToggle).toHaveAttribute('aria-checked', 'false')

    // 가장 좁은 폭(320px)에서도 가로로 넘치지 않는다.
    await page.setViewportSize({ width: 320, height: 640 })
    await expect(label).toBeVisible()
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
