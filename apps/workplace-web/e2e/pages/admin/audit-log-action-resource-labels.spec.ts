// /settings/audit-logs — 액션/리소스 한글 라벨이 표 셀에 쓰이는지(배선) 회귀 (#778).
// enum → 한글 라벨 매핑 전수(PAT·드라이브 파일·전송 링크 등)와 모르는 값 경고는 auditLogLabels.test 가 지킨다(WP-412).
// 여기선 한 행으로 액션·리소스 열이 raw enum 대신 라벨을 그리고 "[AuditLog] Unknown" 경고가 없는지만 본다.

import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { mockApi, createPageResponse } from '../../fixtures/api-mock';
import { createAuditLog } from '../../factories/admin.factory';
import { expect, test } from '../../fixtures/auth.fixture';

test.describe('/settings/audit-logs — 신규 액션/리소스 한글 라벨', () => {
  test('액션·리소스 열이 raw enum 없이 한글 라벨로 표시된다', async ({ adminPage: page }) => {
    await setupAdminAuth(page);

    const consoleWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('[AuditLog] Unknown')) {
        consoleWarnings.push(msg.text());
      }
    });

    await mockApi(
      page,
      'GET',
      '/api/v1/admin/audit-logs',
      createPageResponse([
        createAuditLog({
          id: 2,
          username: 'admin',
          actionType: 'USER_TOKEN_ISSUED',
          resource: 'user_api_token',
          resourceId: '5',
          description: '사용자 PAT 발급',
        }),
      ]),
    );
    await mockApi(page, 'GET', '/api/v1/members', createPageResponse([]));

    await page.goto('/settings/audit-logs');
    await expect(page.getByRole('heading', { name: '감사 로그' })).toBeVisible();

    const row = page.locator('tbody tr');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('PAT 발급');
    await expect(row).toContainText('API 토큰');
    await expect(page.getByText('USER_TOKEN_ISSUED', { exact: true })).toHaveCount(0);
    await expect(page.getByText('user_api_token', { exact: true })).toHaveCount(0);
    expect(consoleWarnings).toEqual([]);
  });
});
