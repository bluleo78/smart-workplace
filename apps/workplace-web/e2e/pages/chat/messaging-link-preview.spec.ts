// WP-874 — 채팅 자동 링크 + 팀 채팅 링크 미리보기 카드(데스크톱).
// 백엔드 없이 page.route 로 모킹한다. SSE 는 열린 스트림(auth.fixture)에 pushHeldEvents 로 프레임을 밀어 넣는다(재연결 배너 방지).
import type { Page } from '@playwright/test'

import { createChatMember, createChatMessage, createChatThread } from '../../factories/chat.factory'
import { createIssue, createIssueDetail } from '../../factories/issue.factory'
import { createLinkPreview } from '../../factories/messaging.factory'
import { createProject } from '../../factories/project.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { pushHeldEvents } from '../../fixtures/gatedEvents'
import { LONG_TITLE, LONG_URL, linkPreviewsFrame, stubLinkPreviewChannel } from '../../fixtures/link-preview-mock'
import { json } from '../../fixtures/mobile-chat'

/** 채널 1 을 열고 링크 메시지가 그려질 때까지 기다린다. */
async function openChannel(page: Page) {
  await page.goto('/chat/channels/1')
  await expect(page.getByTestId('message-10')).toBeVisible()
}

test.describe('팀 채팅 링크·미리보기 (WP-874)', () => {
  test('사람 메시지의 URL·www. 는 새 탭 링크가 된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await stubLinkPreviewChannel(page)
    await openChannel(page)

    const peerLink = page.getByTestId('message-body-10').getByTestId('chat-link')
    await expect(peerLink).toHaveText(LONG_URL)
    await expect(peerLink).toHaveAttribute('href', LONG_URL)
    await expect(peerLink).toHaveAttribute('target', '_blank')
    await expect(peerLink).toHaveAttribute('rel', 'noopener noreferrer')
    // 앞뒤 글은 링크 밖에 그대로 남는다.
    await expect(page.getByTestId('message-body-10')).toContainText('이거 참고해 보세요')
    await expect(page.getByTestId('message-body-10')).toContainText('UI 구성 괜찮네요')

    const wwwLink = page.getByTestId('message-body-11').getByTestId('chat-link')
    await expect(wwwLink).toHaveText('www.example.com/notes')
    await expect(wwwLink).toHaveAttribute('href', 'https://www.example.com/notes')
  })

  test('미리보기 카드 — 사이트·제목 링크·설명, 썸네일은 프록시 경로로 받는다', async ({ authenticatedPage: page }) => {
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

  test('작성자는 hover 때 ✕ 로 미리보기를 지운다 — DELETE 호출 후 카드가 사라진다, 타인 메시지엔 ✕ 가 없다', async ({
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

  test('수정 중엔 미리보기 카드와 ✕ 를 숨기고, 취소하면 다시 보인다', async ({ authenticatedPage: page }) => {
    await stubLinkPreviewChannel(page)
    await openChannel(page)

    await page.getByTestId('message-11').hover()
    await page.getByTestId('message-edit-11').click()
    await expect(page.getByTestId('message-editor-11')).toBeVisible()
    await expect(page.getByTestId('link-previews-11')).toHaveCount(0)
    await expect(page.getByTestId('link-preview-dismiss-11')).toHaveCount(0)

    await page.getByTestId('message-editor-cancel-11').click()
    await expect(page.getByTestId('link-preview-11-0')).toBeVisible()
  })

  test('지우기 실패 — 카드를 되돌리고 오류 토스트', async ({ authenticatedPage: page }) => {
    await stubLinkPreviewChannel(page, { dismissStatus: 500 })
    await openChannel(page)

    await page.getByTestId('link-preview-11-0').hover()
    await page.getByTestId('link-preview-dismiss-11').click()
    await expect(page.getByText('실패').or(page.getByText('미리보기를 지우지 못했습니다')).first()).toBeVisible()
    await expect(page.getByTestId('link-preview-11-0')).toBeVisible()
  })

  test('SSE 로 미리보기가 도착하면 카드가 붙는다 — 썸네일을 못 받으면 이미지 자리 없이 글만', async ({ authenticatedPage: page }) => {
    await stubLinkPreviewChannel(page, { imageStatus: 404 })
    await openChannel(page)
    await expect(page.getByTestId('link-previews-12')).toHaveCount(0)

    await pushHeldEvents(
      page,
      linkPreviewsFrame(12, [createLinkPreview({ url: 'https://docs.example.com/a', title: '설계 문서', siteName: 'docs.example.com', description: null, hasImage: true })]),
    )
    const card = page.getByTestId('link-preview-12-0')
    await expect(card.getByTestId('link-preview-title-12-0')).toHaveText('설계 문서')
    await expect(card.getByTestId('link-preview-image-12-0')).toHaveCount(0)

    // 지우기(빈 배열) 이벤트는 카드를 걷는다.
    await pushHeldEvents(page, linkPreviewsFrame(12, []))
    await expect(page.getByTestId('link-previews-12')).toHaveCount(0)
  })
})

test.describe('이슈 챗 링크 (WP-874)', () => {
  test('사람 메시지의 URL 은 새 탭 링크가 된다', async ({ authenticatedPage: page }) => {
    const KEY = 'WP'
    const msg = createChatMessage({
      id: 301, threadId: 100, authorId: 20, authorName: '동료',
      body: '참고: https://example.com/spec?id=7). 끝',
    })
    const thread = createChatThread({ threadId: 100, issueId: 1, members: [createChatMember({ userId: 1 })], recentMessages: [msg] })
    await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject())))
    await page.route(`**/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json([])))
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/labels`, (r) => r.fulfill(json([])))
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/1`, (r) =>
      r.fulfill(json(createIssueDetail({ summary: createIssue({ id: 1, number: 1 }) }))))
    for (const sub of ['watchers', 'labels', 'attachments']) {
      await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/1/${sub}`, (r) => r.fulfill(json([])))
    }
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/1/chat/thread`, (r) => r.fulfill(json(thread)))
    await page.route((u) => u.pathname === '/api/v1/chat/threads/100/messages', (r) =>
      r.request().method() === 'GET' ? r.fulfill(json({ items: [msg], nextCursor: null, hasMore: false })) : r.fallback())
    await page.route((u) => u.pathname === '/api/v1/chat/threads/100/read', (r) => r.fulfill({ status: 204 }))

    await page.goto(`/projects/${KEY}/issues/1`)
    await page.getByTestId('issue-chat-open').click()
    const link = page.getByTestId('chat-message-body-301').getByTestId('chat-link')
    // 끝의 짝 없는 `)` 와 `.` 은 문장부호로 보고 링크에서 뺀다.
    await expect(link).toHaveText('https://example.com/spec?id=7')
    await expect(link).toHaveAttribute('href', 'https://example.com/spec?id=7')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(page.getByTestId('chat-message-body-301')).toContainText('). 끝')
  })
})
