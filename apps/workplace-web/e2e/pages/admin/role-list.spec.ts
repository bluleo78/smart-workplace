// /settings/roles — 역할 목록 페이지 E2E.
// 역할 삭제 성공 → 목록 재조회 배선(@wiring)과 역할 이름 링크 키보드 진입(@input, WP-1555).
// 할당된 역할 삭제 400 사유 토스트(#678)는 src/pages/admin/roles.test.tsx 가 지킨다(WP-966).

import { expect, test } from '../../fixtures/auth.fixture';
import { setupAdminAuth, setupRoleListMocks } from '../../fixtures/admin.fixture';
import { mockApi } from '../../fixtures/api-mock';

test.describe('/settings/roles — 역할 삭제·키보드 진입', () => {
  test('할당된 사용자가 없는 커스텀 역할 삭제 → 정상 삭제되고 목록에서 사라짐', { tag: '@wiring' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    await setupRoleListMocks(page);
    await mockApi(page, 'DELETE', '/api/v1/roles/3', null, { status: 204 });

    await page.goto('/settings/roles');
    await expect(page.getByRole('cell', { name: 'EDITOR', exact: true })).toBeVisible();

    // 삭제 성공 후 목록 재조회는 EDITOR 를 제외한 목록으로 응답
    await mockApi(page, 'GET', '/api/v1/roles', [
      { id: 1, name: 'USER', description: '일반 사용자', isSystem: true },
      { id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true },
    ]);

    await page.getByRole('button', { name: 'EDITOR 역할 삭제' }).click();
    await page.getByRole('button', { name: '삭제', exact: true }).click();

    await expect(page.getByText('역할 "EDITOR"가 삭제되었습니다.')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'EDITOR', exact: true })).not.toBeVisible();
  });

  // #810 — 키보드 사용자가 상세 화면에 진입할 방법이 있어야 한다. WP-1555: 행 대신 이름 링크가 그 진입점이다.
  test('역할 이름 링크를 키보드(Enter)로 눌러 상세로 이동한다 (#810·WP-1555)', { tag: '@input' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    await setupRoleListMocks(page);

    await page.goto('/settings/roles');
    const link = page.getByRole('link', { name: 'EDITOR' });
    await expect(link).toBeVisible();

    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\/roles\/3/);
  });
});
