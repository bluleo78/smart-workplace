// /settings/audit-logs — 브라우저가 있어야 판정되는 감사 로그 필터 E2E.
// - 검색칸 maxlength 가 긴 붙여 넣기를 200자로 자른다(@input), 긴 검색어 빈 결과 문구가 표를 넓히지 않는다(@layout),
//   행을 키보드로 열 수 있다(@input).
// facet(액션·리소스) 칩 → 요청 파라미터, 검색·날짜 파라미터, 범위 밖·거꾸로 된 날짜 안내(WP-899·WP-910)는
// src/pages/admin/auditLog.test.tsx 가 지킨다(WP-966). 단일값 규칙은 auditLogLabels.test(lastFacetValue)(WP-412).

import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { mockApi } from '../../fixtures/api-mock';
import { createPageResponse } from '../../fixtures/api-mock';
import { createAuditLogs } from '../../factories/admin.factory';
import { createMember } from '../../factories/auth.factory';
import { expect, test } from '../../fixtures/auth.fixture';

/**
 * 감사 로그 목록 + 사용자 dropdown 모킹 (capture 활성).
 * - audit-logs 요청을 캡처해 query param 검증에 사용한다.
 * - 사용자 dropdown(#89) 용 구성원 디렉터리 GET /members 도 함께 모킹(#833).
 */
async function setupCapturedAuditLogMocks(page: import('@playwright/test').Page) {
  const capture = await mockApi(
    page,
    'GET',
    '/api/v1/admin/audit-logs',
    createPageResponse(createAuditLogs(3)),
    { capture: true },
  );
  const users = [
    createMember({ userId: 1, name: '관리자', username: 'admin', email: 'admin@example.com' }),
    createMember({ userId: 2, name: '테스트 사용자', username: 'testuser', email: 'test@example.com' }),
  ];
  await mockApi(page, 'GET', '/api/v1/members', createPageResponse(users));
  return capture;
}

test.describe('/settings/audit-logs — 검색칸 입력·빈 결과 폭·키보드 진입', () => {
  // WP-732 — 긴 글을 붙여 넣어도 검색어는 200자로 잘려, 요청 줄 한도를 넘겨 목록이 실패하지 않는다.
  test('검색칸에 긴 글을 넣으면 200자로 잘려 요청된다', { tag: '@input' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    const capture = await setupCapturedAuditLogMocks(page);
    await page.goto('/settings/audit-logs');
    await capture.waitForRequest();

    const input = page.getByPlaceholder('설명으로 검색...');
    await input.fill('가'.repeat(3000));
    await expect(input).toHaveValue('가'.repeat(200));
    await expect.poll(() => capture.lastRequest()?.searchParams.get('search')).toBe('가'.repeat(200));
  });

  // WP-732 — 긴 검색어로 결과가 0건이면 빈 결과 문구가 검색어를 줄여 보이고, 표를 가로로 늘리지 않는다.
  test('긴 검색어의 빈 결과 문구는 줄여 보이고 표 너비를 넘지 않는다', { tag: '@layout' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    await setupCapturedAuditLogMocks(page);
    await page.route(
      (url) => url.pathname === '/api/v1/admin/audit-logs' && url.searchParams.has('search'),
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createPageResponse([])) }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings/audit-logs');
    await page.getByPlaceholder('설명으로 검색...').fill('가'.repeat(200));

    const empty = page.getByText('에 대한 결과가 없습니다.');
    await expect(empty).toBeVisible();
    await expect(page.getByText(`'${'가'.repeat(40)}…'`)).toBeVisible();
    // 표(가로 스크롤 영역)가 문구 때문에 넓어지지 않는다
    const table = page.locator('table').first();
    const { scroll, client } = await table.evaluate((el) => {
      const box = el.parentElement as HTMLElement;
      return { scroll: box.scrollWidth, client: box.clientWidth };
    });
    expect(scroll).toBeLessThanOrEqual(client + 1);
  });

  // #810 — 행이 클릭 전용이라 키보드로는 상세 다이얼로그를 열 수 없었다.
  test('감사 로그 행을 키보드(Tab+Enter)로 상세 다이얼로그를 열 수 있다 (#810)', { tag: '@input' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    await setupCapturedAuditLogMocks(page);

    await page.goto('/settings/audit-logs');
    const row = page.getByRole('button', { name: 'testuser — 생성 상세 보기' }).first();
    await expect(row).toBeVisible();

    await expect(page.getByRole('heading', { name: '감사 로그 상세' })).toHaveCount(0);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '감사 로그 상세' })).toBeVisible();
  });
});
