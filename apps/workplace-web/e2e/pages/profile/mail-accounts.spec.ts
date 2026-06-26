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

  // M365 Outlook 연결 — 팝업 흐름

  /**
   * M365 팝업 흐름 공통 진입 헬퍼.
   * 다이얼로그를 열고 공급자를 Outlook(M365_GRAPH)으로 선택한다.
   * `/api/v1/mail/accounts` 빈 목록 모킹을 포함한다.
   */
  async function openMailDialogWithM365(page: import('@playwright/test').Page) {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    await page.goto('/settings/mail');
    await page.getByTestId('mail-add-trigger').click();
    await expect(page.getByTestId('mail-account-dialog')).toBeVisible();
    await page.getByRole('combobox', { name: '공급자' }).click();
    await page.getByRole('option', { name: 'Outlook (Microsoft 365)' }).click();
    // "Outlook 계정 연결" 버튼이 노출될 때까지 대기
    await expect(page.getByRole('button', { name: 'Outlook 계정 연결' })).toBeVisible();
  }

  test.describe('M365 Outlook 연결 — 팝업 흐름', () => {
    test('연결 버튼 → 팝업 open + /start 호출 + connecting 상태, 성공 메시지 수신 시 토스트', async ({
      authenticatedPage: page,
    }) => {
      // window.open 을 제어 가능한 가짜 팝업으로 스텁(실제 MS 이동 방지)
      await page.addInitScript(() => {
        ;(window as unknown as { __openCalls: string[] }).__openCalls = []
        const fakePopup = {
          location: { href: '' },
          closed: false,
          close() {
            this.closed = true
          },
        }
        window.open = ((url?: string) => {
          ;(window as unknown as { __openCalls: string[] }).__openCalls.push(url ?? '')
          ;(window as unknown as { __popup: typeof fakePopup }).__popup = fakePopup
          return fakePopup as unknown as Window
        }) as typeof window.open
      })

      await page.route('**/api/v1/mail/oauth/m365/start', async (route) => {
        await route.fulfill({ status: 200, json: { authorizeUrl: 'https://login.microsoftonline.com/authorize?x=1' } })
      })

      await openMailDialogWithM365(page)

      await page.getByRole('button', { name: 'Outlook 계정 연결' }).click()

      // window.open 동기 호출 + 이후 authorizeUrl 로드 검증
      await expect.poll(() => page.evaluate(() => (window as unknown as { __openCalls: string[] }).__openCalls.length)).toBeGreaterThan(0)
      await expect.poll(() => page.evaluate(() => (window as unknown as { __popup: { location: { href: string } } }).__popup.location.href)).toContain('login.microsoftonline.com')

      // connecting 상태 노출
      await expect(page.getByText('Microsoft 창에서 인증을 진행하세요')).toBeVisible()

      // 성공 메시지 수신 모사(postMessage)
      await page.evaluate(() => {
        window.postMessage({ source: 'm365-oauth', ok: true }, window.location.origin)
      })

      await expect(page.getByText('Outlook 메일 계정이 연결되었습니다.')).toBeVisible()
      // 성공 시 다이얼로그가 닫혀야 함
      await expect(page.getByTestId('mail-account-dialog')).toBeHidden()
    })

    test('실패 메시지 수신 시 인라인 에러', async ({ authenticatedPage: page }) => {
      await page.addInitScript(() => {
        window.open = (() => ({ location: { href: '' }, closed: false, close() {} } as unknown as Window)) as typeof window.open
      })
      await page.route('**/api/v1/mail/oauth/m365/start', async (route) => {
        await route.fulfill({ status: 200, json: { authorizeUrl: 'https://login.microsoftonline.com/authorize' } })
      })
      await openMailDialogWithM365(page)
      await page.getByRole('button', { name: 'Outlook 계정 연결' }).click()
      await page.evaluate(() => window.postMessage({ source: 'm365-oauth', ok: false, error: 'connect_failed' }, window.location.origin))
      await expect(page.getByText('Outlook 계정 연결에 실패했습니다')).toBeVisible()
    })

    test('팝업 차단(window.open null) 시 즉시 에러', async ({ authenticatedPage: page }) => {
      await page.addInitScript(() => {
        window.open = (() => null) as typeof window.open
      })
      // window.open null 즉시 return 이라 /start 는 호출되지 않음 → 모킹 불필요
      await openMailDialogWithM365(page)
      await page.getByRole('button', { name: 'Outlook 계정 연결' }).click()
      await expect(page.getByText('팝업이 차단되었습니다')).toBeVisible()
    })

    test('/start 조회 실패 시 일반 연결 실패 에러(팝업차단과 구분)', async ({ authenticatedPage: page }) => {
      // 팝업은 정상 열리지만 authorizeUrl 조회가 5xx 로 실패 → .catch 경로 → error phase
      await page.addInitScript(() => {
        window.open = (() => ({ location: { href: '' }, closed: false, close() {} } as unknown as Window)) as typeof window.open
      })
      await page.route('**/api/v1/mail/oauth/m365/start', async (route) => {
        await route.fulfill({ status: 500, json: { message: 'server error' } })
      })
      await openMailDialogWithM365(page)
      await page.getByRole('button', { name: 'Outlook 계정 연결' }).click()
      // 팝업차단 문구가 아니라 일반 연결 실패 문구가 떠야 함
      await expect(page.getByText('Outlook 계정 연결에 실패했습니다')).toBeVisible()
      await expect(page.getByText('팝업이 차단되었습니다')).toBeHidden()
    })
  })

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
