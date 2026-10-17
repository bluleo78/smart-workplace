// 「새 소식」(WP-439) — 사용자 메뉴의 새 소식 항목·안 읽음 점·릴리스 노트 창(데스크톱).
// 노트는 E2E 빌드에 번들된 픽스처(e2e/fixtures/releases: 0.8.0·0.9.0·0.9.1[hidden])이고, 실행 버전은 playwright.config 의 APP_VERSION=0.9.0 이다.
import { expect, test } from '../fixtures/auth.fixture'

const SEEN_KEY = 'genia.whatsNew.lastSeenVersion'

test('첫 방문 — 아바타에 점이 보이고 메뉴 항목에 버전과 점이 보인다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('rail-user-avatar-dot')).toBeVisible()
  await page.getByTestId('rail-user-menu').click()
  const item = page.getByTestId('whats-new-menu-item')
  await expect(item).toContainText('새 소식')
  await expect(item).toContainText('v0.9.0')
  await expect(item.getByTestId('whats-new-dot')).toBeVisible()
  // 커밋은 7자리만 툴팁(title)으로.
  await expect(item).toHaveAttribute('title', /a5d66d0/)
})

test('메뉴 순서 — 프로필 → 새 소식 → 테마 전환 → 로그아웃', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await page.getByTestId('rail-user-menu').click()
  const names = await page.getByRole('menuitem').evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
  expect(names[0]).toContain('프로필')
  expect(names[1]).toContain('새 소식')
  expect(names[2]).toContain('테마 전환')
  expect(names[3]).toContain('로그아웃')
})

test('새 소식 항목 — 현재 버전 노트와 접힌 이전 소식, 하단 버전·커밋을 보여준다(숨김 노트는 없음)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  await page.getByTestId('rail-user-menu').click()
  await page.getByTestId('whats-new-menu-item').click()
  const dialog = page.getByTestId('whats-new-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('한글 문서를 바로 미리볼 수 있습니다')
  await expect(dialog).toContainText('2026-10-10')
  await expect(dialog).toContainText('버전 v0.9.0 (a5d66d0)')
  // 이전 소식은 접혀 있다가 펼치면 보인다.
  await expect(dialog.getByText('이전 기능')).toBeHidden()
  await dialog.getByTestId('whats-new-previous-0.8.0').click()
  await expect(dialog.getByText('이전 기능')).toBeVisible()
  // 숨김 노트(0.9.1)는 어디에도 없다.
  await expect(dialog.getByTestId('whats-new-previous-0.9.1')).toHaveCount(0)
  await expect(dialog.getByText('아직 공개하지 않는 노트')).toHaveCount(0)
})

test('창을 열었다 닫으면 새로고침 후에도 점이 없다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await page.getByTestId('rail-user-menu').click()
  await page.getByTestId('whats-new-menu-item').click()
  await expect(page.getByTestId('whats-new-dialog')).toBeVisible()
  // 열린 순간 확인 처리 — 아바타 점은 바로 사라진다.
  await expect(page.getByTestId('rail-user-avatar-dot')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('whats-new-dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('rail-user-menu')).toBeVisible()
  await expect(page.getByTestId('rail-user-avatar-dot')).toHaveCount(0)
  await page.getByTestId('rail-user-menu').click()
  await expect(page.getByTestId('whats-new-menu-item')).toBeVisible()
  await expect(page.getByTestId('whats-new-dot')).toHaveCount(0)
})

test('이미 현재 버전을 본 브라우저는 처음부터 점이 없다', async ({ authenticatedPage: page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '0.9.0'), SEEN_KEY)
  await page.goto('/')
  await expect(page.getByTestId('rail-user-menu')).toBeVisible()
  await expect(page.getByTestId('rail-user-avatar-dot')).toHaveCount(0)
  await page.getByTestId('rail-user-menu').click()
  await expect(page.getByTestId('whats-new-menu-item')).toBeVisible()
  await expect(page.getByTestId('whats-new-dot')).toHaveCount(0)
})

test('Esc 로 닫으면 포커스가 사용자 메뉴 트리거로 돌아온다 (#708)', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  const trigger = page.getByTestId('rail-user-menu')
  await trigger.click()
  await page.getByTestId('whats-new-menu-item').click()
  const dialog = page.getByTestId('whats-new-dialog')
  await expect(dialog).toBeVisible()
  // 열릴 때 포커스는 창 자체에 둔다(이전 소식 토글에 포커스 링이 처음부터 뜨지 않게) — 그래도 복원 대상은 메뉴를 연 트리거다.
  await expect(dialog).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
