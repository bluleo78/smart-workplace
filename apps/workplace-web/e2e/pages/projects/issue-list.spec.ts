// 팀 리스트 뷰 E2E — 아이콘 렌더(상태/우선순위/유형/담당자) + 행 전체 클릭으로 상세 이동.
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';

async function mock(page: import('@playwright/test').Page, issues: ReturnType<typeof createIssue>[]) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues, null)),
      });
    },
  );
}

test.describe('팀 리스트 뷰', () => {
  test('행에 상태·우선순위·담당자 아이콘 렌더 + 행 전체 클릭으로 상세 이동', async ({ authenticatedPage: page }) => {
    const issue = createIssue({
      id: 1,
      number: 7,
      title: '로그인 버그 수정',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignees: [{ id: 2, username: 'kim', name: '김개발', kind: 'HUMAN' }],
    });
    await mock(page, [issue]);

    await page.goto(`/projects/${KEY}`);
    const row = page.getByTestId('issue-row-7');
    await expect(row).toBeVisible();
    await expect(row.getByLabel('상태: 진행 중')).toBeVisible();
    await expect(row.getByLabel('우선순위 높음')).toBeVisible();
    await expect(row.getByText('김')).toBeVisible();

    // 제목이 아닌 '마감 셀' 클릭 → 상세 라우트로 이동(전체 클릭, #234 버그 해결).
    await row.getByTestId('issue-row-7-due').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/7$`));
  });

  test('필터 없이 진입하면 검색 요청에 topLevel=true 가 실린다 (서브태스크 혼재 제거 #168)', async ({ authenticatedPage: page }) => {
    // 보드/목록 기본은 상위 이슈만 — SUBTASK 는 부모 상세에서만 관리.
    // 백엔드 필터링 대신 요청 쿼리 파라미터를 직접 검증(견고).
    await page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    let searchUrl: URL | null = null;
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        searchUrl = new URL(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([createIssue({ number: 7 })], null)),
        });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();
    expect(searchUrl).not.toBeNull();
    expect(searchUrl!.searchParams.get('topLevel')).toBe('true');
  });

  test('제목 링크 클릭은 history 를 한 번만 쌓는다(뒤로가기 1번에 리스트 복귀) (#234)', async ({ authenticatedPage: page }) => {
    // 제목 <Link> 가 행 onClick 으로 버블하면 navigate 가 두 번 발생해 뒤로가기 1번으로는 같은 상세로 되돌아온다.
    // stopPropagation 회귀 검증: 제목 클릭 → 상세, 뒤로가기 1번 → 리스트.
    const issue = createIssue({ id: 1, number: 7, title: '로그인 버그 수정', status: 'TODO', priority: 'MID' });
    await mock(page, [issue]);

    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('issue-row-7').getByText('로그인 버그 수정').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/7$`));

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
  });
});
