// 메일 계정 설정 E2E — ProfilePage 의 MailAccountsSection + MailAccountDialog 검증.
// 백엔드 없이 page.route() 모킹으로 동작한다.

import { expect, test } from '../../fixtures/auth.fixture';
import { mockApi } from '../../fixtures/api-mock';
import type { MailAccountResponse } from '../../../src/types/mailAccount';

/** 기본 메일 계정 픽스처 생성 */
function account(overrides?: Partial<MailAccountResponse>): MailAccountResponse {
  return {
    id: 1,
    emailAddress: 'me@example.com',
    displayName: '내 계정',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'SSL_TLS',
    imapUsername: 'me@example.com',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    smtpUsername: 'me@example.com',
    aiEnabled: false,
    lastTestedAt: '2026-06-03T00:00:00Z',
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
    ...overrides,
  };
}

test.describe('메일 계정 설정', () => {
  test('목록 비어있을 때 안내 노출 + 추가 다이얼로그 열림', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    await page.goto('/settings/mail');
    const section = page.getByTestId('mail-accounts-section');
    await expect(section).toBeVisible();
    await expect(section).toContainText('연결된 메일 계정이 없습니다');
    await page.getByTestId('mail-add-trigger').click();
    await expect(page.getByTestId('mail-account-dialog')).toBeVisible();
  });

  test('연결 테스트 성공 → 저장 → 목록 표시', async ({ authenticatedPage: page }) => {
    // 초기 빈 목록
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    // POST /test — IMAP·SMTP 모두 성공
    await mockApi(page, 'POST', '/api/v1/mail/accounts/test', {
      imapOk: true,
      imapError: null,
      smtpOk: true,
      smtpError: null,
    });
    // POST /accounts — 계정 생성 응답
    await mockApi(page, 'POST', '/api/v1/mail/accounts', account());
    await page.goto('/settings/mail');

    // 추가 다이얼로그 열기
    await page.getByTestId('mail-add-trigger').click();

    // Gmail 프리셋 선택 — Radix Select: trigger 클릭 → option 선택
    await page.getByRole('combobox', { name: 'provider 프리셋' }).click();
    await page.getByRole('option', { name: 'Gmail' }).click();

    // 필수 필드 입력
    await page.locator('#mail-email').fill('me@example.com');
    await page.locator('#mail-imap-user').fill('me@example.com');
    await page.locator('#mail-smtp-user').fill('me@example.com');
    await page.locator('#mail-pw').fill('app-password');

    // 테스트 전 저장 버튼은 비활성
    await expect(page.getByTestId('mail-save-button')).toBeDisabled();

    // 연결 테스트 클릭
    await page.getByTestId('mail-test-button').click();
    await expect(page.getByTestId('mail-test-result')).toContainText('IMAP ✓');
    await expect(page.getByTestId('mail-test-result')).toContainText('SMTP ✓');

    // 저장 후 목록 응답을 미리 등록 (Playwright route는 LIFO — 나중 등록이 우선)
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [account()]);

    // 저장 클릭 → 다이얼로그 닫힘 → 목록 행 표시
    await page.getByTestId('mail-save-button').click();
    await expect(page.getByTestId('mail-account-row-1')).toContainText('me@example.com');
  });

  test('연결 테스트 실패 → 에러 표시 + 저장 비활성', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    await mockApi(page, 'POST', '/api/v1/mail/accounts/test', {
      imapOk: false,
      imapError: '인증 실패 — 사용자명 또는 비밀번호를 확인하세요',
      smtpOk: true,
      smtpError: null,
    });
    await page.goto('/settings/mail');
    await page.getByTestId('mail-add-trigger').click();

    // 직접 입력 모드 — 모든 필드 수동 입력
    await page.locator('#mail-email').fill('me@example.com');
    await page.locator('#mail-imap-host').fill('imap.x.com');
    await page.locator('#mail-imap-user').fill('me@example.com');
    await page.locator('#mail-smtp-host').fill('smtp.x.com');
    await page.locator('#mail-smtp-user').fill('me@example.com');
    await page.locator('#mail-pw').fill('bad');

    await page.getByTestId('mail-test-button').click();
    await expect(page.getByTestId('mail-test-result')).toContainText('인증 실패');
    await expect(page.getByTestId('mail-save-button')).toBeDisabled();
  });

  test('수정 다이얼로그 — AI 비서 토글 활성화 후 저장 시 PUT payload 에 aiEnabled: true 포함', async ({ authenticatedPage: page }) => {
    // GET: aiEnabled=false 인 계정 1건
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [account({ aiEnabled: false })]);
    // PUT /api/v1/mail/accounts/1 — capture: true 로 payload 캡처
    const capture = await mockApi(page, 'PUT', '/api/v1/mail/accounts/1', account({ aiEnabled: true }), { capture: true });

    await page.goto('/settings/mail');

    // 수정 버튼 클릭 → 수정 다이얼로그 열기
    await page.getByTestId('mail-account-row-1').getByRole('button', { name: '수정' }).click();
    await expect(page.getByTestId('mail-account-dialog')).toBeVisible();

    // AI 비서 토글 클릭 (false → true)
    await page.getByTestId('mail-ai-enabled').click();

    // 저장
    await page.getByTestId('mail-save-button').click();

    // PUT body 에 aiEnabled: true 포함 확인
    const req = await capture.waitForRequest();
    expect((req.payload as Record<string, unknown>).aiEnabled).toBe(true);
  });

  test('계정 삭제', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [account()]);
    await mockApi(page, 'DELETE', '/api/v1/mail/accounts/1', {}, { status: 204 });
    await page.goto('/settings/mail');
    await expect(page.getByTestId('mail-account-row-1')).toBeVisible();

    // 삭제 후 빈 목록 응답을 미리 등록
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);

    await page.getByTestId('mail-delete-1').click();
    await expect(page.getByTestId('mail-account-row-1')).toBeHidden();
  });
});
