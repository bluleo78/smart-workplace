// 「새 소식」(WP-439) — 사용자 메뉴의 새 소식 항목·안 읽음 점·릴리스 노트 창(데스크톱).
// 메뉴 순서·창 내용(현재 노트·접힌 이전 소식·숨김 노트 없음)·이미 본 브라우저의 점 없음·열면 점이 꺼짐은
// 화면 컴포넌트 테스트 src/components/layout/appRail.test.tsx 가 지킨다(WP-971). 여기에는 빌드 상수(버전·커밋) 배선(@wiring),
// 새로고침 뒤 유지(@platform), 닫을 때 포커스 복원(@input)만 남긴다.
// 노트는 E2E 빌드에 번들된 픽스처(e2e/fixtures/releases: 0.8.0·0.9.0·0.9.1[hidden])이고, 실행 버전은 playwright.config 의 APP_VERSION=0.9.0 이다.
import { expect, test } from '../fixtures/auth.fixture'

test('첫 방문 — 아바타에 점이 보이고 메뉴 항목·창에 빌드 버전과 커밋이 보인다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('rail-user-avatar-dot')).toBeVisible()
  await page.getByTestId('rail-user-menu').click()
  const item = page.getByTestId('whats-new-menu-item')
  await expect(item).toContainText('새 소식')
  await expect(item).toContainText('v0.9.0')
  await expect(item.getByTestId('whats-new-dot')).toBeVisible()
  // 커밋은 7자리만 툴팁(title)으로.
  await expect(item).toHaveAttribute('title', /a5d66d0/)
  // 창 하단 버전·커밋 — 실행 버전(APP_VERSION=0.9.0)의 노트가 번들에서 골라져 열린다.
  await item.click()
  const dialog = page.getByTestId('whats-new-dialog')
  await expect(dialog).toContainText('한글 문서를 바로 미리볼 수 있습니다')
  await expect(dialog).toContainText('버전 v0.9.0 (a5d66d0)')
})

test('창을 열었다 닫으면 새로고침 후에도 점이 없다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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

test('Esc 로 닫으면 포커스가 사용자 메뉴 트리거로 돌아온다 (#708)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
