// WP-874 — 팀 채팅 링크 미리보기 카드(데스크톱). 카드의 썸네일 폭·위치·넘침(@layout)과 hover 로 드러나는 ✕ 지우기(@input)만 남긴다.
// 자동 링크·수정 중 숨김·지우기 실패 복원·SSE 로 붙는 미리보기는 vitest 로 옮겼다(WP-984): src/pages/chat/messageList.test.tsx,
// 이슈 챗 본문 자동 링크는 src/components/chat/ChatMarkdownText.test.tsx.
// 백엔드 없이 page.route 로 모킹한다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { LONG_TITLE, LONG_URL, stubLinkPreviewChannel } from '../../fixtures/link-preview-mock'

/** 채널 1 을 열고 링크 메시지가 그려질 때까지 기다린다. */
async function openChannel(page: Page) {
  await page.goto('/chat/channels/1')
  await expect(page.getByTestId('message-10')).toBeVisible()
}

test.describe('팀 채팅 링크·미리보기 (WP-874)', () => {
  test('미리보기 카드 — 사이트·제목 링크·설명, 썸네일은 프록시 경로로 받는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const { images } = await stubLinkPreviewChannel(page)
    await openChannel(page)

    const card = page.getByTestId('link-preview-10-0')
    await expect(card.getByTestId('link-preview-site-10-0')).toHaveText('GitHub')
    const title = card.getByTestId('link-preview-title-10-0')
    await expect(title).toHaveText(LONG_TITLE)
    await expect(title).toHaveAttribute('href', LONG_URL)
    await expect(title).toHaveAttribute('target', '_blank')
    await expect(card.getByTestId('link-preview-desc-10-0')).toContainText('Open-source building blocks')
    // 썸네일: 메시지·위치로 만든 서버 프록시 경로를 부르고, 받은 이미지를 카드 오른쪽 96px 에 그린다.
    await images.waitFor()
    expect(images.lastUrl()?.pathname).toBe('/api/v1/messaging/messages/10/link-previews/0/image')
    // 링크로 만든 버전 값 — 수정으로 같은 자리에 다른 링크가 오면 주소가 바뀌어 하루 캐시된 옛 썸네일을 피한다.
    expect(images.lastUrl()?.searchParams.get('v')).toMatch(/^[0-9a-z]+$/)
    const image = card.getByTestId('link-preview-image-10-0')
    await expect(image.locator('img')).toBeVisible()
    const [cardBox, imageBox] = [await card.boundingBox(), await image.boundingBox()]
    expect(imageBox!.width).toBe(96)
    expect(Math.round(imageBox!.x + imageBox!.width)).toBe(Math.round(cardBox!.x + cardBox!.width - 1))

    // 사이트 이름이 없으면 호스트(www. 제외), og:image 가 없으면 이미지 자리 없이 글만.
    await expect(page.getByTestId('link-preview-site-11-0')).toHaveText('example.com')
    await expect(page.getByTestId('link-preview-image-11-0')).toHaveCount(0)
    // 긴 URL·제목이 있어도 문서가 가로로 넘치지 않는다.
    const overflow = await page.getByTestId('message-list').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('작성자는 hover 때 ✕ 로 미리보기를 지운다 — DELETE 호출 후 카드가 사라진다, 타인 메시지엔 ✕ 가 없다', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    const { dismisses } = await stubLinkPreviewChannel(page)
    await openChannel(page)

    await expect(page.getByTestId('link-preview-dismiss-10')).toHaveCount(0)
    const dismiss = page.getByTestId('link-preview-dismiss-11')
    await expect(dismiss).toHaveCSS('opacity', '0')
    await page.getByTestId('link-preview-11-0').hover()
    await expect(dismiss).toHaveCSS('opacity', '1')
    await expect(dismiss).toHaveAccessibleName('미리보기 지우기')
    await dismiss.click()

    await dismisses.waitFor()
    expect(dismisses.lastUrl()?.pathname).toBe('/api/v1/messaging/messages/11/link-previews')
    await expect(page.getByTestId('link-previews-11')).toHaveCount(0)
    // 본문 링크는 그대로 남는다.
    await expect(page.getByTestId('message-body-11').getByTestId('chat-link')).toBeVisible()
  })
})
