// 팀 리스트 뷰 E2E — 라우트 → 목록 API → 행 배선과 행 전체 클릭 이동(@wiring), 칩·레이블·「!」 실제 배치(@layout),
// 제목 클릭이 history 를 한 번만 쌓는지(@platform)만 남긴다.
// 셀 표기(마감일·마감 지남·하위 진행률)·기본 검색 쿼리·필터 facet·빈 상태·사용자 정의 상태(WP-808)·상세 상태 선택은
// src/pages/projects/issueListView.test.tsx · issueDetailFields.test.tsx 페이지 테스트가 지킨다(WP-971).
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, systemTypes } from '../../factories/issueType.factory';
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
  test('행에 상태·우선순위·담당자 아이콘 렌더 + 행 전체 클릭으로 상세 이동', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
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

  // 아이콘 이름·막대 수·필터 옵션 순서·priority=HIGHEST 검색은 issueListView.test.tsx 가 본다 — 여기서는 「!」 가 가상 요소로 실제 그려지는지만.
  test('우선순위 5단계 — 매우 높음은 「!」 가 가상 요소로만 그려진다 (WP-886)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await mock(page, [
      createIssue({ id: 1, number: 1, title: '결제 장애', priority: 'HIGHEST' }),
      createIssue({ id: 2, number: 2, title: '로그인 오류', priority: 'HIGH' }),
      createIssue({ id: 3, number: 3, title: '아이디어', priority: 'LOWEST' }),
    ]);
    await page.goto(`/projects/${KEY}`);
    // 매우 높음 — 빨간 사각형 「!」, 높음과 다른 이름으로 읽힌다(exact: 「우선순위 높음」 부분 일치로 섞이지 않게).
    const highest = page.getByTestId('issue-row-1').getByRole('img', { name: '우선순위 매우 높음', exact: true });
    await expect(highest).toBeVisible();
    // 「!」 는 가상 요소로만 그려 텍스트에 섞이지 않는다.
    await expect(highest).toHaveText('');
    expect(await highest.locator('span').evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"!"');
    await expect(page.getByTestId('issue-row-2').getByRole('img', { name: '우선순위 높음', exact: true })).toBeVisible();
    // 매우 낮음 — 막대 3개가 모두 비어 있다(글자 없음).
    const lowest = page.getByTestId('issue-row-3').getByRole('img', { name: '우선순위 매우 낮음', exact: true });
    await expect(lowest).toBeVisible();
    await expect(lowest.locator('span')).toHaveCount(3);
  });

  test('에픽 하위 이슈 행에는 소속 에픽 칩이 제목 오른쪽에 표시되고 클릭 시 에픽 상세로 이동한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

  test('레이블은 행 한 줄 안에서 소속 칩 앞에 최대 2개 + N 으로 보이고, 제목 칸이 좁으면 숨는다 (WP-505)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
    await expect.poll(async () => (await row.getByTestId('issue-row-481-title-cell').boundingBox())!.width).toBeLessThan(640);
    await expect(labels).toBeHidden();
    await expect(row.getByTestId('issue-row-481-parent')).toBeVisible();
    const narrowRow = await row.boundingBox();
    const narrowPlain = await page.getByTestId('issue-row-485').boundingBox();
    expect(Math.abs(narrowRow!.height - narrowPlain!.height)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/tc/issue-list/row-labels-narrow.png' });
  });

  test('제목 칸이 좁으면 소속 칩을 아이콘만 남기거나 숨겨 조각으로 보이지 않게 한다 (WP-943)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const parent = { number: 3, title: '인증/온보딩 사용자 경험 전면 개선 에픽', type: makeEpicType() };
    // 하위 진행률 배지(└ 12/34)까지 붙은 행 — 칩·배지·제목 하한이 함께 칸 안에 들어와야 한다.
    const child = createIssue({
      id: 2,
      number: 8,
      title: '로그인 폼 컴포넌트 리팩터링 및 접근성 개선 — 키보드 포커스 트랩 대응',
      parent,
      childCount: 34,
      childDoneCount: 12,
    });
    await mock(page, [child]);
    // 에픽 패널이 여는 요청 — 유형 목록과 에픽 검색(type=에픽 유형 id)은 빈 목록으로 고정해 패널 모양이 백엔드에 기대지 않게 한다.
    // 뒤에 건 route 가 먼저 잡으므로 에픽 검색만 가로채고 나머지 목록 검색은 mock 으로 넘긴다.
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, systemTypes());
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues` && url.searchParams.get('type') === String(makeEpicType().id),
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse([], null)) }),
    );
    // 패널 열림은 localStorage 에 기억된다(useEpicPanelOpen) — 닫힌 채 시작하게 고정해 토글이 늘 「열기」가 되게 한다.
    await page.addInitScript((key) => localStorage.setItem(`epicSidePanel.open.${key}`, 'false'), KEY);
    const row = page.getByTestId('issue-row-8');
    const titleCell = row.getByTestId('issue-row-8-title-cell');
    const chip = row.getByTestId('issue-row-8-parent');
    const chipText = chip.getByText(parent.title);
    const progress = row.getByTestId('issue-row-8-child-progress');
    const titleWidth = async () => (await titleCell.boundingBox())!.width;
    // 칩·하위 배지의 오른쪽 끝이 제목 칸 안 — 옆 칸(담당자)으로 넘치지 않는다.
    const expectInsideTitleCell = async (el: typeof chip) => {
      const [c, e] = [(await titleCell.boundingBox())!, (await el.boundingBox())!];
      expect(e.x + e.width).toBeLessThanOrEqual(c.x + c.width);
    };

    // 1280px 미만에선 작업 관리 사이드바가 접혀(WP-506) 창 폭만으로는 제목 칸이 20rem 밑으로 내려가지 않는다 — 에픽 패널을 연 채
    // 한 페이지에서 창 폭을 바꿔 칸을 좁힌다(칩 모양이 @container 질의로 따라 바뀌는지도 함께 지킨다).

    // 1280 · 패널 닫힘(제목 칸 ≥20rem) — 칩에 부모 제목이 보인다.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/projects/${KEY}`);
    await expect.poll(titleWidth).toBeGreaterThanOrEqual(320);
    await expect(chipText).toBeVisible();

    // 1280 · 패널 열림 — 제목 칸 14~20rem: 유형 아이콘만 남고, 부모 제목은 툴팁과 접근 이름으로 남는다. 칩이 옆 칸으로 넘치지 않는다.
    await page.getByTestId('epic-panel-toggle').click();
    await expect(page.getByTestId('epic-side-panel')).toBeVisible();
    await expect.poll(titleWidth).toBeLessThan(320);
    await expect.poll(titleWidth).toBeGreaterThanOrEqual(224);
    await expect(chipText).toHaveClass(/sr-only/);
    await expect.poll(async () => (await chip.boundingBox())!.width).toBeLessThan(32);
    await expect(chip).toHaveAccessibleName(parent.title);
    await expect(chip).toHaveAttribute('title', `${KEY}-3 · ${parent.title}`);
    await expectInsideTitleCell(chip);
    await expectInsideTitleCell(progress);
    await page.screenshot({ path: 'test-results/tc/issue-list/parent-chip-icon-only.png' });

    // 1024 · 패널 열림 — 제목 칸 <14rem: 아이콘·하위 배지까지는 넘치므로 칩을 숨겨 제목에 폭을 준다.
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect.poll(titleWidth).toBeLessThan(224);
    await expect(chip).toBeHidden();
    await expect(row.getByRole('link', { name: child.title })).toBeVisible();
    // 숨긴 칩 대신 스크린리더용 소속 글자가 남는다. 하위 배지는 제목 바로 뒤(칸 안)에 붙는다.
    await expect(row.getByText(`소속 ${KEY}-3 ${parent.title}`)).toHaveClass(/sr-only/);
    await expectInsideTitleCell(progress);
    await page.screenshot({ path: 'test-results/tc/issue-list/parent-chip-hidden.png' });
  });

  test('제목 링크 클릭은 history 를 한 번만 쌓는다(뒤로가기 1번에 리스트 복귀) (#234)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
