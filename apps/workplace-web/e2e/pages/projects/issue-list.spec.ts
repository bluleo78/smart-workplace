// 팀 리스트 뷰 E2E — 아이콘 렌더(상태/우선순위/유형/담당자) + 행 전체 클릭으로 상세 이동.
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { seedStatuses, withCustomStatuses } from '../../factories/projectStatus.factory';
import { expectStays } from '../../fixtures/wait';

const KEY = 'WP';

// 이슈 검색 — 프로젝트 메타 스텁 + 검색 GET 의 마지막 요청 URL 을 돌려주는 getter 반환(행 1개 응답).
async function captureSearch(page: import('@playwright/test').Page) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  const searches = trackRequests(page, 'GET', `/api/v1/projects/${KEY}/issues`);
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([createIssue({ number: 7 })], null)),
      });
    },
  );
  return () => searches.lastUrl() ?? null;
}

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

  test('마감 지난 미완료 이슈 행만 마감일이 빨간색 + 「마감 지남」 — 완료·미래 마감은 그대로 (WP-649)', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 1, title: '지난 마감', status: 'IN_PROGRESS', dueDate: '2020-01-15' }),
      createIssue({ id: 2, number: 2, title: '완료된 지난 마감', status: 'DONE', dueDate: '2020-01-15' }),
      createIssue({ id: 3, number: 3, title: '먼 미래 마감', status: 'TODO', dueDate: '2099-01-15' }),
    ]);
    await page.goto(`/projects/${KEY}`);
    const due = (n: number) => page.getByTestId(`issue-row-${n}-due`);
    await expect(due(1)).toContainText('마감 지남');
    await expect(due(1)).toHaveClass(/text-destructive/);
    for (const n of [2, 3]) {
      await expect(due(n)).not.toContainText('마감 지남');
      await expect(due(n)).not.toHaveClass(/text-destructive/);
    }
  });

  test('필터 없이 진입하면 검색 요청에 topLevel 없이 excludeSubtasks·excludeEpics=true 가 실린다 (에픽 행 숨김·에픽 자식 유지·SUBTASK 숨김)', async ({ authenticatedPage: page }) => {
    // 목록 기본(Jira 관례, #874): 에픽 행은 숨기고, 루트 + 에픽 직속 자식은 노출하되 SUBTASK 는 숨긴다.
    // → topLevel(루트만) 은 끄고(미송신), excludeSubtasks·excludeEpics 는 켜서 요청한다.
    // 백엔드 필터링 대신 요청 쿼리 파라미터를 직접 검증(견고).
    const lastSearch = await captureSearch(page);

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();
    expect(lastSearch()).not.toBeNull();
    expect(lastSearch()!.searchParams.get('topLevel')).toBeNull();
    expect(lastSearch()!.searchParams.get('excludeSubtasks')).toBe('true');
    expect(lastSearch()!.searchParams.get('excludeEpics')).toBe('true');
  });

  test('하위(SUBTASK)를 가진 부모 이슈 행에는 진행률(└ done/total) 배지가 표시된다', async ({ authenticatedPage: page }) => {
    // 목록에서 SUBTASK 는 숨기는 대신, 부모 행에 하위 작업 존재를 진행률로 알린다.
    const parent = createIssue({ number: 9, title: '결제 모듈 개편', childCount: 5, childDoneCount: 2 });
    // 하위가 없는 일반 이슈에는 배지가 없어야 한다(대조군).
    const plain = createIssue({ id: 2, number: 10, title: '문구 수정' });
    await mock(page, [parent, plain]);

    await page.goto(`/projects/${KEY}`);
    const badge = page.getByTestId('issue-row-9-child-progress');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('2/5');
    // 하위 없는 행에는 배지 미표시.
    await expect(page.getByTestId('issue-row-10-child-progress')).toHaveCount(0);
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

  test('레이블은 행 한 줄 안에서 소속 칩 앞에 최대 2개 + N 으로 보이고, 제목 칸이 좁으면 숨는다 (WP-505)', async ({ authenticatedPage: page }) => {
    const epicType = makeEpicType();
    const parent = { number: 3, title: '버그 수정 및 이슈 대응', type: epicType };
    // 실데이터처럼 긴 제목 — 레이블 3개(2개 + 「+1」) 행과 레이블 없는 행의 높이를 비교한다.
    const labeled = createIssue({
      id: 1,
      number: 481,
      title: 'OPEN 프로젝트 비멤버의 자기 이슈 상세에서 사이클 편집·「에픽 연결」만 활성으로 보이고 저장하면 403',
      parent,
      labels: [
        { id: 1, name: 'AI 탐색', colorToken: 'GRAY' },
        { id: 2, name: 'security', colorToken: 'RED' },
        { id: 3, name: '권한', colorToken: 'ORANGE' },
      ],
    });
    const plain = createIssue({ id: 2, number: 485, title: '이슈 목록 아래쪽에서 체크하면 일괄 작업 바가 화면 위쪽 밖에 있어 보이지 않음', parent });
    await mock(page, [labeled, plain]);

    // 넓은 화면 — 제목 칸이 40rem 이상이라 레이블이 보인다.
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(`/projects/${KEY}`);
    const row = page.getByTestId('issue-row-481');
    const labels = row.getByTestId('issue-row-481-labels');
    await expect(labels).toBeVisible();
    await expect(labels).toContainText('AI 탐색');
    await expect(labels).toContainText('security');
    await expect(labels).not.toContainText('권한');
    await expect(labels).toContainText('+1');
    await expect(labels).toHaveAttribute('title', 'AI 탐색, security, 권한');

    // 한 줄 — 레이블 있는 행과 없는 행의 높이가 같고(서브픽셀 반올림 1px 허용 — 2줄이면 ~20px 차이), 레이블은 제목 오른쪽·소속 칩 왼쪽에 같은 줄로 놓인다.
    const rowBox = await row.boundingBox();
    const plainBox = await page.getByTestId('issue-row-485').boundingBox();
    const titleBox = await row.getByRole('link', { name: /OPEN 프로젝트 비멤버/ }).boundingBox();
    const labelsBox = await labels.boundingBox();
    const chipBox = await row.getByTestId('issue-row-481-parent').boundingBox();
    expect(Math.abs(rowBox!.height - plainBox!.height)).toBeLessThanOrEqual(1);
    expect(labelsBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
    expect(labelsBox!.x + labelsBox!.width).toBeLessThanOrEqual(chipBox!.x);
    expect(Math.abs(labelsBox!.y + labelsBox!.height / 2 - (titleBox!.y + titleBox!.height / 2))).toBeLessThan(3);
    await page.screenshot({ path: 'test-results/tc/issue-list/row-labels-wide.png' });

    // 좁은 화면(노트북 폭) — 제목 칸이 40rem 미만이면 레이블을 숨겨 제목 폭을 살리고, 행은 계속 한 줄이다.
    await page.setViewportSize({ width: 1100, height: 800 });
    // 전제 — 이 폭에서 제목 칸이 실제로 40rem(640px) 미만이어야 숨김 판정을 검증하는 것이다(레이아웃이 바뀌면 여기서 먼저 알린다).
    await expect.poll(async () => (await row.locator('td').nth(4).boundingBox())!.width).toBeLessThan(640);
    await expect(labels).toBeHidden();
    await expect(row.getByTestId('issue-row-481-parent')).toBeVisible();
    const narrowRow = await row.boundingBox();
    const narrowPlain = await page.getByTestId('issue-row-485').boundingBox();
    expect(Math.abs(narrowRow!.height - narrowPlain!.height)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/tc/issue-list/row-labels-narrow.png' });
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

    const searches = trackRequests(page, 'ANY', `/api/v1/projects/${KEY}/issues`);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
      (route) => {
        const hasQ = new URL(route.request().url()).searchParams.has('q');
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
    const lastUrl = searches.lastUrl()!;
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

  // WP-808 — 프로젝트 상태 이름(사용자 정의 「검토 중」, id 12)이 목록 행·상태 그룹 헤더·상세 상태 선택에 보인다.
  // withCustomStatuses('대기', '검토 중') → 진행 중 범주에 「대기」(11)·「검토 중」(12).
  const routeStatuses = (page: import('@playwright/test').Page) =>
    page.route('**/api/v1/projects/*/statuses', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(withCustomStatuses('대기', '검토 중')) })
        : route.fallback(),
    );

  // WP-808 — 필터 바에 「상태」(프로젝트 상태 id, statusId)와 「상태 범주」(범주, 기존 status)가 따로 있다.
  test('상태 필터에서 「검토 중」을 고르면 검색 요청에 statusId=12 가 붙는다 (WP-808)', async ({ authenticatedPage: page }) => {
    await routeStatuses(page);
    const lastSearch = await captureSearch(page);
    await page.goto(`/projects/${KEY}`);

    await page.getByTestId('add-filter-trigger').click();
    await expect(page.getByTestId('add-filter-facet-statusId')).toHaveText('상태');
    await page.getByTestId('add-filter-facet-statusId').click();
    // 옵션은 프로젝트 상태 이름(표시 순서) + 범주 아이콘.
    await expect(page.locator('[data-testid^="facet-value-statusId-"]')).toHaveText(['할 일', '진행 중', '대기', '검토 중', '완료', '취소']);
    await expect(page.getByTestId('facet-value-statusId-12').locator('svg').first()).toHaveAttribute('aria-hidden', 'true');
    await page.getByTestId('facet-value-statusId-12').click();

    await expect(page).toHaveURL(/statusId=12/);
    await expect.poll(() => lastSearch()?.searchParams.get('statusId')).toBe('12');
    expect(lastSearch()?.searchParams.get('status')).toBeNull();
    await expect(page.getByTestId('filter-chip-statusId')).toContainText('상태:');
    await expect(page.getByTestId('filter-chip-statusId')).toContainText('검토 중');
  });

  test('상태 범주 필터는 status 파라미터를 쓴다 (WP-808)', async ({ authenticatedPage: page }) => {
    await routeStatuses(page);
    const lastSearch = await captureSearch(page);
    await page.goto(`/projects/${KEY}`);

    await page.getByTestId('add-filter-trigger').click();
    await expect(page.getByTestId('add-filter-facet-status')).toHaveText('상태 범주');
    await page.getByTestId('add-filter-facet-status').click();
    await page.getByTestId('facet-value-status-IN_PROGRESS').click();

    await expect.poll(() => lastSearch()?.searchParams.get('status')).toBe('IN_PROGRESS');
    expect(lastSearch()?.searchParams.get('statusId')).toBeNull();
  });

  test('예전 ?status=IN_PROGRESS 링크는 상태 범주 칩으로 열린다 (WP-808)', async ({ authenticatedPage: page }) => {
    await routeStatuses(page);
    const lastSearch = await captureSearch(page);
    await page.goto(`/projects/${KEY}?status=IN_PROGRESS`);

    const categoryChip = page.getByTestId('filter-chip-status');
    await expect(categoryChip).toContainText('상태 범주:');
    await expect(categoryChip).toContainText('진행 중');
    await expect(page.getByTestId('filter-chip-statusId')).toHaveCount(0);
    await expect.poll(() => lastSearch()?.searchParams.get('status')).toBe('IN_PROGRESS');
    expect(lastSearch()?.searchParams.get('statusId')).toBeNull();
  });

  test('상태와 상태 범주를 함께 걸면 칩이 따로 생기고 검색 요청에 둘 다 실린다 (WP-808)', async ({ authenticatedPage: page }) => {
    await routeStatuses(page);
    const lastSearch = await captureSearch(page);
    await page.goto(`/projects/${KEY}?status=IN_PROGRESS&statusId=12`);

    // 서버가 두 조건을 AND 로 묶는다 — 웹은 둘 다 그대로 보낸다.
    await expect(page.getByTestId('filter-chip-status')).toContainText('진행 중');
    await expect(page.getByTestId('filter-chip-statusId')).toContainText('검토 중');
    await expect.poll(() => lastSearch()?.searchParams.get('status')).toBe('IN_PROGRESS');
    expect(lastSearch()?.searchParams.get('statusId')).toBe('12');
  });

  test('사용자 정의 상태 이름이 목록 행·상태 그룹 헤더에 보인다 (WP-808)', async ({ authenticatedPage: page }) => {
    await routeStatuses(page);
    await mock(page, [
      createIssue({ id: 1, number: 1, title: '리뷰 대기 작업', status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' }),
      createIssue({ id: 2, number: 2, title: '진행 작업', status: 'IN_PROGRESS' }),
    ]);
    // 상태 그룹 총계는 statusId 별로 센다 — 버킷 key(statusId)와 같은 키.
    const counts = trackRequests(page, 'GET', `/api/v1/projects/${KEY}/issues/group-counts`);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues/group-counts`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ groupBy: 'statusId', groups: [{ key: '12', count: 5 }, { key: '2', count: 1 }] }),
        }),
    );

    await page.goto(`/projects/${KEY}?group=status`);

    // 같은 진행 중 범주라도 상태마다 따로 묶이고, 헤더는 상태 이름 + 서버 총계.
    const reviewGroup = page.getByTestId('list-group-12');
    await expect(page.getByTestId('list-group-toggle-12')).toContainText('검토 중');
    await expect(page.getByTestId('list-group-count-12')).toHaveText('5');
    await expect(reviewGroup.getByTestId('issue-row-1')).toBeVisible();
    await expect(page.getByTestId('list-group-2').getByTestId('issue-row-2')).toBeVisible();
    // 행의 상태 아이콘은 범주 모양이지만 읽는 이름은 상태 이름.
    await expect(page.getByTestId('issue-row-1').getByLabel('상태: 검토 중')).toBeVisible();
    expect(counts.lastUrl()?.searchParams.get('groupBy')).toBe('statusId');
  });

  test('상세 상태 선택에서 사용자 정의 상태를 고르면 PATCH body 가 statusId 다 (WP-808)', async ({ authenticatedPage: page }) => {
    await routeStatuses(page);
    await page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    let patchBody: Record<string, unknown> | undefined;
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues/7`,
      (route) => {
        const req = route.request();
        if (req.method() === 'PATCH') patchBody = req.postDataJSON() as Record<string, unknown>;
        const reviewed = patchBody?.statusId === 12;
        const summary = createIssue({
          number: 7,
          title: '상태 바꿀 작업',
          status: 'IN_PROGRESS',
          ...(reviewed ? { statusId: 12, statusName: '검토 중' } : {}),
        });
        if (req.method() === 'PATCH' || req.method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueDetail({ summary })),
          });
        }
        return route.fallback();
      },
    );

    await page.goto(`/projects/${KEY}/issues/7`);
    const select = page.getByTestId('issue-status-select');
    await expect(select).toContainText('진행 중');
    await select.click();
    // 선택지는 프로젝트 상태 이름(같은 범주 안 「대기」「검토 중」 포함).
    await expect(page.getByRole('option')).toHaveText(['할 일', '진행 중', '대기', '검토 중', '완료', '취소']);
    await page.getByRole('option', { name: '검토 중' }).click();

    await expect.poll(() => patchBody?.statusId).toBe(12);
    expect(patchBody).not.toHaveProperty('status');
    await expect(select).toContainText('검토 중');
  });
  test('상태 목록이 늦게 와도 목록이 범주 버킷으로 먼저 그려졌다 바뀌지 않는다', async ({ authenticatedPage: page }) => {
    await mock(page, [createIssue({ id: 1, number: 1, title: '할 일 이슈', status: 'TODO' })]);
    // 상태 목록 응답을 붙잡아 둔다(WP-870) — 붙잡힌 요청 수로 「지금 기다리는 중」을 확인한다.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let heldHits = 0;
    await page.route(`**/api/v1/projects/${KEY}/statuses`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      heldHits += 1;
      await held;
      return route.fulfill({ json: seedStatuses() });
    });
    await page.goto(`/projects/${KEY}?group=status`);

    // 상태 목록이 오기 전엔 목록을 그리지 않는다 — 범주 버킷(list-group-TODO)으로 먼저 그렸다가 statusId 버킷으로 바꾸지 않게.
    await expect.poll(() => heldHits).toBeGreaterThan(0);
    await expectStays(page, () => page.getByTestId('issue-list-scroll').count(), 0);
    release();
    await expect(page.getByTestId('list-group-1').getByTestId('issue-row-1')).toBeVisible();
    await expect(page.getByTestId('list-group-TODO')).toHaveCount(0);
  });
});
