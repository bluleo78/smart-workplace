// 모바일 입력창 자동 확대 방지 — iOS Safari 는 글자 크기 16px 미만인 입력 요소에 포커스하면 화면을 확대해
// 레이아웃이 깨진다. 터치 기기(pointer: coarse)에선 편집 가능한 요소가 모두 16px 이상이어야 한다.
import { stubChannelMessages } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'

test('채널 메시지 입력창(contenteditable)은 터치 기기에서 16px 이상 — 포커스 시 iOS 자동 확대 방지', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  await page.goto('/chat/channels/1')
  const input = page.getByTestId('message-composer-input')
  await expect(input).toBeVisible()
  // testid 는 편집 노드(contenteditable) 자체에 붙는다 — iOS 는 포커스되는 요소의 글자 크기로 판단한다.
  await expect(input).toHaveAttribute('contenteditable', 'true')
  const size = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(size).toBeGreaterThanOrEqual(16)
})
