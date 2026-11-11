// 메일 계정 설정 E2E — 화면 배선(@wiring) 1건만 남긴다: /settings/mail 진입 → 목록 API → 빈 안내 → 추가 다이얼로그.
// 연결 테스트·저장·검증(WP-907·WP-928·WP-929)·전역 개인 비서 토글·수정(#448)·삭제·공급자 기본값(WP-879)·Outlook 팝업 흐름은
// src/pages/settings/mailSettings.test.tsx(화면 컴포넌트 테스트)가 지킨다.
import { expect, test } from '../../fixtures/auth.fixture';
import { mailAccount } from '../../factories/mail.factory';
import { mockApi } from '../../fixtures/api-mock';
import { resizeAndSettle } from '../../fixtures/wait';

test.describe('메일 계정 설정', () => {
  test('목록 비어있을 때 안내 노출 + 추가 다이얼로그 열림', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
    // WP-879: 기본 공급자 판단 — 미스텁이면 dev 프록시로 누수되므로 IMAP(preferred=false)으로 준다.
    await mockApi(page, 'GET', '/api/v1/mail/oauth/m365/status', { preferred: false });
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    await page.goto('/settings/mail');
    const section = page.getByTestId('mail-accounts-section');
    await expect(section).toBeVisible();
    await expect(section).toContainText('연결된 메일 계정이 없습니다');
    await page.getByTestId('mail-add-trigger').click();
    await expect(page.getByTestId('mail-account-dialog')).toBeVisible();
  });
});

// WP-1468: lg(1024px) 경계를 넘나드는 폭 변경은 AppLayout 의 셸(MobileShell ↔ 데스크톱 레일)을 갈아 끼운다 — 페이지가 다시 마운트되면 열린 창·입력이 사라진다.
// matchMedia 가 jsdom 에서 셸 교체를 일으키지 못하므로 실제 브라우저 폭 변경(@layout)으로만 검증할 수 있다.
test.describe('화면 폭이 바뀌어도 입력 유지(WP-1468)', () => {
  const DESKTOP = { width: 1440, height: 900 };
  const MOBILE = { width: 390, height: 844 };
  const ACCOUNT = mailAccount({ id: 7, emailAddress: 'owner@example.test', displayName: '원래 이름' });

  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/oauth/m365/status', { preferred: false });
    await page.setViewportSize(DESKTOP);
  });

  test('추가 창의 입력이 lg 경계를 넘어도 남는다', { tag: ['@layout'] }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', []);
    await page.goto('/settings/mail');
    await page.getByTestId('mail-add-trigger').click();
    const dialog = page.getByTestId('mail-account-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('이메일 주소').fill('draft@example.test');

    await resizeAndSettle(page, MOBILE);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('이메일 주소')).toHaveValue('draft@example.test');

    await resizeAndSettle(page, DESKTOP);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('이메일 주소')).toHaveValue('draft@example.test');

    // 취소로 닫은 뒤 다시 열면 초안이 남지 않고 빈 폼이다
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toBeHidden();
    await page.getByTestId('mail-add-trigger').click();
    await expect(dialog.getByLabel('이메일 주소')).toHaveValue('');
  });

  test('수정 창의 고친 값이 폭이 바뀌어도 남는다', { tag: ['@layout'] }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [ACCOUNT]);
    await page.goto('/settings/mail');
    await page.getByTestId(`mail-account-row-${ACCOUNT.id}`).getByRole('button', { name: '수정' }).click();
    const dialog = page.getByTestId('mail-account-dialog');
    await expect(dialog.getByLabel('표시 이름(선택)')).toHaveValue('원래 이름');
    await dialog.getByLabel('표시 이름(선택)').fill('바뀐 이름');

    await resizeAndSettle(page, MOBILE);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('표시 이름(선택)')).toHaveValue('바뀐 이름');
  });
});
