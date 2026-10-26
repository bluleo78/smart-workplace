// 초안 코칭 E2E — 작성 도크 "AI 검토" 탭. 백엔드 없이 page.route 모킹.
// 미리보기 문단 여백·다크 색(@layout), 단축키·본문 지우기로 바뀌는 판정(@input)만 남긴다.
// 노트·개선본·교체·요청에 인용문 없음·빈 초안 비활성·503 안내는 src/pages/mail/mailCompose.test.tsx(vitest, WP-984)가 지킨다.
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { retryOnNavigation } from '../../fixtures/wait'

test.describe('메일 초안 코칭', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, fromAddress: 'alice@example.com' })]) }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, fromAddress: 'alice@example.com', bodyText: '원문' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• 요약' })
    await page.route((u) => u.pathname === '/api/v1/mail/draft-coaching',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({
          notes: [{ dimension: 'TONE', message: '명령조가 강해요' }],
          improvedBodyHtml: '<p>다듬은 개선본입니다</p>',
        }) }))
  })

  // WP-404 — 빈 줄(빈 <p></p>)이 든 개선본: 미리보기는 에디터와 같은 문단 규칙(여백 0)으로 그리고,
  // 교체하면 빈 단락이 그대로 에디터에 남아 미리보기에서 본 줄 간격이 유지된다. 요청엔 초안 HTML 이 실린다.
  test('빈 줄 개선본 → 미리보기 문단 여백 0 · 교체 후 빈 단락 유지 (WP-404)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const improved = '<p>안녕하세요.</p><p></p><p>자료 부탁드립니다.</p><p></p><p>감사합니다.</p>'
    let payload: { bodyHtml?: string } | null = null
    await page.route((u) => u.pathname === '/api/v1/mail/draft-coaching', (route) => {
      payload = route.request().postDataJSON()
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ notes: [], improvedBodyHtml: improved }) })
    })
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    const body = page.getByTestId('mail-composer-body')
    await body.click()
    await page.keyboard.type('안녕')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('자료 줘')

    await page.getByTestId('mail-review-tab').click()
    const frame = page.frameLocator('[data-testid="mail-coaching-improved"]')
    await expect(frame.locator('p').first()).toHaveText('안녕하세요.')
    // 초안은 빈 단락까지 담긴 HTML 로 보낸다.
    expect(payload!.bodyHtml).toBe('<p>안녕</p><p></p><p>자료 줘</p>')
    // 미리보기 문단 여백 = 에디터(0) — 브라우저 기본 1em 이면 교체 후 모습과 달라진다.
    expect(await retryOnNavigation(() => frame.locator('p').first().evaluate((el) => getComputedStyle(el).marginBottom)))
      .toBe('0px')
    expect(await retryOnNavigation(() => body.locator('p').first().evaluate((el) => getComputedStyle(el).marginBottom)))
      .toBe('0px')
    // 빈 단락도 에디터처럼 한 줄 높이를 차지한다(브라우저 기본은 높이 0 으로 접힘).
    const lineHeight = await retryOnNavigation(() => frame.locator('p').first().evaluate((el) => el.getBoundingClientRect().height))
    expect(await retryOnNavigation(() => frame.locator('p').nth(1).evaluate((el) => el.getBoundingClientRect().height)))
      .toBe(lineHeight)

    await page.getByTestId('mail-coaching-apply').click()
    await expect(body.locator('p')).toHaveCount(5)
    await expect(body.locator('p').nth(1)).toHaveText('')
    expect(await body.locator('p').nth(1).evaluate((el) => el.getBoundingClientRect().height)).toBe(lineHeight)
    await expect(body.locator('p').nth(2)).toHaveText('자료 부탁드립니다.')
  })

  // WP-404 — 다크 테마에선 개선본 미리보기도 받은 메일 본문처럼 테마색(어두운 배경·밝은 글자)으로 바뀐다.
  test('다크 테마 → 개선본 미리보기도 테마색 (WP-404)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('자료 빨리 보내주세요')
    await page.getByTestId('mail-review-tab').click()
    const frame = page.frameLocator('[data-testid="mail-coaching-improved"]')
    await expect(frame.locator('body')).toContainText('다듬은 개선본입니다')
    const appBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const appFg = await page.evaluate(() => getComputedStyle(document.body).color)
    // 미리보기 문서 배경·글자 = 앱 다크 토큰 (변환이 없으면 투명 배경 위 검정 글자)
    await expect.poll(() => retryOnNavigation(() => frame.locator('body').evaluate((el) => getComputedStyle(el).color)))
      .toBe(appFg)
    await expect.poll(() => retryOnNavigation(() => frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)))
      .toBe(appBg)
  })

  // WP-404 — 재검토 판정은 HTML 기준: 글자는 그대로 두고 굵게만 바꿔도 다시 검토한다(이전 개선본으로 교체하면 굵게가 사라짐).
  test('서식만 바꿔도 다시 검토한다 (WP-404)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const sent: string[] = []
    await page.route((u) => u.pathname === '/api/v1/mail/draft-coaching', (route) => {
      sent.push((route.request().postDataJSON() as { bodyHtml: string }).bodyHtml)
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ notes: [], improvedBodyHtml: '<p>개선</p>' }) })
    })
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('자료 부탁')
    await page.getByTestId('mail-review-tab').click()
    await expect.poll(() => sent.length).toBe(1)

    await page.getByTestId('mail-coaching-keep').click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('ControlOrMeta+B')
    await page.getByTestId('mail-review-tab').click()
    await expect.poll(() => sent.length).toBe(2)
    expect(sent[1]).toBe('<p><strong>자료 부탁</strong></p>')
  })

  // #765 — 코칭 payload 에는 인용문이 실리지 않으므로(§6) 답장에 인용문이 남아 있어도
  // 본문을 비우면 검토할 초안이 없다. 게이트가 "인용문만 있어도 활성" 으로 풀리는 회귀를 막는다.
  test('본문을 비우면 인용문이 남아 있어도 AI 검토는 비활성 (#765)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-reply').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    const body = page.getByTestId('mail-composer-body')
    await body.click()
    await page.keyboard.type('임시 문장')
    await expect(page.getByTestId('mail-review-tab')).toBeEnabled()
    // 본문 비움 — 인용문은 에디터 밖이라 그대로 남는다.
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('mail-compose-quote')).toBeVisible()
    await expect(page.getByTestId('mail-review-tab')).toBeDisabled()
  })

})
