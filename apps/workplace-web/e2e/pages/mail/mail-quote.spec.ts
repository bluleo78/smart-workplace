// 메일 답장·전달 인용문 보존 E2E 회귀(#765). 인용문은 Tiptap 에디터 밖
// ComposeDraft.quote(QuoteParts & { variant }) 로 분리되어 있고,
// MailQuoteBlock 이 표시하며, 발송 시 bodyHtml = 에디터 본문 + quote.html 로 합쳐진다.
// 저장된 원문은 완전 HTML 문서이므로 표·서식 보존과 <style> 누출 차단을 함께
// 단정한다 — 존재 단언만으로는 누출 버그를 놓친다.
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

/** 실제 메일처럼 완전 문서 + 표 + 인라인 style + 긴 서명. */
const FULL_DOC_BODY = [
  '<html><head><style>body{color:red;font-family:Papyrus}</style></head><body>',
  '<p>안녕하세요, 인프라팀입니다.</p>',
  '<table><tr><th>항목</th><th>4분기(안)</th></tr>',
  '<tr><td bgcolor="#eeeeee" style="color:#0000ff">스토리지</td><td>25,900</td></tr></table>',
  '<p><font color="red">박지원 · 인프라팀 · 010-0000-0000</font></p>',
  '</body></html>',
].join('')

