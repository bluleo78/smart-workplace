// 메일 작성·발송 E2E — 도크 배선(@wiring)과 브라우저가 필요한 것만 남긴다(백엔드 없이 page.route 모킹).
// IME·포커스·Tab·읽기 창 Esc(@input), 읽기 창 크기·좁은 폭 접기·AI 패널 배치·스크롤·링크 창 겹침·토스트 위치(@layout).
// 서식 토글·답장 inReplyTo·인용문 지운 작성·모듈 이탈 뒤 유지·보낸편지함 쿼리·읽기 창 전환(왕복·닫기·✕ 저장·검토 탭)은
// src/pages/mail/mailCompose.test.tsx(vitest, WP-984·WP-1743)가 지킨다.
import { mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { commitImeThenEnterInSameTask } from '../../fixtures/ime'
import { trackRequests } from '../../fixtures/requests'
import { expectOnTop } from '../../fixtures/mobile.fixture'

test.describe('메일 작성·발송', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // 메일 계정 1건 + 빈 INBOX 기본 모킹.
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
  })

  test('새 메일 작성 → 발송 payload 검증 + 도크 닫힘', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
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

  // WP-333 — macOS Chrome 에서 한글 마지막 글자 조합 중 Enter 를 쳐도 그 글자가 남고 다음 문단으로 넘어간다(수정 뒤 동작 회귀 방지 —
  // 실제 입력기의 글자 소실은 합성 이벤트로 재현되지 않는다. wiki-ime-enter.spec.ts 참고).
  test('본문에서 마지막 글자 조합 중 Enter — 글자가 남고 문단이 나뉘어 발송된다 (Mac Chrome 순서)', { tag: '@input' }, async ({
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
  test('작성 도크가 region 랜드마크로 노출되고, 열리면 "받는사람"에 포커스된다 (#802)', { tag: '@input' }, async ({
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
  test('수신자 없이 발송 → 검증 에러 토스트가 상단에 표시되고 보내기 버튼을 가리지 않음', { tag: '@layout' }, async ({
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

  test('작성 도크 입력 필드 키보드 포커스 이동 (focus-visible ring)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

})

// WP-1743 — 데스크톱 작성창을 메일 읽기 자리로 옮긴다. 옛 「크게 보기」 가운데 큰 모달은 없어지고 그 자리를 읽기 창이 잇는다.
// 읽기 창은 페이지 일부라 배경(backdrop)·대화상자·inert 가 없다 — 전환 왕복·읽기 자리 채움·뒤 화면과의 겹침·좁은 폭/AI 전체 화면 접기·스크롤·링크 창 겹침을 여기서 본다.
// 전환 자체(호스트 이동·본문 유지·닫기)는 src/pages/mail/mailComposePane.test.tsx 가, Esc·닫기 등 나머지 상태 전환은 mailCompose.test.tsx(vitest) 가 지킨다.
test.describe('메일 작성창 읽기 창 (WP-1743)', () => {
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

  /** 지금 작성창 호스트가 읽기 자리 슬롯 안에 있는가 — 전환·복귀 판정을 한곳에서(포털 없이 DOM 만 옮긴다). */
  async function hostInPane(page: import('@playwright/test').Page) {
    return page.evaluate(() => document.querySelector('[data-compose-host]')?.closest('[data-testid="mail-compose-pane-slot"]') != null)
  }

  /** 작성창 패널(mail-compose-dock) 박스 — 작은 창/읽기 창 어디에 있든 같은 locator 로 잡는다. */
  async function dockBox(page: import('@playwright/test').Page) {
    return (await page.getByTestId('mail-compose-dock').boundingBox())!
  }

  /** 읽기 자리(mail-detail-pane) 박스 — 읽기 창 패널이 이 박스를 그대로 채우는지 비교한다. */
  async function detailBox(page: import('@playwright/test').Page) {
    return (await page.getByTestId('mail-detail-pane').boundingBox())!
  }

  /** 두 박스가 같은 자리·같은 크기인가(레이 측정 오차 2px 허용). */
  function sameBox(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2)
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(2)
  }

  test('「읽기 창으로」 → 읽기 자리 박스를 채우고, 「우측 하단으로」로 왕복한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const small = await dockBox(page)
    expect(small.width).toBeLessThan(560)
    const smallEditor = (await page.getByTestId('mail-composer-body').boundingBox())!

    await page.getByTestId('mail-compose-to-pane').click()
    await expect.poll(() => hostInPane(page)).toBe(true)
    // 읽기 창 패널이 읽기 자리 박스를 그대로 채운다 — 호스트만 옮겨 슬롯이 레이아웃에 끼지 않는다(display: contents).
    sameBox(await dockBox(page), await detailBox(page))
    // 모달(가운데 큰 창)의 대화상자는 없다 — 읽기 창은 페이지 일부다(설계 결정 7).
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // 에디터는 남은 높이를 채운다 — 작은 창의 상한(40vh)보다 확실히 크다(옛 크게 보기와 같은 높이 규칙).
    const editor = (await page.getByTestId('mail-composer-body').boundingBox())!
    expect(editor.height).toBeGreaterThan(smallEditor.height)
    expect(editor.height).toBeGreaterThan(page.viewportSize()!.height * 0.4)

    await page.getByTestId('mail-compose-to-dock').click()
    await expect.poll(() => hostInPane(page)).toBe(false)
    // 우측 하단 작은 창으로 돌아왔고(32rem), 접힌 상태라 본문 영역은 숨어 있다 — 쓰던 내용은 남아 있다(vitest 가 확인).
    expect((await dockBox(page)).width).toBeLessThan(560)
    await expect(page.getByTestId('mail-composer-body')).toBeHidden()
  })

  test('「읽기 창으로」 중에도 뒤 화면을 쓴다 — AI 옆 패널을 열어도 작성창은 읽기 창에 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/home/sessions**', (r) => r.fulfill({ json: { items: [], nextCursor: null } }))
    await page.getByTestId('mail-compose-subject').fill('AI 와 함께')
    await page.getByTestId('mail-compose-to-pane').click()
    await expect.poll(() => hostInPane(page)).toBe(true)
    // 뒤 화면이 잠기지 않는다 — 페이지 직접 자식에 inert 가 없고, 상단 칩도 그대로 눌린다(모달 배경이 없어졌다).
    expect(await page.evaluate(() => document.querySelector('[data-ai-page-root] > [inert]') == null)).toBe(true)
    const chip = page.getByTestId('chat-launcher')
    await expectOnTop(page, chip, '[data-testid="chat-launcher"]')
    expect(await chip.evaluate((el) => el.closest('[inert]') != null)).toBe(false)
    await chip.click()
    const panel = page.getByTestId('ai-side-panel')
    await expect(panel).toBeVisible()
    // 쓰던 제목은 그대로, 작성창은 읽기 자리에서 움직이지 않는다 — 옛 모달의 "패널 왼쪽 가운데 재배치"는 없다.
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('AI 와 함께')
    await expect(async () => {
      expect(await hostInPane(page)).toBe(true)
      const d = await dockBox(page)
      const p = (await panel.boundingBox())!
      expect(d.x + d.width).toBeLessThanOrEqual(p.x + 1)
    }).toPass()
    await expectOnTop(page, panel, '[data-testid="ai-side-panel"]')
  })

  test('AI 전체 화면에서는 우측 하단으로 접히고, 돌아와 「읽기 창으로」로 다시 들어간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/home/sessions**', (r) => r.fulfill({ json: { items: [], nextCursor: null } }))
    await page.getByTestId('mail-compose-subject').fill('전체 화면 전환')
    await page.getByTestId('mail-compose-to-pane').click()
    await expect.poll(() => hostInPane(page)).toBe(true)
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    await page.getByTestId('ai-mode-fullscreen').click()
    // AI 전체 화면은 가려지지 않고 쓸 수 있다 — 접기 규칙(size → dock)에 따라 작성창은 읽기 창 대신 우측 하단 작은 창으로 접힌다.
    // 레이아웃만 바꾸고 size 를 pane 에 두면 읽기 자리 상세가 감춰진 채 빈 읽기 자리가 남는다(설계 결정 5).
    expect((await dockBox(page)).width).toBeLessThan(560)
    // 그동안 「읽기 창으로」 는 쓸 수 없다 — 쓸 수 없는 이유가 툴팁에 있다.
    const toPane = page.getByTestId('mail-compose-to-pane')
    await expect(toPane).toBeDisabled()
    await expect(toPane).toHaveAttribute('title', 'AI 전체 화면에서는 읽기 창 대신 우측 하단을 씁니다')
    // 옆 패널로 돌아와도 자동 복귀는 없다 — 접기는 조건이 없어져도 되돌리지 않는다(좁은 폭 접기와 같은 규칙).
    const modeSide = page.getByTestId('ai-mode-side')
    expect(await modeSide.evaluate((el) => el.closest('[inert]') != null)).toBe(false)
    await modeSide.click()
    // 이미 접혀 있어 이 poll 은 첫 시도에 참이 된다 — 바로 뒤 단언(읽기 자리 상세가 보인다·「읽기 창으로」 가 다시 켜진다)이 실제 판정이다.
    await expect.poll(() => hostInPane(page)).toBe(false)
    // 접혀 있으니 읽기 자리에 메일 상세가 다시 보인다 — 빈 읽기 자리가 남지 않는다.
    await expect(page.getByTestId('mail-detail-pane')).toBeVisible()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('전체 화면 전환')
    // 「읽기 창으로」 를 다시 눌러 읽기 창으로 들어간다(단추는 다시 쓸 수 있다).
    await expect(toPane).toBeEnabled()
    await toPane.click()
    await expect.poll(() => hostInPane(page)).toBe(true)
    await expect(async () => {
      sameBox(await dockBox(page), await detailBox(page))
    }).toPass()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('전체 화면 전환')
  })

  test('좁은 폭에서 읽기 창은 우측 하단으로 접히고, 본문은 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.getByTestId('mail-compose-subject').fill('셸 전환')
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('좁아져도 남는 본문')
    await page.getByTestId('mail-compose-to-pane').click()
    await expect.poll(() => hostInPane(page)).toBe(true)
    const pageArea = () =>
      page.evaluate(() => Array.from(document.querySelector('[data-ai-page-root]')!.querySelectorAll('main')).every((el) => el.closest('[inert]') != null))
    await page.setViewportSize({ width: 800, height: 900 }) // lg(1024px) 미만 → 접기 규칙(폭 < 1024 → min): 읽기 창이 우측 하단으로 접힌다
    await expect.poll(() => hostInPane(page)).toBe(false)
    // 모바일 셸이라 데스크톱 헤더(「읽기 창으로」 자리) 자체가 그려지지 않는다 — 좁은 폭에선 다시 올라갈 수 없다.
    await expect(page.getByTestId('mail-compose-to-pane')).toHaveCount(0)
    // 모바일 셸의 작성 화면은 시트(뒤가 잠긴다) — 이 규칙은 그대로다.
    await expect.poll(pageArea).toBe(true)
    await page.setViewportSize({ width: 1440, height: 900 }) // 다시 데스크톱 셸 — 자동 복귀는 없다(접힌 채 유지)
    // 이미 접혀 있어 이 poll 은 첫 시도에 참이 된다 — 바로 뒤 단언(본문이 숨어 있다)이 실제 판정이다.
    await expect.poll(() => hostInPane(page)).toBe(false)
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('셸 전환')
    // 접혔을 뿐 본문은 남아 있다 — 최소화로 숨겼을 뿐 에디터를 다시 만들지 않았다.
    const body = page.getByTestId('mail-composer-body')
    await expect(body).toBeHidden()
    await expect(body).toHaveText('좁아져도 남는 본문')
    await page.getByTestId('mail-compose-minimize').click()
    await expect(body).toBeVisible()
    await expect(body).toHaveText('좁아져도 남는 본문')
    // 다시 그려진 뒤에도 뒤는 잠기지 않고(모달 inert 없음) 목록 단추도 그대로 눌린다.
    expect(await page.evaluate(() => document.querySelector('[data-ai-page-root] > [inert]') == null)).toBe(true)
    expect(await page.getByTestId('mail-compose-new').evaluate((el) => el.closest('[inert]') != null)).toBe(false)
  })

  test('읽기 창에서 Esc 를 눌러도 접히지 않는다 — 접기는 「우측 하단으로」 단추뿐', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await page.getByTestId('mail-compose-subject').fill('Esc 를 눌러도 그대로')
    await page.getByTestId('mail-compose-to-pane').click()
    await expect.poll(() => hostInPane(page)).toBe(true)
    await page.locator('#mail-compose-dock-title').click()
    await page.keyboard.press('Escape')
    // 옛 크게 보기의 Esc(작게 보기) 규칙은 없어졌다 — Esc 로는 접히지도 닫히지도 않는다(설계 결정 7, 접기는 단추로만).
    await expect.poll(() => hostInPane(page)).toBe(true)
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('Esc 를 눌러도 그대로')
  })

  test('읽기 창에서 본문이 길어 스크롤돼도 서식 버튼과 보내기가 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.getByTestId('mail-compose-to-pane').click()
    await expect.poll(() => hostInPane(page)).toBe(true)
    await page.getByTestId('mail-composer-body').click()
    for (let i = 0; i < 60; i++) {
      await page.keyboard.type(`줄 ${i}`)
      await page.keyboard.press('Enter')
    }
    const pane = await dockBox(page)
    const within = async (testId: string) => {
      const box = (await page.getByTestId(testId).boundingBox())!
      return box.y >= pane.y - 1 && box.y + box.height <= pane.y + pane.height + 1
    }
    // 본문 끝(커서 위치)으로 스크롤된 상태 — 툴바는 위에 붙어 있고 보내기는 아래에 남는다.
    await expect.poll(() => within('mail-composer-toolbar')).toBe(true)
    await expect.poll(() => within('mail-compose-send')).toBe(true)
    await expectOnTop(page, page.getByRole('button', { name: '굵게' }), '[data-testid="mail-composer-toolbar"] button')
    await expectOnTop(page, page.getByTestId('mail-compose-send'), '[data-testid="mail-compose-send"]')
  })

  test('읽기 창에서 링크 삽입 창은 작성창 위에 뜨고, 그 Esc 는 링크 창만 닫는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.getByTestId('mail-compose-to-pane').click()
    await expect.poll(() => hostInPane(page)).toBe(true)
    await page.getByTestId('mail-composer-body').click()
    await page.getByRole('button', { name: '링크' }).click()
    const dialog = page.getByTestId('link-url-dialog')
    await expect(dialog).toBeVisible()
    await expectOnTop(page, dialog, '[data-testid="link-url-dialog"]')
    // 링크 창의 Esc 는 링크 창만 닫고, 읽기 창은 그대로다(접히지 않는다).
    await page.getByTestId('link-url-input').press('Escape')
    await expect(dialog).toBeHidden()
    await expect.poll(() => hostInPane(page)).toBe(true)
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
  })
})
