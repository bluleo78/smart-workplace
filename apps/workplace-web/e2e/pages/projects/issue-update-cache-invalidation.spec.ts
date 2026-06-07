// useUpdateIssue 수정 후 검색 캐시 무효화 회귀 테스트 (refs #175)
// issueKeys.lists(deadcode) → issueKeys.search 로 수정.
// 이슈 상태 변경(PATCH) onSuccess 후 목록 검색 API가 재호출되는지 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;
const ISSUE_DETAIL_PATH = `${ISSUES_PATH}/${ISSUE_NUMBER}`;

// 이슈 목록 및 상세 공통 스텁 설정.
async function setupStubs(
  page: import('@playwright/test').Page,
  searchCallTracker: { count: number },
) {
  // 프로젝트 메타
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 이슈 검색(목록) 엔드포인트 — 호출 횟수 추적.
  // pathname === /api/v1/projects/WP/issues 이고 숫자 경로 세그먼트가 없는 GET 요청만 매칭 (상세와 구분).
  const issue = createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: '상태 변경 테스트 이슈', status: 'TODO' });
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      searchCallTracker.count += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([issue])),
      });
    },
  );

  // 이슈 상세 GET
  await page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({ summary: createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: '상태 변경 테스트 이슈', status: 'TODO' }) }),
        ),
      });
    },
  );

  // 이슈 상세 보조 엔드포인트 (watchers, labels, attachments, children)
  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route(
      (url) => url.pathname === `${ISSUE_DETAIL_PATH}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }

  // 이슈 상세 PATCH (상태 변경 → 성공 응답)
  await page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: '상태 변경 테스트 이슈', status: 'IN_PROGRESS' })),
      });
    },
  );
}

test.describe('useUpdateIssue — 검색 캐시 무효화 (#175)', () => {
  test(
    '이슈 상태 변경 후 목록 복귀 시 검색 API가 재호출된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const searchCallTracker = { count: 0 };
      await setupStubs(page, searchCallTracker);

      // 1. 이슈 목록 진입 → 검색 API 최초 호출
      await page.goto(`/projects/${PROJECT_KEY}`);
      await expect(page.getByRole('link', { name: '상태 변경 테스트 이슈' })).toBeVisible();
      const countAfterListLoad = searchCallTracker.count;
      expect(countAfterListLoad).toBeGreaterThanOrEqual(1);

      // 2. 이슈 상세 진입
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      // 헤더 타이틀 로딩 대기
      await expect(page.getByTestId('page-header').getByText('상태 변경 테스트 이슈')).toBeVisible();

      // 3. 상태를 "진행 중"으로 변경 — PATCH API 호출 트리거
      await page.getByRole('combobox', { name: '상태' }).click();
      await page.getByRole('option', { name: '진행 중' }).click();

      // PATCH 처리 대기
      await page.waitForTimeout(300);

      // 4. 목록으로 복귀 — issueKeys.search 무효화로 인해 검색 API가 재호출되어야 함
      await page.goto(`/projects/${PROJECT_KEY}`);
      await expect(page.getByRole('link', { name: '상태 변경 테스트 이슈' })).toBeVisible();

      // 검색 API가 목록 최초 진입 이후 추가로 호출됐는지 확인
      expect(searchCallTracker.count).toBeGreaterThan(countAfterListLoad);
    },
  );
});
