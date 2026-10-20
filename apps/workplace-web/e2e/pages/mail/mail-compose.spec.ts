// 메일 작성·발송·답장·보낸편지함 E2E — 백엔드 없이 page.route 모킹.
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { commitImeThenEnterInSameTask } from '../../fixtures/ime'
import { trackRequests } from '../../fixtures/requests'
import { expectOnTop } from '../../fixtures/mobile.fixture'
import { expectToggle } from '../../fixtures/selection'

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

  // WP-368 — 서식 토글이 켜지면 TOGGLE_ON(primary 테두리·글자)이 붙고, 다른 서식 버튼엔 없다. 끄면 사라진다.
  test('서식 토글 — 굵게를 켜면 aria-pressed·TOGGLE_ON 표시, 기울임은 그대로 (WP-368)', async ({ authenticatedPage: page }) => {
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-composer-body').click()
    const bold = page.getByRole('button', { name: '굵게' })
    const italic = page.getByRole('button', { name: '기울임' })
    await expectToggle(bold, false)
    await bold.click()
    await expectToggle(bold, true)
    await expectToggle(italic, false)
    await bold.click()
    await expectToggle(bold, false)
  })

  // WP-333 — macOS Chrome 에서 한글 마지막 글자 조합 중 Enter 를 쳐도 그 글자가 남고 다음 문단으로 넘어간다(수정 뒤 동작 회귀 방지 —
  // 실제 입력기의 글자 소실은 합성 이벤트로 재현되지 않는다. wiki-ime-enter.spec.ts 참고).
  test('본문에서 마지막 글자 조합 중 Enter — 글자가 남고 문단이 나뉘어 발송된다 (Mac Chrome 순서)', async ({
    authenticatedPage: page,
  }) => {
    const sends = trackRequests(page, 'ANY', '/api/v1/mail/accounts/1/send')
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ localMessageId: 11, messageId: 'y@test.local' }) }),
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await page.getByTestId('mail-compose-subject').fill('조합')
    const bodyEditor = page.getByTestId('mail-composer-body')
    await bodyEditor.click()
    await page.keyboard.insertText('가나')
    await commitImeThenEnterInSameTask(bodyEditor, { composing: '닥', committed: '다' })
    await page.keyboard.insertText('둘째')
    await expect(bodyEditor.locator('p')).toHaveText(['가나다', '둘째'])

    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    expect(sends.lastBody<{ bodyHtml: string }>()!.bodyHtml).toContain('<p>가나다</p><p>둘째</p>')
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

  test('인용문을 지워도 같은 작성이다 — 크게 보기·고친 제목·본문이 그대로 발송되고, 지운 것만으로도 ✕ 가 버릴지 묻는다', async ({ authenticatedPage: page }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([summary({ id: 5, fromAddress: 'alice@example.com', subject: '원문' })]) }),
    )
    await mockApi(page, 'GET', '/api/v1/mail/messages/5', detail({ id: 5, fromAddress: 'alice@example.com', subject: '원문', bodyText: '기밀 원문', bodyHtml: null, attachments: [] }))
    const sends = trackRequests(page, 'ANY', '/api/v1/mail/accounts/1/send')
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/send',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ localMessageId: 11, messageId: 'r@test.local' }) }),
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-5').click()

    // 인용문만 지워도 쓴 내용 — ✕ 가 묻는다.
    await page.getByTestId('mail-reply').click()
    await page.getByTestId('mail-compose-quote-remove').click()
    await page.getByTestId('mail-compose-close').click()
    await expect(page.getByTestId('mail-compose-discard-dialog')).toBeVisible()
    await page.getByTestId('mail-compose-discard-confirm').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)

    // 크게 보기에서 제목·본문을 고친 뒤 인용문을 지워도 크기·제목·본문이 그대로다.
    await page.getByTestId('mail-reply').click()
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByTestId('mail-compose-subject').fill('고친 제목')
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('직접 쓴 회신')
    await page.getByTestId('mail-compose-quote-remove').click()
    await expect(page.getByTestId('mail-compose-quote')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('고친 제목')
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    const body = sends.lastBody<{ subject: string; bodyText: string }>()!
    expect(body.subject).toBe('고친 제목')
    expect(body.bodyText).toContain('직접 쓴 회신')
    expect(body.bodyText).not.toContain('기밀 원문')
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

// WP-575 — 데스크톱 작성창 크게 보기. 가운데 큰 창 + 뒤 어둡게, Esc·배경 클릭은 닫지 않고 작은 창으로 돌아간다.
test.describe('메일 작성창 크게 보기 (WP-575)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
  })

  /** 작은 창 폭(32rem=512px) 근처인지 — 확대 여부를 크기로 판정한다. */
  async function dockBox(page: import('@playwright/test').Page) {
    return (await page.getByTestId('mail-compose-dock').boundingBox())!
  }

  test('크게 보기 → 가운데 큰 창 + 배경, 작게 보기 → 원래 작은 창', async ({ authenticatedPage: page }) => {
    const small = await dockBox(page)
    expect(small.width).toBeLessThan(560)

    await page.getByRole('button', { name: '크게 보기' }).click()
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
    const vp = page.viewportSize()!
    const big = await dockBox(page)
    // min(960px, 92vw) × 85vh, 화면 가운데.
    expect(big.width).toBeGreaterThan(900)
    expect(Math.abs(big.height - vp.height * 0.85)).toBeLessThanOrEqual(2)
    expect(Math.abs(big.x + big.width / 2 - vp.width / 2)).toBeLessThanOrEqual(2)
    expect(Math.abs(big.y + big.height / 2 - vp.height / 2)).toBeLessThanOrEqual(2)
    // 에디터가 남은 높이를 채운다 — 작은 창 상한(40vh)보다 크다.
    const editor = (await page.getByTestId('mail-composer-body').boundingBox())!
    expect(editor.height).toBeGreaterThan(vp.height * 0.4)

    await page.getByRole('button', { name: '작게 보기' }).click()
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
    expect((await dockBox(page)).width).toBeLessThan(560)
  })

  test('확대 중 Esc 를 누르면 닫히지 않고 작은 창으로 돌아간다(쓰던 내용 유지)', async ({ authenticatedPage: page }) => {
    await page.getByTestId('mail-compose-subject').fill('확대 중 제목')
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('확대 본문')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    expect((await dockBox(page)).width).toBeLessThan(560)
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('확대 중 제목')
    await expect(page.getByTestId('mail-composer-body')).toContainText('확대 본문')
  })

  test('확대 중 배경을 누르면 닫히지 않고 작은 창으로 돌아간다', async ({ authenticatedPage: page }) => {
    await page.getByTestId('mail-compose-to').fill('keep@test.local')
    await page.getByRole('button', { name: '크게 보기' }).click()
    // 창 바깥(왼쪽 위 구석)을 누른다.
    await page.getByTestId('mail-compose-backdrop').click({ position: { x: 10, y: 10 } })
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('keep@test.local')
    expect((await dockBox(page)).width).toBeLessThan(560)
  })

  test('확대 중 최소화하면 작은 창의 최소화 상태가 되고, 다시 펼치면 작은 창이다', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByRole('button', { name: '최소화' }).click()
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-to')).toBeHidden()
    await expect(page.getByRole('button', { name: '크게 보기' })).toBeVisible()
    await page.getByRole('button', { name: '최소화' }).click()
    await expect(page.getByTestId('mail-compose-to')).toBeVisible()
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
    expect((await dockBox(page)).width).toBeLessThan(560)
  })

  test('확대한 채 닫았다 다시 열면 작은 창으로 열린다', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByTestId('mail-compose-close').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
    expect((await dockBox(page)).width).toBeLessThan(560)
  })

  test('크게 보기는 대화상자다 — 뒤 페이지는 inert 이고, 작게 보면 풀린다', async ({ authenticatedPage: page }) => {
    const isInert = () => page.getByTestId('mail-compose-new').evaluate((el) => el.closest('[inert]') != null)
    expect(await isInert()).toBe(false)
    await page.getByRole('button', { name: '크게 보기' }).click()
    const dock = page.getByTestId('mail-compose-dock')
    await expect(dock).toHaveAttribute('role', 'dialog')
    // AI 를 함께 쓰므로 aria-modal 은 달지 않는다(useAiPanelAwareDialog 와 같은 규칙).
    await expect(dock).not.toHaveAttribute('aria-modal', /.*/)
    expect(await isInert()).toBe(true)
    await page.getByRole('button', { name: '작게 보기' }).click()
    await expect(dock).toHaveAttribute('role', 'region')
    expect(await isInert()).toBe(false)
  })

  test('크게 보기 중에도 AI 를 함께 쓴다 — 칩을 누르면 옆 패널이 열리고, 작성창은 패널을 뺀 영역 가운데로 옮긴다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/home/sessions**', (r) => r.fulfill({ json: { items: [], nextCursor: null } }))
    await page.getByTestId('mail-compose-subject').fill('AI 와 함께')
    await page.getByRole('button', { name: '크게 보기' }).click()
    const chip = page.getByTestId('chat-launcher')
    // 칩은 어두운 배경 위에 남아 누를 수 있다(inert 아님).
    await expectOnTop(page, chip, '[data-testid="chat-launcher"]')
    expect(await chip.evaluate((el) => el.closest('[inert]') != null)).toBe(false)
    await chip.click()
    const panel = page.getByTestId('ai-side-panel')
    await expect(panel).toBeVisible()
    // 작성창은 크게 보기 그대로, 쓰던 내용 유지.
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('AI 와 함께')
    // 배경은 패널을 덮지 않고, 작성창은 패널 왼쪽 페이지 영역 가운데에 있다.
    const p = (await panel.boundingBox())!
    await expect.poll(async () => Math.round((await page.getByTestId('mail-compose-backdrop').boundingBox())!.width)).toBe(Math.round(p.x))
    await expect(async () => {
      const d = await dockBox(page)
      expect(d.x + d.width).toBeLessThanOrEqual(p.x)
      expect(Math.abs(d.x + d.width / 2 - p.x / 2)).toBeLessThanOrEqual(2)
    }).toPass()
    await expectOnTop(page, panel, '[data-testid="ai-side-panel"]')
  })

  test('크게 보기 중 AI 를 전체 화면으로 바꾸면 작은 창으로 비켜 주고, 옆 패널로 돌리면 다시 크게 보인다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/home/sessions**', (r) => r.fulfill({ json: { items: [], nextCursor: null } }))
    await page.getByTestId('mail-compose-subject').fill('전체 화면 전환')
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    await page.getByTestId('ai-mode-fullscreen').click()
    // AI 전체 화면은 가려지지 않고 쓸 수 있다 — 배경이 사라지고 작성창은 작은 창, 뒤 페이지 inert 도 풀린다.
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
    expect((await dockBox(page)).width).toBeLessThan(560)
    // 그동안 크게 보기 버튼은 꺼져 있다(눌러도 아무 일 없는 상태를 만들지 않게).
    await expect(page.getByTestId('mail-compose-expand')).toBeDisabled()
    const modeSide = page.getByTestId('ai-mode-side')
    expect(await modeSide.evaluate((el) => el.closest('[inert]') != null)).toBe(false)
    await modeSide.click()
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
    expect((await dockBox(page)).width).toBeGreaterThan(560)
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('전체 화면 전환')
  })

  test('쓴 내용이 있으면 ✕ 는 버릴지 묻는다 — 계속 작성하면 그대로, 버리면 닫힌다', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('지우면 안 되는 본문')
    await page.getByTestId('mail-compose-close').click()
    const confirm = page.getByTestId('mail-compose-discard-dialog')
    await expect(confirm).toBeVisible()
    await expectOnTop(page, confirm, '[data-testid="mail-compose-discard-dialog"]')
    await page.getByTestId('mail-compose-discard-keep').click()
    await expect(page.getByTestId('mail-composer-body')).toContainText('지우면 안 되는 본문')
    await page.getByTestId('mail-compose-close').click()
    await page.getByTestId('mail-compose-discard-confirm').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
  })

  test('확대한 채 셸이 모바일↔데스크톱으로 바뀌어도 새로 그린 뒤 페이지가 inert 다', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '크게 보기' }).click()
    const pageArea = () =>
      page.evaluate(() => Array.from(document.querySelector('[data-ai-page-root]')!.querySelectorAll('main')).every((el) => el.closest('[inert]') != null))
    await page.setViewportSize({ width: 800, height: 900 }) // lg(1024px) 미만 → 모바일 셸
    await expect.poll(pageArea).toBe(true)
    await page.setViewportSize({ width: 1440, height: 900 }) // 다시 데스크톱 셸 — 크게 보기 상태 그대로
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
    await expect.poll(pageArea).toBe(true)
    expect(await page.getByTestId('mail-compose-new').evaluate((el) => el.closest('[inert]') != null)).toBe(true)
  })

  test('확대 중 창 안 빈 곳(제목 글자)을 누른 뒤 Esc 도 작은 창으로 돌아간다', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.locator('#mail-compose-dock-title').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
    expect((await dockBox(page)).width).toBeLessThan(560)
  })

  test('크게 보기에서 본문이 길어 스크롤돼도 서식 버튼과 보내기가 창 안에 보인다', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByTestId('mail-composer-body').click()
    for (let i = 0; i < 60; i++) {
      await page.keyboard.type(`줄 ${i}`)
      await page.keyboard.press('Enter')
    }
    const dock = await dockBox(page)
    const within = async (testId: string) => {
      const box = (await page.getByTestId(testId).boundingBox())!
      return box.y >= dock.y - 1 && box.y + box.height <= dock.y + dock.height + 1
    }
    // 본문 끝(커서 위치)으로 스크롤된 상태 — 툴바는 위에 붙어 있고 보내기는 아래에 남는다.
    await expect.poll(() => within('mail-composer-toolbar')).toBe(true)
    await expect.poll(() => within('mail-compose-send')).toBe(true)
    await expectOnTop(page, page.getByRole('button', { name: '굵게' }), '[data-testid="mail-composer-toolbar"] button')
    await expectOnTop(page, page.getByTestId('mail-compose-send'), '[data-testid="mail-compose-send"]')
  })

  test('크게 보기에서 AI 검토 탭을 열면 에디터는 숨고 검토 패널만 보인다', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/draft-coaching',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notes: [], improvedBodyHtml: '<p>개선본</p>' }) }),
    )
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('검토할 본문')
    await page.getByTestId('mail-review-tab').click()
    await expect(page.getByTestId('mail-coaching-panel')).toBeVisible()
    await expect(page.getByTestId('mail-composer-body')).toBeHidden()
    await expect(page.getByTestId('mail-composer-toolbar')).toBeHidden()
  })

  test('확대 중 링크 삽입 창은 작성창 위에 뜨고, 그 Esc 는 링크 창만 닫는다', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: '크게 보기' }).click()
    await page.getByTestId('mail-composer-body').click()
    await page.getByRole('button', { name: '링크' }).click()
    const dialog = page.getByTestId('link-url-dialog')
    await expect(dialog).toBeVisible()
    await expectOnTop(page, dialog, '[data-testid="link-url-dialog"]')
    // 링크 창의 Esc 는 링크 창만 닫고, 작성창은 확대 상태 그대로다.
    await page.getByTestId('link-url-input').press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
  })
})
