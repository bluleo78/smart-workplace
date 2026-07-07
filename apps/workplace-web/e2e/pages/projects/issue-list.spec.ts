// 팀 리스트 뷰 E2E — 아이콘 렌더(상태/우선순위/유형/담당자) + 행 전체 클릭으로 상세 이동.
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';

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

  test('필터 없이 진입하면 검색 요청에 topLevel 파라미터가 실리지 않는다 (에픽 하위 이슈 기본 표시)', async ({ authenticatedPage: page }) => {
    // 목록 기본은 전체 표시(Jira 관례) — 에픽/서브태스크 자식도 목록에 노출.
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
    expect(searchUrl!.searchParams.get('topLevel')).toBeNull();
  });

  test('topLevel=true 를 명시하면(저장뷰 등) 요청에도 그대로 실린다', async ({ authenticatedPage: page }) => {
    // 사용자가 명시적으로 상위 이슈만 보기를 선택한 경우는 여전히 존중해야 한다.
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

    await page.goto(`/projects/${KEY}?topLevel=true`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();
    expect(searchUrl).not.toBeNull();
    expect(searchUrl!.searchParams.get('topLevel')).toBe('true');
  });

  test('에픽 하위 이슈 행에는 소속 에픽 칩이 제목 오른쪽에 표시되고 클릭 시 에픽 상세로 이동한다', async ({ authenticatedPage: page }) => {
    const epicType = makeEpicType();
    // 실데이터 폭 검증: 제목·에픽 제목 모두 긴 케이스로 오버플로/겹침을 잡는다.
    const child = createIssue({
      id: 2,
      number: 8,
      title: '로그인 폼 컴포넌트 리팩터링 및 접근성 개선 — 키보드 포커스 트랩 대응',
      parent: { number: 3, title: '인증/온보딩 사용자 경험 전면 개선 에픽', type: epicType },
    });
    await mock(page, [child]);

    await page.goto(`/projects/${KEY}`);
    const row = page.getByTestId('issue-row-8');
    await expect(row).toBeVisible();
    const parentBadge = row.getByTestId('issue-row-8-parent');
    await expect(parentBadge).toBeVisible();
    await expect(parentBadge).toContainText('인증/온보딩');

    // Jira 스타일: 에픽 칩은 제목 텍스트보다 오른쪽(트레일링)에 위치해야 한다.
    const titleLink = row.getByRole('link', { name: /로그인 폼 컴포넌트 리팩터링/ });
    const titleBox = await titleLink.boundingBox();
    const chipBox = await parentBadge.boundingBox();
    expect(titleBox).not.toBeNull();
    expect(chipBox).not.toBeNull();
    expect(chipBox!.x).toBeGreaterThan(titleBox!.x);

    // 시각 검증용 스크린샷 아티팩트.
    await page.screenshot({
      path: 'test-results/tc/issue-list/epic-chip-trailing.png',
      fullPage: false,
    });

    await parentBadge.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/3$`));
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

    // 각 상태 옵션 내부에 IssueStatusIcon 이 렌더되어야 한다.
    // 옵션 자체에 텍스트 라벨이 인접해 있으므로 아이콘은 decorative(aria-hidden) 처리되어
    // 접근성 이름 중복 announce 를 피한다 (#657) — 시각 렌더 여부는 svg 존재로 확인.
    for (const value of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) {
      const option = page.getByTestId(`facet-value-status-${value}`);
      await expect(option).toBeVisible();
      await expect(option.locator('svg').first()).toHaveAttribute('aria-hidden', 'true');
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

  test('담당자 필터 facet 이 드롭다운에 노출되고, 선택 시 URL assignee 파라미터가 업데이트된다 (#363)', async ({ authenticatedPage: page }) => {
    // 수정 전: facets 배열에 assignee 없음 → + 필터 드롭다운에 담당자 항목 미노출.
    // 수정 후: 프로젝트 멤버 목록으로 담당자 facet 구성 → 드롭다운에 노출·선택 시 URL 반영.
    const member1 = createMember({ userId: 2, name: '김개발', username: 'kim@example.com' });
    const member2 = createMember({ userId: 3, name: '이테스트', username: 'lee@example.com', role: 'MEMBER' });

    await page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([member1, member2]) }),
    );
    await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    const issueRequestUrls: string[] = [];
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
      (route) => {
        issueRequestUrls.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([], null)),
        });
      },
    );

    await page.goto(`/projects/${KEY}`);

    // ── 담당자 facet 이 + 필터 드롭다운에 노출되어야 한다 ──────────────────
    await page.getByTestId('add-filter-trigger').click();
    const assigneeFacetBtn = page.getByTestId('add-filter-facet-assignee');
    await expect(assigneeFacetBtn).toBeVisible();

    // ── 담당자 facet 클릭 시 멤버 옵션이 렌더되어야 한다 ──────────────────
    await assigneeFacetBtn.click();
    await expect(page.getByTestId('facet-value-assignee-2')).toBeVisible();
    await expect(page.getByTestId('facet-value-assignee-2')).toContainText('김개발');
    await expect(page.getByTestId('facet-value-assignee-3')).toBeVisible();
    await expect(page.getByTestId('facet-value-assignee-3')).toContainText('이테스트');

    // ── 멤버 선택 시 URL 에 assignee 파라미터가 반영되어야 한다 (파이프라인 검증) ──
    // 선택 후 이슈 재조회 요청을 기다린다
    const issueRefetchPromise = page.waitForRequest(
      (req) => req.url().includes(`/projects/${KEY}/issues`) && req.url().includes('assignee=2'),
    );
    await page.getByTestId('facet-value-assignee-2').click();
    await expect(page).toHaveURL(new RegExp(`assignee=2`));

    // 이슈 요청에도 assignee 파라미터가 실려야 한다
    const issueRefetch = await issueRefetchPromise;
    const lastUrl = new URL(issueRefetch.url());
    expect(lastUrl.searchParams.get('assignee')).toBe('2');
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
    // IssueCreateDialog 는 유형 중립 문구 "새 이슈" 다이얼로그 타이틀을 포함 (#641)
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: '새 이슈' })).toBeVisible();
  });
});
