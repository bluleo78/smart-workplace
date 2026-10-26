// 메일 답장·전달 인용문 인라인 이미지 E2E(WP-69) — 인용 미리보기의 cid 이미지가 실제로 디코딩돼 그려지는지(@platform)만 남긴다.
// 인용문 접힘/펼침·높이 토글·발송 payload(본문+인용문 순서·무손실·누출 차단·inlineImages)·제거·key 중복 경고·
// 용량 초과 400 안내는 src/pages/mail/mailCompose.test.tsx(vitest, WP-984)가 지킨다.
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { retryOnNavigation } from '../../fixtures/wait'

// WP-69 — 답장·전달 인용문 인라인 이미지(cid). 인용문 미리보기는 원본 첨부로 cid 를 치환해 보여주고,
// 발송 payload 는 cid: 를 유지한 채 inlineImages 로 원본 첨부를 넘겨 서버가 같은 Content-ID 로 재첨부한다.
// 매칭되지 않는 cid 이미지는 인용문에서 빠져 수신자에게 깨진 이미지가 가지 않는다.
test.describe('메일 인용문 인라인 이미지', () => {
  // 1x1 투명 PNG
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )

  async function mockInlineInbox(page: import('@playwright/test').Page) {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([summary({ id: 5, subject: '킥오프 참석자 조사' })]),
        }),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/mail/messages/5',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            detail({
              id: 5,
              subject: '킥오프 참석자 조사',
              fromName: '남태현',
              fromAddress: 'thnam@test.local',
              bodyText: null,
              bodyHtml:
                '<p>회신 부탁드립니다.</p><img id="q-inline" src="cid:7dc8b642.png"><img id="q-gone" src="cid:none.png">',
              attachments: [
                { id: 21, filename: '7dc8b642.png', contentType: 'image/png', sizeBytes: PNG.length, contentId: null },
                { id: 22, filename: '참석자조사.xlsx', contentType: 'application/vnd.ms-excel', sizeBytes: 100, contentId: null },
              ],
            }),
          ),
        }),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/mail/attachments/21/content',
      (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: PNG }),
    )
    await page.goto('/mail/1')
    await page.getByText('킥오프 참석자 조사').first().click()
  }

  test('답장 인용문 미리보기에 원본 인라인 이미지가 보이고, 발송 payload 에 재첨부 대상이 실린다', { tag: '@platform' }, async ({
    authenticatedPage: page,
  }) => {
    const sends = trackRequests(page, 'ANY', '/api/v1/mail/accounts/1/send')
    await mockInlineInbox(page)
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ localMessageId: 10, messageId: 'x@test.local' }),
        })
      },
    )

    await page.getByTestId('mail-reply').click()
    await page.getByTestId('mail-compose-quote-toggle').click()

    // 미리보기: cid → data URI 치환, 실제 디코딩(naturalWidth=1), 매칭 안 된 cid 이미지는 제거됨
    const frame = page.frameLocator('[data-testid="mail-compose-quote-frame"]')
    await expect(frame.locator('#q-inline')).toHaveAttribute('src', /^data:image\/png;base64,/)
    // 인용 미리보기 srcdoc 재작성 순간의 evaluate 예외(문서 교체)는 poll 이 재시도하지 않으므로 넘겨 다시 잰다(WP-225).
    await expect
      .poll(() => retryOnNavigation(() => frame.locator('#q-inline').evaluate((el) => (el as HTMLImageElement).naturalWidth)))
      .toBe(1)
    await expect(frame.locator('#q-gone')).toHaveCount(0)

    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    const sent = sends.lastBody<{ bodyHtml: string; inlineImages?: { attachmentId: number; contentId: string }[] }>()
    // 발송 본문은 cid: 를 유지(서버가 같은 Content-ID 파트를 붙임) — data URI 가 섞이면 안 된다
    expect(sent!.bodyHtml).toContain('src="cid:7dc8b642.png"')
    expect(sent!.bodyHtml).not.toContain('data:image')
    expect(sent!.bodyHtml).not.toContain('cid:none.png')
    expect(sent!.inlineImages).toEqual([{ attachmentId: 21, contentId: '7dc8b642.png' }])
  })

})
