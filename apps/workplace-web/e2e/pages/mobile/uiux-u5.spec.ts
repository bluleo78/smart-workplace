// 모바일 U5 — U4(길게 누르기 작업 시트·이슈 채팅 드로워 URL) 코드 리뷰 수정과 접근성 보강.
// C1 드로워 닫힘 가드 · C2 수정 중 행은 길게 누르기 제외 · C3 복사 실패 안내 · A1 스크린리더용 "메시지 작업" 버튼.
import { DETAIL, KEY, longPress, stubChannelMessages, stubIssue } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'

test.describe('C1 이슈 채팅 드로워 — 앞으로가기로 다시 열린 뒤에도 닫힌다', () => {
  test('열기 → ‹ 닫기 → 브라우저 앞으로가기(드로워 다시 열림) → ‹ 로 다시 닫힌다', async ({ authenticatedPage: page }) => {
    await stubIssue(page)
    await page.goto(`/projects/${KEY}/issues/1`)
    const drawer = page.getByTestId('issue-chat-drawer')

    await page.getByTestId('issue-chat-open').tap()
    await expect(drawer).toBeVisible()
    await drawer.getByTestId('issue-chat-drawer-back').tap()
    await expect(drawer).toHaveCount(0)
    await expect(page).toHaveURL(DETAIL)

    await page.goForward()
    await expect(page).toHaveURL(/[?&]chat=1$/)
    await expect(drawer).toBeVisible()
    await drawer.getByTestId('issue-chat-drawer-back').tap()
    await expect(drawer).toHaveCount(0)
    await expect(page).toHaveURL(DETAIL)
  })
})

test.describe('C2 수정 중인 메시지는 길게 누르기 대상이 아니다', () => {
  test('인라인 에디터 안에서 길게 눌러도 작업 시트가 열리지 않고, 텍스트 선택이 막히지 않는다', async ({ authenticatedPage: page }) => {
    await stubChannelMessages(page)
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId('message-body-11'))
    await page.getByTestId('message-action-edit').tap()
    const editor = page.getByTestId('message-editor-input-11')
    await expect(editor).toBeFocused()
    // 수정 중 행은 select-none·콜아웃 억제를 풀어 커서 이동·붙여넣기·선택이 되게 한다.
    await expect(page.getByTestId('message-11')).not.toHaveCSS('user-select', 'none')
    // 수정 중엔 스크린리더용 작업 버튼도 없다(길게 누르기와 같은 조건).
    await expect(page.getByTestId('message-11').getByRole('button', { name: '메시지 작업' })).toHaveCount(0)

    await longPress(page, editor)
    // 부재 확인 — 판정 시간(450ms)을 넘겨 누른 뒤에도 시트가 뜨지 않는지 잠시 더 기다려 본다(WP-82 허용 사유).
    // eslint-disable-next-line playwright/no-wait-for-timeout -- 판정 시간 이후에도 시트가 뜨지 않음(부재) 확인
    await page.waitForTimeout(300)
    await expect(page.getByTestId('message-action-sheet')).toHaveCount(0)
  })
})

test.describe('C3 복사 실패는 안내한다', () => {
  test('클립보드 API 가 없고 대체 복사도 실패하면 "메시지를 복사하지 못했습니다" 토스트', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined })
      document.execCommand = () => false
    })
    await stubChannelMessages(page)
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId('message-body-11'))
    await page.getByTestId('message-action-copy').tap()
    await expect(page.getByText('메시지를 복사하지 못했습니다')).toBeVisible()
  })

  test('writeText 가 거부되고 대체 복사도 실패하면 "메시지를 복사하지 못했습니다" 토스트', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: () => Promise.reject(new Error('denied')) }),
      })
      document.execCommand = () => false
    })
    await stubChannelMessages(page)
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId('message-body-11'))
    await page.getByTestId('message-action-copy').tap()
    await expect(page.getByText('메시지를 복사하지 못했습니다')).toBeVisible()
  })

  test('writeText 성공 시 멘션은 @이름 평문으로 복사된다', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied?: string }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: (t: string) => ((w.__copied = t), Promise.resolve()) }),
      })
    })
    await stubChannelMessages(page)
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId('message-body-10'))
    await page.getByTestId('message-action-copy').tap()
    await expect(page.getByText('메시지를 복사했습니다')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe('@동료 확인 부탁해요')
  })
})

test.describe('A1 스크린리더용 "메시지 작업" 버튼', () => {
  test('팀 채팅: 행마다 시각적으로 숨긴 버튼이 있고, 누르면 같은 작업 시트가 열린다', async ({ authenticatedPage: page }) => {
    await stubChannelMessages(page)
    await page.goto('/chat/channels/1')
    const button = page.getByTestId('message-10').getByRole('button', { name: '메시지 작업' })
    await expect(button).toHaveCount(1)
    await expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    // 레이아웃에 영향 없음(sr-only — 1px 이하).
    const box = (await button.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(1)
    expect(box.height).toBeLessThanOrEqual(1)

    // 보조 기술의 활성화(포커스 + Enter)로 연다.
    await button.focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByTestId('message-action-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('message-action-thread')).toBeVisible()
    await expect(sheet.getByTestId('message-action-edit')).toHaveCount(0)
    // 작업 없이 닫으면(ESC) 포커스가 연 버튼으로 돌아온다 — 스크린리더 사용자가 제자리를 잃지 않게.
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(button).toBeFocused()
  })

  test('이슈 채팅: 본인 메시지 버튼은 수정·삭제가 있는 시트를 연다', async ({ authenticatedPage: page }) => {
    await stubIssue(page)
    await page.goto(`/projects/${KEY}/issues/1?chat=1`)
    const button = page.getByTestId('chat-message-502').getByRole('button', { name: '메시지 작업' })
    await expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    await button.focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByTestId('message-action-sheet')
    await expect(sheet.getByTestId('message-action-edit')).toBeVisible()
    await expect(sheet.getByTestId('message-action-delete')).toBeVisible()
  })
})
