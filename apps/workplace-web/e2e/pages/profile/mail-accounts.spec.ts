// 메일 계정 설정 E2E — ProfilePage 의 MailAccountsSection + MailAccountDialog 검증.
// 백엔드 없이 page.route() 모킹으로 동작한다.

import { expect, test } from '../../fixtures/auth.fixture';
import { mockApi } from '../../fixtures/api-mock';
import type { MailAccountResponse } from '../../../src/types/mailAccount';

/** 기본 메일 계정 픽스처 생성 */
function account(overrides?: Partial<MailAccountResponse>): MailAccountResponse {
  return {
    id: 1,
    provider: 'IMAP', // #499 — provider 필드 필수
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
    lastSyncedAt: null, // #481 자동동기화로 추가된 필수 필드 — 미동기화 기본값
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
    await expect(page.getByTestId('mail-test-imap')).toContainText('IMAP 연결됨');
    await expect(page.getByTestId('mail-test-smtp')).toContainText('SMTP 연결됨');

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

  test('수정 다이얼로그 — 비밀번호 미입력 연결 테스트는 id 기반 엔드포인트 호출 + 성공 표시 (#448)', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [account()]);
    // 수정 모드 테스트는 /accounts/{id}/test 로 가야 한다(저장 비밀번호 폴백). payload 캡처.
    const capture = await mockApi(
      page,
      'POST',
      '/api/v1/mail/accounts/1/test',
      { imapOk: true, imapError: null, smtpOk: true, smtpError: null },
      { capture: true },
    );

    await page.goto('/settings/mail');

    // 수정 다이얼로그 열기 — 비밀번호는 프리필되지 않아 빈 값
    await page.getByTestId('mail-account-row-1').getByRole('button', { name: '수정' }).click();
    await expect(page.getByTestId('mail-account-dialog')).toBeVisible();
    await expect(page.locator('#mail-pw')).toHaveValue('');

    // 비밀번호 입력 없이 연결 테스트
    await page.getByTestId('mail-test-button').click();
    await expect(page.getByTestId('mail-test-imap')).toContainText('IMAP 연결됨');
    await expect(page.getByTestId('mail-test-smtp')).toContainText('SMTP 연결됨');

    // id 기반 엔드포인트로 갔고, 비밀번호는 빈 값으로 전송됨(서버가 저장값으로 폴백)
    const req = await capture.waitForRequest();
    expect(req.url.pathname).toBe('/api/v1/mail/accounts/1/test');
    expect((req.payload as Record<string, unknown>).password).toBe('');
  });

  test('계정 삭제 — 확인 AlertDialog 후 실행', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [account()]);
    await mockApi(page, 'DELETE', '/api/v1/mail/accounts/1', {}, { status: 204 });
    await page.goto('/settings/mail');
    await expect(page.getByTestId('mail-account-row-1')).toBeVisible();

    // 삭제 버튼 클릭 → AlertDialog 표시 확인 (#182)
    await page.getByTestId('mail-delete-1').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toContainText('이 계정과 연결된 동기화 메일이 모두 삭제됩니다.');

    // 취소 → 행 유지
    await page.getByRole('button', { name: '취소' }).click();
    await expect(page.getByTestId('mail-account-row-1')).toBeVisible();

    // 재클릭 → 확인 → 삭제 실행
    await page.getByTestId('mail-delete-1').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();

    // 삭제 후 빈 목록 응답을 미리 등록
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);

    await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click();
    await expect(page.getByTestId('mail-account-row-1')).toBeHidden();
  });

  test('메일 설정 페이지 제목', async ({ authenticatedPage: page }) => {
    // 빈 목록 모킹(컴포넌트 크래시 방지)
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    await page.goto('/settings/mail');
    await expect(page.getByRole('heading', { name: '메일 설정' })).toBeVisible();
  });

  // #499 — provider 선택 분기 검증
  test('Outlook provider 선택 시 OAuth 버튼 렌더', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    await page.goto('/settings/mail');
    // 다이얼로그 열기
    await page.getByTestId('mail-add-trigger').click();
    await expect(page.getByTestId('mail-account-dialog')).toBeVisible();

    // 공급자 셀렉트(shadcn/Radix combobox) — trigger 클릭 → option 선택
    await page.getByRole('combobox', { name: '공급자' }).click();
    await page.getByRole('option', { name: 'Outlook (Microsoft 365)' }).click();

    // "Outlook 계정 연결" 버튼이 표시되고, IMAP 호스트 필드는 사라져야 함
    await expect(page.getByRole('button', { name: 'Outlook 계정 연결' })).toBeVisible();
    await expect(page.locator('#mail-imap-host')).toHaveCount(0);
  });

  // #499 — OAuth 콜백 복귀(mail_connected=1) 시 토스트 + 목록 refetch
  test('?mail_connected=1 복귀 시 성공 토스트 표시', async ({ authenticatedPage: page }) => {
    // /profile?mail_connected=1 → React Router Navigate → /settings/profile?mail_connected=1
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [account({ provider: 'M365_GRAPH' })]);
    await page.goto('/settings/profile?mail_connected=1');
    // 성공 토스트가 표시돼야 함
    await expect(page.getByText('Outlook 메일 계정이 연결되었습니다.')).toBeVisible();
  });

  // #499 — Outlook 버튼 클릭 시 인증 axios로 /start 조회 후 AAD URL로 이동
  test('Outlook 계정 연결 버튼 클릭 시 axios GET /start → AAD URL로 이동', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    // /start 가 JSON {authorizeUrl} 반환하도록 모킹(C1 수정: 302 대신 200 JSON)
    await mockApi(page, 'GET', '/api/v1/mail/oauth/m365/start', {
      authorizeUrl: 'https://login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize?state=test',
    });
    // AAD URL 실제 탐색 차단 — 빈 응답으로 fulfill
    await page.route('**login.microsoftonline.com**', (route) => route.fulfill({ status: 200, body: '' }));

    await page.goto('/settings/mail');
    await page.getByTestId('mail-add-trigger').click();

    // Outlook 공급자 선택
    await page.getByRole('combobox', { name: '공급자' }).click();
    await page.getByRole('option', { name: 'Outlook (Microsoft 365)' }).click();

    // "Outlook 계정 연결" 버튼 클릭
    await page.getByRole('button', { name: 'Outlook 계정 연결' }).click();

    // AAD URL로 이동됐는지 확인 (login.microsoftonline.com)
    await expect(page).toHaveURL(/login\.microsoftonline\.com/, { timeout: 5000 });
  });

  // #499 — M365_GRAPH provider 계정 행에 'Outlook' 라벨 표시
  test('M365_GRAPH 계정 행에 Outlook 라벨 표시', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [
      account({ provider: 'M365_GRAPH', imapHost: '', lastTestedAt: null }),
    ]);
    await page.goto('/settings/mail');
    const row = page.getByTestId('mail-account-row-1');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Outlook');
  });
});
