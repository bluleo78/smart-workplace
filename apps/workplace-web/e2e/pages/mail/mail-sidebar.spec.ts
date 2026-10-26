// 메일 사이드바 E2E — 선택 폴더의 계산된 선택 표시(배경·막대)만 남긴다(@layout, jsdom 은 CSS 를 계산하지 않는다).
// 계정 스위처 전환·aria-current·하위 분류 안 읽은 수·category=all·AI 분류 꺼짐은
// src/pages/mail/mailSidebar.test.tsx(vitest, WP-984)가 지킨다.
import { mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectSelectedRow } from '../../fixtures/selection'

test.describe('메일 사이드바', () => {
  test('폴더 nav active — 보낸편지함 진입 시 aria-current', { tag: '@layout' }, async ({
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
    // WP-368 — 선택 폴더는 hover 와 구분되는 선택 전용 표시(막대 + bg-selected), 비선택은 없다(계산된 배경까지 본다).
    await expectSelectedRow(page.getByTestId('mail-folder-sent'), page.getByTestId('mail-folder-inbox'))
  })
})