test.describe('메일 인용문 보존', () => {
  /** 목록 1건 + 상세(완전 문서 bodyHtml). bodyText 는 null — 있으면 프론트가 그쪽을 우선한다. */
  async function mockInbox(page: import('@playwright/test').Page, bodyHtml = FULL_DOC_BODY) {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([summary({ id: 5, subject: '4분기 인프라 예산 재검토 요청' })]),
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
              subject: '4분기 인프라 예산 재검토 요청',
              fromName: '박지원',
              fromAddress: 'jiwon.park@test.local',
              bodyHtml,
              bodyText: null,
            }),
          ),
        }),
    )
    await page.goto('/mail/1')
    // 상세 진입 — 목록 행 클릭.
    await page.getByText('4분기 인프라 예산 재검토 요청').first().click()
  }

  test('답장 인용문은 기본 접힘이고 펼치면 원문 서식이 그대로 보인다', async ({
    authenticatedPage: page,
  }) => {
    await mockInbox(page)
    await page.getByTestId('mail-reply').click()

    const quote = page.getByTestId('mail-compose-quote')
    await expect(quote).toBeVisible()
    // 답장은 접힘 — details 에 open 속성이 없다.
    await expect(quote).not.toHaveAttribute('open', '')
    await expect(page.getByTestId('mail-compose-quote-frame')).toBeHidden()

    await page.getByTestId('mail-compose-quote-toggle').click()
    const srcDoc = await page.getByTestId('mail-compose-quote-frame').getAttribute('srcdoc')

    // 보존: 표·인라인 style·bgcolor·font
    expect(srcDoc).toContain('<table>')
    expect(srcDoc).toContain('bgcolor="#eeeeee"')
    expect(srcDoc).toContain('style="color:#0000ff"')
    expect(srcDoc).toContain('<font color="red">')
    // 누출 차단: 원문 스타일시트와 문서 래퍼
    expect(srcDoc).not.toContain('<style')
    expect(srcDoc).not.toContain('Papyrus')
    expect(srcDoc).not.toContain('<html')
    expect(srcDoc).not.toContain('<head')
  })

  test('높이 토글이 펼침 상태를 무너뜨리지 않는다', async ({ authenticatedPage: page }) => {
    // details 의 open 을 파생값으로 두면 리렌더 때 React 가 되돌려 인용문이 접힌다.
    // 상태 + onToggle 동기화가 실제로 되어 있는지 확인한다.
    await mockInbox(page)
    await page.getByTestId('mail-reply').click()
    await page.getByTestId('mail-compose-quote-toggle').click()

    const frame = page.getByTestId('mail-compose-quote-frame')
    await expect(frame).toBeVisible()

    await page.getByText('전체 높이', { exact: true }).click()
    // 접히지 않고 높이만 커져야 한다.
    await expect(frame).toBeVisible()
    await expect(frame).toHaveClass(/h-64/)
    await expect(page.getByTestId('mail-compose-quote')).toHaveAttribute('open', '')
  })

  test('전달에서 접은 뒤 높이 토글해도 다시 펼쳐지지 않는다', async ({
    authenticatedPage: page,
  }) => {
    await mockInbox(page)
    await page.getByTestId('mail-forward').click()
    await page.getByTestId('mail-compose-quote-toggle').click() // 접기
    await expect(page.getByTestId('mail-compose-quote')).not.toHaveAttribute('open', '')
  })

  test('전달 인용문은 기본 펼침이고 카드에 발신자·제목이 보인다', async ({
    authenticatedPage: page,
  }) => {
    await mockInbox(page)
    await page.getByTestId('mail-forward').click()

    const quote = page.getByTestId('mail-compose-quote')
    await expect(quote).toHaveAttribute('open', '')
    await expect(page.getByTestId('mail-compose-quote-frame')).toBeVisible()
    await expect(quote).toContainText('4분기 인프라 예산 재검토 요청')
    await expect(quote).toContainText('박지원')
  })

  test('연접된 다중 문서의 본문이 모두 보존된다', async ({ authenticatedPage: page }) => {
    // IMAP 파서가 모든 text/html 파트를 한 버퍼에 연접하므로 실제로 발생하는 형태다.
    await mockInbox(
      page,
      '<html><body><p>첫째</p></body></html><html><body><p>둘째</p></body></html>',
    )
    await page.getByTestId('mail-reply').click()
    await page.getByTestId('mail-compose-quote-toggle').click()
    const srcDoc = await page.getByTestId('mail-compose-quote-frame').getAttribute('srcdoc')
    expect(srcDoc).toContain('첫째')
    expect(srcDoc).toContain('둘째')
  })

  test('발송 payload 는 에디터 본문 + 인용문 순서이고 원문이 무손실이다', async ({
    authenticatedPage: page,
  }) => {
    let sent: { bodyHtml: string; bodyText: string } | null = null
    await mockInbox(page)
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
        sent = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ localMessageId: 10, messageId: 'x@test.local' }),
        })
      },
    )

    await page.getByTestId('mail-reply').click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('스토리지 항목만 조정하면 될 것 같습니다.')
    await page.getByTestId('mail-compose-send').click()

    await expect.poll(() => sent).not.toBeNull()
    const html = sent!.bodyHtml
    // 순서: 내 본문이 인용문보다 앞
    expect(html.indexOf('스토리지 항목만')).toBeLessThan(html.indexOf('<blockquote>'))
    // 보존
    expect(html).toContain('<table>')
    expect(html).toContain('bgcolor="#eeeeee"')
    // 누출 차단 — 여기서 새면 내 문장까지 원문 스타일에 물든다
    expect(html).not.toContain('<style')
    expect(html).not.toContain('Papyrus')
    expect(html).not.toContain('<html')
    expect(html).not.toContain('<head')
    // plain-text alternative 에도 인용문이 들어간다
    expect(sent!.bodyText).toContain('박지원 님이 작성:')
    expect(sent!.bodyText).toContain('>')
  })

  test('본문을 안 써도 답장은 인용문만으로 발송 가능하지만 AI 검토는 비활성이다 (게이트 회귀)', async ({
    authenticatedPage: page,
  }) => {
    // 발송 버튼은 send.isPending 만 참조하므로 미편집 상태에서도 항상 활성 — 인용문만으로도 유효한 발송.
    // AI 검토 탭은 disabled={!hasBody} — 코칭 payload 에는 인용문이 실리지 않으므로(§6)
    // 본문이 비어 있으면 검토할 대상이 없어 비활성이어야 한다(빈 초안 LLM 호출 차단).
    await mockInbox(page)
    await page.getByTestId('mail-reply').click()
    await expect(page.getByTestId('mail-compose-send')).toBeEnabled()
    await expect(page.getByTestId('mail-review-tab')).toBeDisabled()
  })

  test('인용문 제거 버튼으로 지우면 블록이 사라지고 발송 payload 에 인용문이 실리지 않는다', async ({
    authenticatedPage: page,
  }) => {
    let sent: { bodyHtml: string; bodyText: string } | null = null
    await mockInbox(page)
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
        sent = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ localMessageId: 10, messageId: 'x@test.local' }),
        })
      },
    )

    await page.getByTestId('mail-reply').click()
    await expect(page.getByTestId('mail-compose-quote')).toBeVisible()

    await page.getByTestId('mail-compose-quote-remove').click()
    await expect(page.getByTestId('mail-compose-quote')).toHaveCount(0)

    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('기밀 문단 없이 회신합니다.')
    await page.getByTestId('mail-compose-send').click()

    await expect.poll(() => sent).not.toBeNull()
    expect(sent!.bodyHtml).not.toContain('<blockquote>')
    expect(sent!.bodyHtml).toContain('기밀 문단 없이 회신합니다.')
  })

  test('새 메일에는 인용문 블록이 없다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-compose-quote')).toHaveCount(0)
    // 인용문이 없으므로 AI 검토 탭은 본문이 비어 있는 한 비활성이어야 한다.
    await expect(page.getByTestId('mail-review-tab')).toBeDisabled()
  })
})
