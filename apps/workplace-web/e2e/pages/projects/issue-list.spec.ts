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

  test('필터 상태·우선순위 드롭다운 옵션에 아이콘이 렌더된다 (#295)', async ({ authenticatedPage: page }) => {
    // 수정 전: 상태/우선순위 옵션은 render prop 없이 텍스트만 노출 — 이슈 행 아이콘과 시각 불일치.
    // 수정 후: IssueStatusIcon / IssuePriorityBars 가 render prop 으로 주입됨.
    await page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([], null)),
        }),
    );

    await page.goto(`/projects/${KEY}`);

    // ── 상태 필터 아이콘 검증 ──────────────────────────────────────────────
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-status').click();

    // 각 상태 옵션 내부에 IssueStatusIcon (role=img + aria-label) 이 렌더되어야 한다.
    for (const [value, ariaLabel] of [
      ['TODO', '상태: 할 일'],
      ['IN_PROGRESS', '상태: 진행 중'],
      ['DONE', '상태: 완료'],
      ['CANCELED', '상태: 취소'],
    ]) {
      const option = page.getByTestId(`facet-value-status-${value}`);
      await expect(option).toBeVisible();
      await expect(option.locator('[role="img"]').first()).toHaveAttribute('aria-label', ariaLabel);
    }

    // ── 우선순위 필터 아이콘 검증 ──────────────────────────────────────────
    // 뒤로 가서 우선순위 탭으로 이동
    await page.keyboard.press('Escape');
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-priority').click();

    // 각 우선순위 옵션 내부에 IssuePriorityBars (role=img) 이 렌더되어야 한다.
    for (const [value] of [['LOW'], ['MID'], ['HIGH']]) {
      const option = page.getByTestId(`facet-value-priority-${value}`);
      await expect(option).toBeVisible();
      await expect(option.locator('[role="img"]').first()).toBeVisible();
    }
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

  test('필터 활성 + 결과 0건 → SearchX 아이콘·설명·"필터 초기화" CTA 표시, 버튼 클릭 시 필터 제거 후 이슈 재요청 (#337)', async ({ authenticatedPage: page }) => {
    // 수정 전: "표시할 태스크가 없습니다." 텍스트만.
    // 수정 후: SearchX 아이콘 + 제목 + 설명 + "필터 초기화" 버튼 — 클릭 시 q 파라미터 제거 후 이슈 row 노출.
    await page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );

    const requestUrls: string[] = [];
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
      (route) => {
        const url = route.request().url();
        requestUrls.push(url);
        const hasQ = new URL(url).searchParams.has('q');
        // q 파라미터가 있으면 빈 결과, 없으면 이슈 1건 반환
        const body = hasQ
          ? JSON.stringify(createIssueSearchResponse([], null))
          : JSON.stringify(createIssueSearchResponse([createIssue({ number: 5, title: '정상 이슈' })], null));
        return route.fulfill({ status: 200, contentType: 'application/json', body });
      },
    );

    await page.goto(`/projects/${KEY}?q=xxxxxxxxxnotfound`);

    // empty-filter 컨테이너와 필수 텍스트 검증
    await expect(page.getByTestId('empty-filter')).toBeVisible();
    await expect(page.getByText('검색 결과가 없습니다')).toBeVisible();
    await expect(page.getByText('다른 키워드나 필터 조건을 사용해 보세요.')).toBeVisible();
    const resetBtn = page.getByTestId('empty-reset-filter');
    await expect(resetBtn).toBeVisible();

    // "필터 초기화" 클릭 → URL 에서 q 파라미터 제거 → 이슈 재요청
    await resetBtn.click();

    // URL 에 q 가 없어야 한다
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));

    // 이슈 row 가 렌더됨(재요청 결과 반영) — 파이프라인 출력 검증
    await expect(page.getByTestId('issue-row-5')).toBeVisible();

    // 마지막 요청(필터 초기화 후)에 q 파라미터가 없어야 한다
    const lastUrl = new URL(requestUrls[requestUrls.length - 1]);
    expect(lastUrl.searchParams.has('q')).toBe(false);
  });

  test('필터 없는 초기 빈 상태 → LayoutList 아이콘·"이슈가 없습니다"·"새 태스크 만들기" CTA 표시 (#337)', async ({ authenticatedPage: page }) => {
    // 수정 전: "표시할 태스크가 없습니다." 텍스트만.
    // 수정 후: LayoutList 아이콘 + 제목 + 설명 + "새 태스크 만들기" 버튼.
    await page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse([], null)) }),
    );
    // IssueCreateDialog 가 열릴 때 useIssueTypes 가 호출됨
    await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto(`/projects/${KEY}`);

    await expect(page.getByTestId('empty-no-issues')).toBeVisible();
    await expect(page.getByText('이슈가 없습니다')).toBeVisible();
    await expect(page.getByText('새 태스크를 만들어 프로젝트를 시작하세요.')).toBeVisible();

    // "새 태스크 만들기" 버튼 클릭 → IssueCreateDialog 열림 확인
    const createBtn = page.getByTestId('empty-create-issue');
    await expect(createBtn).toBeVisible();
    await createBtn.click();
    // IssueCreateDialog 는 "새 태스크" 다이얼로그 타이틀을 포함
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: '새 태스크' })).toBeVisible();
  });
});
