// /settings/roles — 역할 목록 페이지 E2E.
// 사용자에게 할당된 커스텀 역할을 삭제하려 하면 백엔드가 400으로 차단하고,
// 그 사유(할당된 사용자 수)가 토스트로 그대로 노출되는지 검증한다 (#678).

import { expect, test } from '../../fixtures/auth.fixture';
import { setupAdminAuth, setupRoleListMocks } from '../../fixtures/admin.fixture';
import { mockApi } from '../../fixtures/api-mock';

test.describe('/settings/roles — 할당된 역할 삭제 차단', () => {
  test('사용자에게 할당된 역할 삭제 시도 → 400 에러 메시지가 토스트로 노출되고 목록에서 사라지지 않음', async ({
    adminPage: page,
  }) => {
    await setupAdminAuth(page);
    await setupRoleListMocks(page);
    // 커스텀 역할(id=3, EDITOR) 삭제 시도 → 백엔드가 할당된 사용자 수를 포함한 400 반환
    await mockApi(
      page,
      'DELETE',
      '/api/v1/roles/3',
      { message: '1명의 사용자에게 할당된 역할은 삭제할 수 없습니다: EDITOR' },
      { status: 400 },
    );

    await page.goto('/settings/roles');
    await expect(page.getByRole('cell', { name: 'EDITOR', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'EDITOR 역할 삭제' }).click();
    await page.getByRole('button', { name: '삭제', exact: true }).click();

    // 백엔드가 반환한 구체적 사유(할당 인원 수)가 그대로 토스트에 노출되어야 함
    await expect(page.getByText('1명의 사용자에게 할당된 역할은 삭제할 수 없습니다: EDITOR')).toBeVisible();

    // 삭제가 거부되었으므로 목록에는 여전히 남아있어야 함
    await expect(page.getByRole('cell', { name: 'EDITOR', exact: true })).toBeVisible();
  });

  test('할당된 사용자가 없는 커스텀 역할 삭제 → 정상 삭제되고 목록에서 사라짐', async ({ adminPage: page }) => {
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
});
