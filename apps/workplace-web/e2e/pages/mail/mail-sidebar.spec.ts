// 메일 사이드바 E2E — 계정 스위처(멀티계정 전환) · 폴더 nav active.
import { mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('메일 사이드바', () => {
  test('계정 스위처 → 다른 계정 선택 시 /mail/:id 이동 + 폴더 INBOX 초기화', async ({
    authenticatedPage: page,
  }) => {
    // 계정 2개.
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [
      mailAccount({ id: 1, emailAddress: 'me@example.com' }),
      mailAccount({ id: 2, emailAddress: 'work@example.com' }),
    ])
    // 두 계정의 메시지 목록은 빈 배열로 스텁(folder 파라미터 수집).
    const seen: { id: string; folder: string }[] = []
    for (const id of ['1', '2']) {
      await page.route(
        (url) => url.pathname === `/api/v1/mail/accounts/${id}/messages`,
        (route) => {
          seen.push({ id, folder: new URL(route.request().url()).searchParams.get('folder') ?? '' })
          return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        },
      )
    }

    // 계정 2의 보낸편지함에서 시작.
    await page.goto('/mail/2?folder=sent')
    await expect(page.getByTestId('mail-account-switcher')).toContainText('work@example.com')

    // 스위처 열고 계정 1 선택 → /mail/1 (folder 파라미터 제거 = INBOX).
    await page.getByTestId('mail-account-switcher').click()
    await page.getByTestId('mail-account-1').click()
    await expect(page).toHaveURL(/\/mail\/1$/)
    await expect(page.getByTestId('mail-account-switcher')).toContainText('me@example.com')
    // 전환 후 계정 1 목록 요청의 folder 는 SENT 가 아니어야 한다(INBOX 초기화).
    await expect.poll(() => seen.some((s) => s.id === '1' && s.folder !== 'SENT')).toBe(true)
  })

  test('폴더 nav active — 보낸편지함 진입 시 aria-current', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.goto('/mail/1?folder=sent')
    await expect(page.getByTestId('mail-folder-sent')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('mail-folder-inbox')).not.toHaveAttribute('aria-current', 'page')
  })
})
