// /settings/audit-logs — 액션/리소스 한글 라벨 매핑 회귀 (#778).
// ACTION_TYPES/RESOURCES 매핑 상수가 오래된 스냅샷이라 최근 추가된 백엔드 이벤트(PAT 발급/회수,
// 드라이브 파일 업로드/삭제/공유, 구성원 계정 생성 등)의 한글 라벨이 누락되어 영문 raw enum이
// 그대로 노출되던 문제를 검증한다.
// - 신규 actionType/resource 값을 모킹 데이터에 포함시켜 테이블 셀에 한글 라벨이 표시되는지 확인.
// - raw enum 문자열이 그대로 노출되지 않는지, 콘솔에 "[AuditLog] Unknown" 경고가 뜨지 않는지도 확인.

import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { mockApi, createPageResponse } from '../../fixtures/api-mock';
import { createAuditLog } from '../../factories/admin.factory';
import { expect, test } from '../../fixtures/auth.fixture';

test.describe('/settings/audit-logs — 신규 액션/리소스 한글 라벨', () => {
  test('FILE_UPLOAD/drive 등 신규 값이 raw 노출 없이 한글 라벨로 표시된다', async ({
    adminPage: page,
  }) => {
    await setupAdminAuth(page);

    const consoleWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('[AuditLog] Unknown')) {
        consoleWarnings.push(msg.text());
      }
    });

    const logs = [
      createAuditLog({
        id: 1,
        username: 'uploader',
        actionType: 'FILE_UPLOAD',
        resource: 'drive',
        resourceId: '10',
        description: '드라이브 파일 업로드: report.pdf',
      }),
      createAuditLog({
        id: 2,
        username: 'admin',
        actionType: 'USER_TOKEN_ISSUED',
        resource: 'user_api_token',
        resourceId: '5',
        description: '사용자 PAT 발급',
      }),
      createAuditLog({
        id: 3,
        username: 'admin',
        actionType: 'MEMBER_CREATED',
        resource: 'user',
        resourceId: '20',
        description: '구성원 계정 생성: newmember (역할 MEMBER)',
      }),
    ];

    await mockApi(page, 'GET', '/api/v1/admin/audit-logs', createPageResponse(logs));
    await mockApi(page, 'GET', '/api/v1/members', createPageResponse([]));

    await page.goto('/settings/audit-logs');
    await expect(page.getByRole('heading', { name: '감사 로그' })).toBeVisible();

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);

    // 한글 라벨 표시 확인
    await expect(rows.nth(0)).toContainText('파일 업로드');
    await expect(rows.nth(0)).toContainText('드라이브');
    await expect(rows.nth(1)).toContainText('PAT 발급');
    await expect(rows.nth(1)).toContainText('API 토큰');
    await expect(rows.nth(2)).toContainText('구성원 계정 생성');

    // raw enum 값이 그대로 노출되지 않음
    await expect(page.getByText('FILE_UPLOAD', { exact: true })).toHaveCount(0);
    await expect(page.getByText('USER_TOKEN_ISSUED', { exact: true })).toHaveCount(0);
    await expect(page.getByText('MEMBER_CREATED', { exact: true })).toHaveCount(0);
    await expect(page.getByText('user_api_token', { exact: true })).toHaveCount(0);

    // "매핑 없음" 콘솔 경고가 발생하지 않아야 함
    expect(consoleWarnings).toEqual([]);
  });
});
