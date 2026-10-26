// /settings/roles — 역할 목록 페이지 E2E.
// 역할 삭제 성공 → 목록 재조회 배선(@wiring)과 행 키보드 진입(@input).
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

  // #810 — 행이 role=button 이 아니거나 Enter/Space 로 활성화되지 않으면 키보드 사용자는
  // 상세 화면에 진입할 방법이 없었다.
  test('역할 행을 키보드(Tab+Enter)로 상세 페이지 이동 가능하다 (#810)', { tag: '@input' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    await setupRoleListMocks(page);

    await page.goto('/settings/roles');
    const row = page.getByRole('button', { name: 'EDITOR 상세 보기' });
    await expect(row).toBeVisible();

    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\/roles\/3/);
  });
});
