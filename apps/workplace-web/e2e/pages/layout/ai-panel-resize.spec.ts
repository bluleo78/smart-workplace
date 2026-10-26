// AI 사이드 패널 폭 조절(WP-892) — 앱 목록과 같은 공용 손잡이 훅(hooks/useResizeHandle)으로 키보드·두 번 누르기·저장이 붙었는지 본다.
// 실제 키보드·포인터 입력으로 실제 폭(px)이 바뀌는지 보므로 @input 이다(WP-971).
// 마우스 끌기 자체는 global-chat.spec.ts(dragPanelHandle)가 본다. 손잡이는 패널 왼쪽 경계라 ← 가 넓히는 방향이다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'

test.use({ viewport: { width: 1440, height: 900 } })

/** 홈에서 AI 칩으로 사이드 패널을 연다. */
async function openSidePanel(page: Page) {
  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
}

const panelWidth = async (page: Page) => Math.round((await page.getByTestId('ai-side-panel').boundingBox())!.width)

test('Tab 으로 AI 패널 경계선을 잡아 ← 로 넓히고 Home·End 로 최소·최대, 저장해 다시 열어도 유지된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await openSidePanel(page)
  const handle = page.getByRole('separator', { name: 'AI 패널 폭 조절' })
  await expect(handle).toHaveAttribute('aria-valuenow', '380')

  await handle.focus()
  // 왼쪽 경계 손잡이 — ← 는 경계선을 왼쪽으로 옮겨 패널이 넓어진다.
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => panelWidth(page)).toBe(396)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => panelWidth(page)).toBe(364)
  await page.keyboard.press('End')
  await expect.poll(() => panelWidth(page)).toBe(600)
  await page.keyboard.press('Home')
  await expect.poll(() => panelWidth(page)).toBe(320)
  expect(await page.evaluate(() => localStorage.getItem('ai-side-width'))).toBe('320')

  // 다시 열어도 저장된 폭.
  await openSidePanel(page)
  await expect.poll(() => panelWidth(page)).toBe(320)
})

test('AI 패널 경계선을 두 번 누르면 기본 폭(380)으로 돌아가고, 움직이지 않은 클릭은 폭을 바꾸지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => localStorage.setItem('ai-side-width', '520'))
  await openSidePanel(page)
  await expect.poll(() => panelWidth(page)).toBe(520)
  const handle = page.getByTestId('ai-resize-handle')

  await handle.click()
  expect(await panelWidth(page)).toBe(520)
  expect(await page.evaluate(() => localStorage.getItem('ai-side-width'))).toBe('520')

  await handle.dblclick()
  await expect.poll(() => panelWidth(page)).toBe(380)
  expect(await page.evaluate(() => localStorage.getItem('ai-side-width'))).toBe('380')
})

test('끄는 도중 Esc 로 AI 패널이 닫혀도 커서·선택 막음이 풀리고 끈 폭이 저장된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await openSidePanel(page)
  const box = (await page.getByTestId('ai-resize-handle').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 40, y)
  await page.mouse.move(x - 80, y)
  await expect.poll(() => panelWidth(page)).toBe(460)
  expect(await page.evaluate(() => document.body.style.cursor)).toBe('col-resize')

  // 손잡이(와 패널)만 DOM 에서 빠지고 패널 컴포넌트는 남는다 — 손잡이 리스너만으론 끌기가 끝나지 않던 경우.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('ai-side-panel')).toBeHidden()
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => [document.body.style.cursor, document.body.style.userSelect, document.body.hasAttribute('data-panel-resizing')]))
    .toEqual(['', '', false])
  expect(await page.evaluate(() => localStorage.getItem('ai-side-width'))).toBe('460')
})
