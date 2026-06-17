// 메일 작성·발송·답장·보낸편지함 E2E — 백엔드 없이 page.route 모킹.
import { detail, mailAccount, summary } from '../factories/mail.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('메일 작성·발송', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // 메일 계정 1건 + 빈 INBOX 기본 모킹.
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
  })

  test('새 메일 작성 → 발송 payload 검증 + 도크 닫힘', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    // send POST 인터셉트.
    let sentBody: unknown = null
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
        sentBody = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ localMessageId: 10, messageId: 'x@test.local' }),
        })
      },
    )

    await page.goto('/mail/1')
    // chat-launcher 고정 버튼이 상단을 덮으므로 dispatchEvent 로 클릭 이벤트 직접 전달.
    await page.getByTestId('mail-compose-new').dispatchEvent('click')
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await page.getByTestId('mail-compose-subject').fill('안녕하세요')
    // Tiptap contenteditable — click 후 keyboard.type 으로 입력.
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('본문입니다')
    await page.getByTestId('mail-compose-send').click()

    // payload 검증: to·subject·본문·inReplyToMessageId.
    await expect.poll(() => sentBody).not.toBeNull()
    const body = sentBody as {
      to: string[]
      subject: string
      bodyHtml: string
      bodyText: string
      inReplyToMessageId: number | null
    }
    expect(body.to).toEqual(['rcpt@test.local'])
    expect(body.subject).toBe('안녕하세요')
    expect(body.bodyText).toContain('본문입니다')
    expect(body.bodyHtml).toContain('본문입니다')
    expect(body.inReplyToMessageId).toBeNull()

    // 발송 성공 시 도크 닫힘.
    await expect(page.getByTestId('mail-compose-dock')).toBeHidden()
  })

  test('답장 → inReplyToMessageId 포함', async ({ authenticatedPage: page }) => {
    // 목록에 메시지 1건 추가 — beforeEach 의 빈 목록을 덮어씀(나중 등록 우선).
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            summary({ id: 5, fromAddress: 'alice@example.com', fromName: 'Alice', subject: '원문' }),
          ]),
        }),
    )
    // 상세 모킹 — factory detail() 재사용(bccAddresses 포함 보장).
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/5',
      detail({
        id: 5,
        threadId: 't1',
        messageId: 'orig@x',
        fromAddress: 'alice@example.com',
        fromName: 'Alice',
        toAddresses: 'me@example.com',
        subject: '원문',
        bodyText: '원문 본문',
        bodyHtml: null,
        attachments: [],
      }),
    )

    // send POST 인터셉트.
    let sentBody: { inReplyToMessageId: number | null; subject: string; to: string[] } | null = null
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
        sentBody = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ localMessageId: 11, messageId: 'r@test.local' }),
        })
      },
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-5').click()
    await page.getByTestId('mail-reply').click()
    // 답장 도크에 발신자 주소 자동 입력 검증.
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('alice@example.com')
    await page.getByTestId('mail-compose-send').click()

    // payload: inReplyToMessageId = 5, subject Re: 로 시작, to = alice.
    await expect.poll(() => sentBody).not.toBeNull()
    expect(sentBody!.inReplyToMessageId).toBe(5)
    expect(sentBody!.subject).toMatch(/^Re:/)
    expect(sentBody!.to).toEqual(['alice@example.com'])
  })

  test('메일 모듈 이탈 후 복귀 시 작성 도크 draft 유지 (#183)', async ({ authenticatedPage: page }) => {
    // /projects 이동을 위해 프로젝트 목록 API 모킹.
    await mockApi(page, 'GET', '/api/v1/projects', [])

    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').dispatchEvent('click')
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    // 수신자·제목 입력 후 모듈 이탈 (앱 레일 클릭 → SPA 클라이언트 내비게이션).
    await page.getByTestId('mail-compose-to').fill('draft@example.com')
    await page.getByTestId('mail-compose-subject').fill('Draft survival test')

    // 앱 레일에서 다른 모듈로 이동 — MailModuleLayout 언마운트되지만 AppLayout 유지.
    await page.getByTestId('rail-link-/projects').click()
    await page.waitForURL(/\/projects/)
    // 다른 모듈에서도 dock 이 살아있어야 한다 (draft 가 AppLayout 레벨에서 보존됨).
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    // 메일로 복귀 — draft 상태(수신자·제목) 유지 검증.
    await page.getByTestId('rail-link-/mail').click()
    await page.waitForURL(/\/mail/)
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('draft@example.com')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('Draft survival test')
  })

  test('작성 도크 입력 필드 키보드 포커스 이동 (focus-visible ring)', async ({ authenticatedPage: page }) => {
    // Tab 키로 받는사람 → 제목 필드 이동 시 각 필드에 포커스가 잡혀야 한다 (#303).
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').dispatchEvent('click')
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    // 받는사람 클릭 후 Tab × 2 → 제목 필드 이동 검증
    // (참조/숨은참조 버튼이 Tab 순서에 포함되므로 2번 이동).
    await page.getByTestId('mail-compose-to').click()
    await expect(page.getByTestId('mail-compose-to')).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('mail-compose-subject')).toBeFocused()
  })

  test('보낸편지함 토글 → folder=SENT 쿼리', async ({ authenticatedPage: page }) => {
    // 메시지 요청 URL 의 folder 파라미터를 수집.
    const seen: string[] = []
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => {
        seen.push(new URL(route.request().url()).searchParams.get('folder') ?? '')
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      },
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-folder-sent').click()
    // folder=SENT 파라미터가 포함된 요청이 있어야 한다.
    await expect.poll(() => seen).toContain('SENT')
  })
})
