// 메일 작성·발송·답장·보낸편지함 E2E — 백엔드 없이 page.route 모킹.
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

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
    const sends = trackRequests(page, 'ANY', '/api/v1/mail/accounts/1/send')
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

    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await page.getByTestId('mail-compose-subject').fill('안녕하세요')
    // Tiptap contenteditable — click 후 keyboard.type 으로 입력.
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('본문입니다')
    await page.getByTestId('mail-compose-send').click()

    // payload 검증: to·subject·본문·inReplyToMessageId.
    await sends.waitFor()
    const body = sends.lastBody<{
      to: string[]
      subject: string
      bodyHtml: string
      bodyText: string
      inReplyToMessageId: number | null
    }>()!
    expect(body.to).toEqual(['rcpt@test.local'])
    expect(body.subject).toBe('안녕하세요')
    expect(body.bodyText).toContain('본문입니다')
    expect(body.bodyHtml).toContain('본문입니다')
    expect(body.inReplyToMessageId).toBeNull()

    // 발송 성공 시 도크 닫힘.
    await expect(page.getByTestId('mail-compose-dock')).toBeHidden()
  })

  // #802 — 도크가 role/label 없는 평범한 div였고, 열릴 때 포커스가 본문 에디터로 가버리던 문제 회귀 방지.
  test('작성 도크가 region 랜드마크로 노출되고, 열리면 "받는사람"에 포커스된다 (#802)', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()

    const dock = page.getByTestId('mail-compose-dock')
    await expect(dock).toBeVisible()
    await expect(dock).toHaveAttribute('role', 'region')
    // region 의 accessible name 이 헤더 텍스트("새 메일")와 연결돼야 한다.
    await expect(page.getByRole('region', { name: '새 메일' })).toBeVisible()

    await expect(page.getByTestId('mail-compose-to')).toBeFocused()
  })

  // #692 — 수신자 없이 발송 시 검증 에러 토스트가 컴포즈 도크의 "보내기" 버튼을 가리지 않아야 한다.
  test('수신자 없이 발송 → 검증 에러 토스트가 상단에 표시되고 보내기 버튼을 가리지 않음', async ({
    authenticatedPage: page,
  }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      (route) => route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: '수신자를 한 명 이상 입력하세요' }),
      }),
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    await page.getByTestId('mail-compose-subject').fill('제목만')
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('본문')
    await page.getByTestId('mail-compose-send').click()

    // 토스트 표시 확인 + 하단(bottom)이 아닌 상단(top)에 렌더돼 도크와 겹치지 않아야 함 (#692)
    await expect(page.getByText('수신자를 한 명 이상 입력하세요')).toBeVisible()
    const toaster = page.locator('[data-sonner-toaster]')
    await expect(toaster).toHaveAttribute('data-y-position', 'top')

    // 컴포즈 도크는 그대로 열려 있고 보내기 버튼도 계속 클릭 가능해야 함(가려지지 않음).
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-compose-send')).toBeInViewport()
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
    const sends = trackRequests(page, 'ANY', '/api/v1/mail/accounts/1/send')
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
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
    await sends.waitFor()
    const sentBody = sends.lastBody<{ inReplyToMessageId: number | null; subject: string; to: string[] }>()
    expect(sentBody!.inReplyToMessageId).toBe(5)
    expect(sentBody!.subject).toMatch(/^Re:/)
    expect(sentBody!.to).toEqual(['alice@example.com'])
  })

  test('메일 모듈 이탈 후 복귀 시 작성 도크 draft 유지 (#183)', async ({ authenticatedPage: page }) => {
    // /projects 이동을 위해 프로젝트 목록 API 모킹. 실제 응답 형태(페이지 응답)여야 한다 — 배열 [] 을 주면
    // ProjectListPage 가 content.length 에서 크래시해 최상위 에러 바운더리가 앱 레일까지 갈아엎는다(부하 시 복귀 클릭 실패).
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([]))

    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
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
    await page.getByTestId('mail-compose-new').click()
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
    const lists = trackRequests(page, 'GET', '/api/v1/mail/accounts/1/messages')

    await page.goto('/mail/1')
    await page.getByTestId('mail-folder-sent').click()
    // folder=SENT 파라미터가 포함된 요청이 있어야 한다.
    await expect.poll(() => lists.urls().map((u) => u.searchParams.get('folder') ?? '')).toContain('SENT')
  })
})
