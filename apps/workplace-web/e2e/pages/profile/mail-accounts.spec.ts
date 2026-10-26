// 메일 계정 설정 E2E — 화면 배선(@wiring) 1건만 남긴다: /settings/mail 진입 → 목록 API → 빈 안내 → 추가 다이얼로그.
// 연결 테스트·저장·검증(WP-907·WP-928·WP-929)·전역 개인 비서 토글·수정(#448)·삭제·공급자 기본값(WP-879)·Outlook 팝업 흐름은
// src/pages/settings/mailSettings.test.tsx(화면 컴포넌트 테스트)가 지킨다.
import { expect, test } from '../../fixtures/auth.fixture';
import { mockApi } from '../../fixtures/api-mock';

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
