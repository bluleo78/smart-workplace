// 모바일 설정 › 알림(WP-913) — 열 머리는 「사람·AI」로 줄고, 앱 카드는 접고 펼친다(처음엔 이슈만 펼침).
// 여기엔 기하만 남긴다(@layout) — 「앱 전체」 글자·스위치 정렬과 좁은 폭 가로 넘침.
// 열 머리 문구·처음 펼침 상태, 글자·스위치 PUT payload, 펼침과 스위치의 독립은 src/pages/mobile/notificationSettingsMobile.test.tsx 가 지킨다(WP-981).
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockNotificationSettings } from '../../fixtures/notification-settings-mock'
import { mockPushApis } from '../../fixtures/push-mock'

test.describe('모바일 알림 설정', { tag: '@layout' }, () => {
  test('390px 에서 카드 목록이 가로로 넘치지 않는다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    await mockNotificationSettings(page)
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('notif-app-ISSUE').getByTestId('notif-col-HUMAN')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  // WP-935 — 카드 머리에도 데스크톱처럼 「앱 전체」 글자를 스위치 왼쪽에 둔다. 스위치 중심은 아래 AI 열 칸 스위치와 같은 x.
  test('카드 머리의 「앱 전체」 글자는 스위치 왼쪽에 있고, 스위치는 AI 열과 줄을 맞추며, 320px 에서도 넘치지 않는다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    await mockNotificationSettings(page)
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

    // 가장 좁은 폭(320px)에서도 가로로 넘치지 않는다.
    await page.setViewportSize({ width: 320, height: 640 })
    await expect(label).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
