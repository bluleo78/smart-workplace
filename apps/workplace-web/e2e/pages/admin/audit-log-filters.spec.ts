// /settings/audit-logs — 감사 로그 필터 E2E (#233-A).
// actionType·resource 를 공통 FacetFilter 칩으로 전환한 뒤의 동작을 검증한다.
// - facet 선택 → audit-logs API 요청 URL 에 해당 param 이 실린다(서버 쿼리 반영).
// - 칩이 표시되고, 칩 제거 시 param 이 사라진다.
// - 단일값 제약(백엔드 .eq()): 새 값을 고르면 이전 값을 교체한다.
// - 회귀: 검색·날짜·userId·result 컨트롤이 그대로 렌더/동작한다.

import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { mockApi } from '../../fixtures/api-mock';
import { createPageResponse } from '../../fixtures/api-mock';
import { createAuditLogs } from '../../factories/admin.factory';
import { createUser } from '../../factories/auth.factory';
import { expect, test } from '../../fixtures/auth.fixture';

/**
 * 감사 로그 목록 + 사용자 dropdown 모킹 (capture 활성).
 * - audit-logs 요청을 캡처해 query param 검증에 사용한다.
 * - 사용자 dropdown(#89) 용 GET /users 도 함께 모킹.
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
    createUser({ id: 1, name: '관리자', username: 'admin', email: 'admin@example.com' }),
    createUser({ id: 2, name: '테스트 사용자', username: 'testuser', email: 'test@example.com' }),
  ];
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse(users));
  return capture;
}

test.describe('/settings/audit-logs — actionType·resource facet 필터', () => {
  test(
    'actionType facet 선택 → API param 반영 + 칩 표시, 제거 시 param 제거',
    async ({ adminPage: page }) => {
      await setupAdminAuth(page);
      const capture = await setupCapturedAuditLogMocks(page);

      await page.goto('/settings/audit-logs');
      await expect(page.getByRole('heading', { name: '감사 로그' })).toBeVisible();
      await capture.waitForRequest();

      // ＋필터 → actionType facet → '생성'(CREATE) 선택
      await page.getByTestId('add-filter-trigger').click();
      await page.getByTestId('add-filter-facet-actionType').click();
      await page.getByTestId('facet-value-actionType-CREATE').click();

      // 팝오버를 닫아 후속 요청 안정화
      await page.keyboard.press('Escape');

      // API 요청 URL 에 actionType=CREATE 반영
      await expect
        .poll(() => capture.lastRequest()?.searchParams.get('actionType'))
        .toBe('CREATE');

      // 칩 노출
      await expect(page.getByTestId('filter-chip-actionType')).toBeVisible();

      // 칩 제거 → 칩이 사라지고 facet 선택이 해제된다.
      // (빈 actionType 쿼리는 초기 쿼리와 동일 키라 TanStack Query 캐시 적중 → 신규 네트워크 미발생.
      //  따라서 param 부재는 새 요청이 아닌 facet value 상태로 검증한다.)
      await page.getByTestId('filter-chip-actionType-remove').click();
      await expect(page.getByTestId('filter-chip-actionType')).toHaveCount(0);
      // ＋필터를 다시 열어 CREATE 체크가 해제되었는지(상태 초기화) 확인
      await page.getByTestId('add-filter-trigger').click();
      await page.getByTestId('add-filter-facet-actionType').click();
      await expect(
        page.getByTestId('facet-value-actionType-CREATE').getByRole('checkbox'),
      ).not.toBeChecked();
    },
  );

  test('resource facet 선택 → API param 반영 + 칩 표시', async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    const capture = await setupCapturedAuditLogMocks(page);

    await page.goto('/settings/audit-logs');
    await expect(page.getByRole('heading', { name: '감사 로그' })).toBeVisible();
    await capture.waitForRequest();

    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-resource').click();
    await page.getByTestId('facet-value-resource-pipeline').click();
    await page.keyboard.press('Escape');

    await expect
      .poll(() => capture.lastRequest()?.searchParams.get('resource'))
      .toBe('pipeline');
    await expect(page.getByTestId('filter-chip-resource')).toBeVisible();
  });

  test('단일값 제약: actionType 새 값 선택 시 이전 값 교체', async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    const capture = await setupCapturedAuditLogMocks(page);

    await page.goto('/settings/audit-logs');
    await expect(page.getByRole('heading', { name: '감사 로그' })).toBeVisible();
    await capture.waitForRequest();

    // CREATE 선택
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-actionType').click();
    await page.getByTestId('facet-value-actionType-CREATE').click();
    await expect
      .poll(() => capture.lastRequest()?.searchParams.get('actionType'))
      .toBe('CREATE');

    // 같은 facet 값 리스트에서 UPDATE 선택 → 단일값이므로 CREATE 를 교체
    await page.getByTestId('facet-value-actionType-UPDATE').click();
    await page.keyboard.press('Escape');

    await expect
      .poll(() => capture.lastRequest()?.searchParams.get('actionType'))
      .toBe('UPDATE');
  });

  test(
    '회귀: 검색·날짜·userId·result 컨트롤이 그대로 동작한다',
    { tag: '@smoke' },
    async ({ adminPage: page }) => {
      await setupAdminAuth(page);
      const capture = await setupCapturedAuditLogMocks(page);

      await page.goto('/settings/audit-logs');
      await expect(page.getByRole('heading', { name: '감사 로그' })).toBeVisible();
      await capture.waitForRequest();

      // 검색 입력 → search param 반영 (debounce)
      await page.getByPlaceholder('설명으로 검색...').fill('로그인');
      await expect
        .poll(() => capture.lastRequest()?.searchParams.get('search'))
        .toBe('로그인');

      // 시작 날짜 입력 → startDate param 반영
      await page.getByLabel('시작 날짜').fill('2026-01-01');
      await expect
        .poll(() => capture.lastRequest()?.searchParams.has('startDate'))
        .toBe(true);

      // userId Select → 단일값 필터 그대로 (드롭다운 렌더 확인)
      await expect(page.getByLabel('사용자 필터')).toBeVisible();

      // result Select 그대로 렌더
      await expect(page.getByLabel('결과 필터')).toBeVisible();
    },
  );
});
