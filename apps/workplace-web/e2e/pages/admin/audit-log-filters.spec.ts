// /settings/audit-logs — 감사 로그 필터 E2E (#233-A).
// actionType·resource 를 공통 FacetFilter 칩으로 전환한 뒤의 동작을 검증한다.
// - facet 선택 → audit-logs API 요청 URL 에 해당 param 이 실린다(서버 쿼리 반영).
// - 칩이 표시되고, 칩 제거 시 param 이 사라진다.
// - 단일값 제약(백엔드 .eq()): 새 값을 고르면 이전 값을 교체한다 — 규칙은 auditLogLabels.test(lastFacetValue)가 지킨다(WP-412).
// - 회귀: 검색·날짜·userId·result 컨트롤이 그대로 렌더/동작한다.

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

  // WP-899 — 날짜 칸이 받는 최대 연도(275760-09-13)를 넣으면 ISO 변환이 RangeError 를 던져 화면 전체가 무너졌다.
  // 범위(1900~9999) 밖 날짜는 조건에서 빼고 칸 아래에 안내하며, 목록은 그대로 보인다.
  test('종료 날짜에 범위 밖 연도를 넣어도 화면이 무너지지 않고, 그 날짜는 조건에서 빼고 안내한다 (WP-899)', async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    const capture = await setupCapturedAuditLogMocks(page);
    await page.goto('/settings/audit-logs');
    await capture.waitForRequest();

    // fill 은 5자리 이상 연도를 받지 않아 칸의 값을 직접 넣고 React 에 input 이벤트를 보낸다(키보드로 칠 수 있는 값).
    const end = page.getByLabel('종료 날짜');
    await end.evaluate((el: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '275760-09-13');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.getByTestId('audit-log-date-error')).toContainText('날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다');
    await expect(end).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('heading', { name: '감사 로그' })).toBeVisible();
    await expect(page.getByText('페이지를 불러오는 중 문제가 발생했습니다')).toHaveCount(0);
    expect(capture.lastRequest()?.searchParams.has('endDate')).toBe(false);

    // 범위 안 날짜로 고치면 안내가 사라지고 조건으로 보낸다.
    await end.fill('2026-01-31');
    await expect(page.getByTestId('audit-log-date-error')).toHaveCount(0);
    await expect.poll(() => capture.lastRequest()?.searchParams.has('endDate')).toBe(true);
  });

  // WP-732 — 긴 글을 붙여 넣어도 검색어는 200자로 잘려, 요청 줄 한도를 넘겨 목록이 실패하지 않는다.
  test('검색칸에 긴 글을 넣으면 200자로 잘려 요청된다', async ({ adminPage: page }) => {
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
  test('긴 검색어의 빈 결과 문구는 줄여 보이고 표 너비를 넘지 않는다', async ({ adminPage: page }) => {
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
  test('감사 로그 행을 키보드(Tab+Enter)로 상세 다이얼로그를 열 수 있다 (#810)', async ({ adminPage: page }) => {
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
