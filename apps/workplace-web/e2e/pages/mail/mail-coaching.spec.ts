// 초안 코칭 E2E — 작성 도크 "AI 검토" 탭. 백엔드 없이 page.route 모킹.
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

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

  // 도크 오픈 → AI 검토 탭 → 노트 + 개선본 렌더 → 개선본으로 교체
  test('AI 검토 탭 → 노트·개선본 → 개선본으로 교체', async ({ authenticatedPage: page }) => {
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    // 답장으로 작성 도크 오픈
    await page.getByTestId('mail-reply').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    // 본문에 초안 입력 (ProseMirror contenteditable — fill 대신 click + type)
    const body = page.getByTestId('mail-composer-body')
    await body.click()
    await page.keyboard.type('자료 빨리 보내주세요')

    // AI 검토 탭
    await page.getByTestId('mail-review-tab').click()
    await expect(page.getByTestId('mail-coaching-note')).toContainText('명령조가 강해요')
    // 개선본은 sandboxed iframe 내부에 렌더되므로 frameLocator 로 접근.
    const improvedFrame = page.frameLocator('[data-testid="mail-coaching-improved"]')
    await expect(improvedFrame.locator('body')).toContainText('다듬은 개선본입니다')

    // 개선본으로 교체 → 본문 반영
    await page.getByTestId('mail-coaching-apply').click()
    await expect(page.getByTestId('mail-composer-body')).toContainText('다듬은 개선본입니다')
  })

  // 빈 초안에서는 AI 검토 탭 비활성. 판별자는 hasBody 단독(#765) — 새 메일로
  // "본문이 비어 있는" 상태를 재현한다.
  test('빈 초안 → AI 검토 비활성', async ({ authenticatedPage: page }) => {
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-compose-quote')).toHaveCount(0)
    await expect(page.getByTestId('mail-review-tab')).toBeDisabled()
  })

  // #765 — 코칭 payload 에는 인용문이 실리지 않으므로(§6) 답장에 인용문이 남아 있어도
  // 본문을 비우면 검토할 초안이 없다. 게이트가 "인용문만 있어도 활성" 으로 풀리는 회귀를 막는다.
  test('본문을 비우면 인용문이 남아 있어도 AI 검토는 비활성 (#765)', async ({ authenticatedPage: page }) => {
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

  // AI 비서 꺼짐(503) — 서버 친화적 메시지가 인-탭 안내로 표시되는지 검증
  test('AI off(503) → 서버 메시지 인-탭 안내', async ({ authenticatedPage: page }) => {
    // beforeEach 의 draft-coaching mock 을 503 으로 덮어쓴다.
    await page.route((u) => u.pathname === '/api/v1/mail/draft-coaching',
      (route) => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '이 계정은 AI 비서가 꺼져 있어요. 계정 설정에서 켜주세요.' }),
      }))

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-reply').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    const body = page.getByTestId('mail-composer-body')
    await body.click()
    await page.keyboard.type('AI 꺼진 상태 테스트')

    // AI 검토 탭 클릭 → 503 응답 → 인-탭 에러 메시지 확인
    await page.getByTestId('mail-review-tab').click()
    await expect(page.getByTestId('mail-coaching-error'))
      .toContainText('이 계정은 AI 비서가 꺼져 있어요. 계정 설정에서 켜주세요.')
  })
})
