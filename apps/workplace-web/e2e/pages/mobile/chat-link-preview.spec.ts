// WP-874 — 모바일(터치 셸) 팀 채팅 링크 미리보기: 위 이미지·아래 글 카드, 작성자 지우기는 길게 누르기 작업 시트에서.
import { expect, test } from '../../fixtures/mobile.fixture'
import { LONG_TITLE, stubLinkPreviewChannel } from '../../fixtures/link-preview-mock'
import { longPress } from '../../fixtures/mobile-chat'
import { expectNoHorizontalOverflow } from '../../fixtures/mobile.fixture'

test('카드는 이미지가 위·글이 아래, 화면 폭을 넘지 않는다', async ({ authenticatedPage: page }) => {
  const { images } = await stubLinkPreviewChannel(page)
  await page.goto('/chat/channels/1')

  const card = page.getByTestId('link-preview-10-0')
  await expect(card.getByTestId('link-preview-title-10-0')).toHaveText(LONG_TITLE)
  await images.waitFor()
  const image = card.getByTestId('link-preview-image-10-0')
  await expect(image.locator('img')).toBeVisible()
  const [cardBox, imageBox, titleBox] = [
    await card.boundingBox(),
    await image.boundingBox(),
    await card.getByTestId('link-preview-title-10-0').boundingBox(),
  ]
  // 이미지가 카드 폭을 채우고(테두리 제외) 제목보다 위, 높이는 150 이하.
  expect(Math.abs(imageBox!.width - (cardBox!.width - 2))).toBeLessThanOrEqual(1)
  expect(imageBox!.y + imageBox!.height).toBeLessThanOrEqual(titleBox!.y)
  expect(imageBox!.height).toBeLessThanOrEqual(150)
  // 터치 셸엔 ✕ 가 없다(작업 시트가 맡는다).
  await expect(page.getByTestId('link-preview-dismiss-11')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('작성자는 길게 누르기 시트의 「미리보기 지우기」로 지운다 — 링크 위에서 눌러도 새 탭이 열리지 않는다', async ({ authenticatedPage: page }) => {
  const { dismisses } = await stubLinkPreviewChannel(page, { padNewer: 8 })
  await page.goto('/chat/channels/1')
  await expect(page.getByTestId('link-preview-11-0')).toBeVisible()

  let popups = 0
  page.on('popup', () => popups++)
  // 시트가 열릴 자리(화면 아래쪽)를 피해 대상이 위쪽에 오도록 뒤에 메시지를 덧붙였다 — padNewer 주석 참조.
  const link = page.getByTestId('message-body-11').getByTestId('chat-link')
  await link.scrollIntoViewIfNeeded()
  await longPress(page, link)
  await expect(page.getByTestId('message-action-sheet')).toBeVisible()
  await page.getByTestId('message-action-dismiss-previews').tap()
  await dismisses.waitFor()
  expect(dismisses.lastUrl()?.pathname).toBe('/api/v1/messaging/messages/11/link-previews')
  await expect(page.getByTestId('link-previews-11')).toHaveCount(0)
  expect(popups).toBe(0)
})

test('타인 메시지의 시트엔 「미리보기 지우기」가 없다', async ({ authenticatedPage: page }) => {
  await stubLinkPreviewChannel(page)
  await page.goto('/chat/channels/1')
  await expect(page.getByTestId('link-preview-10-0')).toBeVisible()

  const text = page.getByTestId('message-body-10').getByText('UI 구성 괜찮네요')
  await text.scrollIntoViewIfNeeded()
  await longPress(page, text)
  await expect(page.getByTestId('message-action-sheet')).toBeVisible()
  await expect(page.getByTestId('message-action-copy')).toBeVisible()
  await expect(page.getByTestId('message-action-dismiss-previews')).toHaveCount(0)
})
