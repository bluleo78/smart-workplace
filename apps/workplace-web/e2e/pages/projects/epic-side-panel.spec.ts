// 왼쪽 에픽 패널 E2E — 목록/진행률 노출, 단일 선택 필터(재클릭 해제), 뷰 탭 바 토글로 열림/닫힘(프로젝트별 영속), 빈 상태(EPIC 미보유 포함).
import type { Page, Route } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { measureBox } from '../../fixtures/wait';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueResponse, IssueStatus } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;

async function stubProjectMeta(page: Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject({ key: PROJECT_KEY, type: 'TEAM' }));
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/members`, []);
}

function epic(number: number, title: string, done: number, total: number, status?: IssueStatus): IssueResponse {
  return createIssue({
    id: number,
    number,
    title,
    type: makeEpicType(),
    childCount: total,
    childDoneCount: done,
    ...(status ? { status } : {}),
  });
}

// 이슈 검색 라우트: query 의 type/parent 로 "에픽 목록 조회"와 "본문 이슈 목록 조회"를 구분한다.
function routeIssueSearch(
  page: Page,
  handler: (route: Route, url: URL) => Promise<void> | void,
) {
  return page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return handler(route, new URL(route.request().url()));
    },
  );
}

// 패널은 기본 닫힘 — 각 테스트는 탭 바 토글로 연다.
async function openEpicPanel(page: Page) {
  await page.getByTestId('epic-panel-toggle').click();
  await expect(page.getByTestId('epic-side-panel')).toBeVisible();
}

// 에픽 상세 진입 ↗ (WP-227) 공통 — 에픽 2건(결제 리뉴얼 #10, 알림 개편 #11)을 띄우고 패널을 연다.
async function setupDetailLinkPanel(page: Page) {
  await stubProjectMeta(page);
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
  const epics = [epic(10, '결제 리뉴얼', 6, 10), epic(11, '알림 개편', 8, 10)];
  await routeIssueSearch(page, (route, url) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        createIssueSearchResponse(url.searchParams.get('type') === String(makeEpicType().id) ? epics : []),
      ),
    }),
  );
  await page.goto(`/projects/${PROJECT_KEY}`);
  await openEpicPanel(page);
}


test.describe('에픽 왼쪽 패널', () => {
  test(
    '에픽 목록 + 진행률 노출, 클릭 시 이슈 검색에 parent 쿼리 적용, 재클릭 시 해제',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await stubProjectMeta(page);
      await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

      const epics = [epic(10, '결제 리뉴얼', 6, 10), epic(11, '알림 개편', 8, 10)];
      // 본문 이슈 목록 조회(에픽 목록 조회 제외) 중 마지막 요청.
      const bodySearches = trackRequests(
        page,
        'GET',
        (u) => u.pathname === ISSUES_PATH && u.searchParams.get('type') !== String(makeEpicType().id),
      );
      const lastBodyIssuesUrl = () => bodySearches.lastUrl();

      await routeIssueSearch(page, async (route, url) => {
        if (url.searchParams.get('type') === String(makeEpicType().id)) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse(epics)),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([])),
        });
      });

      await page.goto(`/projects/${PROJECT_KEY}`);

      // 기본 닫힘 + 토글 버튼 노출.
      await expect(page.getByTestId('epic-panel-toggle')).toBeVisible();
      await expect(page.getByTestId('epic-side-panel')).not.toBeAttached();
      await expect(page.getByTestId('epic-panel-toggle')).toHaveAttribute('aria-pressed', 'false');

      await openEpicPanel(page);
      await expect(page.getByTestId('epic-panel-toggle')).toHaveAttribute('aria-pressed', 'true');

      const panel = page.getByTestId('epic-side-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('epic-filter-10')).toContainText('결제 리뉴얼');
      await expect(page.getByTestId('epic-filter-10')).toContainText('6/10');
      await expect(page.getByTestId('epic-filter-11')).toContainText('8/10');

      // 클릭 → parent=10 쿼리로 본문 이슈 검색.
      await page.getByTestId('epic-filter-10').click();
      await expect.poll(() => lastBodyIssuesUrl()?.searchParams.get('parent')).toBe('10');
      await expect(page.getByTestId('epic-filter-10')).toHaveAttribute('aria-pressed', 'true');

      // 재클릭 → 해제.
      await page.getByTestId('epic-filter-10').click();
      await expect.poll(() => lastBodyIssuesUrl()?.searchParams.get('parent')).toBeNull();
      await expect(page.getByTestId('epic-filter-10')).toHaveAttribute('aria-pressed', 'false');

      // 진행바 — 색상 단독 의존 금지(a11y): aria 값으로도 진행률 노출.
      await expect(
        page.getByTestId('epic-filter-10').getByRole('progressbar'),
      ).toHaveAttribute('aria-valuenow', '60');
    },
  );

  test('완료·취소된 에픽은 패널에 나오지 않는다 — 에픽 조회를 진행 중 상태로 좁힌다 (WP-246)', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

    const all = [
      epic(10, '진행 중 에픽', 1, 4, 'IN_PROGRESS'),
      epic(11, '할 일 에픽', 0, 2, 'TODO'),
      epic(12, '완료된 에픽', 3, 3, 'DONE'),
      epic(13, '취소된 에픽', 0, 1, 'CANCELED'),
    ];
    // 서버처럼 status 파라미터로 거른다 — 파라미터가 없으면 종료된 에픽까지 그대로 돌려준다.
    // 네 상태를 모두 넣었으므로 10·11 만 보이면 요청 status 가 정확히 {TODO, IN_PROGRESS} 임이 확인된다.
    await routeIssueSearch(page, (route, url) => {
      const isEpicSearch = url.searchParams.get('type') === String(makeEpicType().id);
      const statuses = url.searchParams.get('status')?.split(',');
      const items = isEpicSearch ? all.filter((e) => !statuses || statuses.includes(e.status)) : [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(items)),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    await expect(page.getByTestId('epic-filter-10')).toBeVisible();
    await expect(page.getByTestId('epic-filter-11')).toBeVisible();
    await expect(page.getByTestId('epic-filter-12')).not.toBeAttached();
    await expect(page.getByTestId('epic-filter-13')).not.toBeAttached();
    await expect(page.getByTestId('epic-panel-count')).toHaveText('2');
  });

  test('에픽 미할당 클릭 시 topLevel+excludeEpics 로 조회하고(유형 필터 불변), 재클릭 시 해제된다 (#874)', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

    const bodySearches = trackRequests(
      page,
      'GET',
      (u) => u.pathname === ISSUES_PATH && u.searchParams.get('type') !== String(makeEpicType().id),
    );
    const lastBodyIssuesUrl = () => bodySearches.lastUrl();
    await routeIssueSearch(page, async (route, url) => {
      if (url.searchParams.get('type') === String(makeEpicType().id)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([epic(10, '결제 리뉴얼', 6, 10)])),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    // 클릭 → 부모 없음(topLevel) + EPIC 제외로 본문 이슈 검색. 유형 필터는 건드리지 않는다.
    await page.getByTestId('epic-filter-unassigned').click();
    await expect.poll(() => lastBodyIssuesUrl()?.searchParams.get('topLevel')).toBe('true');
    expect(lastBodyIssuesUrl()!.searchParams.get('excludeEpics')).toBe('true');
    expect(lastBodyIssuesUrl()!.searchParams.get('type')).toBeNull();
    await expect(page).toHaveURL(/topLevel=true/);
    await expect(page.getByTestId('epic-filter-unassigned')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('epic-filter-all')).toHaveAttribute('aria-pressed', 'false');

    // 재클릭 → 해제(전체 이슈 상태 복귀: 기본 범위 = 에픽 하위 노출).
    await page.getByTestId('epic-filter-unassigned').click();
    await expect.poll(() => lastBodyIssuesUrl()?.searchParams.get('topLevel')).toBeNull();
    expect(lastBodyIssuesUrl()!.searchParams.get('excludeEpics')).toBe('true');
    await expect(page.getByTestId('epic-filter-all')).toHaveAttribute('aria-pressed', 'true');
  });

  test('미할당 → 특정 에픽 → 전체 이슈 순서로 클릭해도 상호 배타성이 깨지지 않는다', async ({
    authenticatedPage: page,
  }) => {
    // 「에픽 미할당」(topLevel) → 특정 에픽 클릭(parent 지정, 미할당 해제) → 「전체 이슈」 클릭 시
    // 미할당으로 되돌아가지 않고 parent/topLevel 모두 해제되는지 검증한다.
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

    const bodySearches = trackRequests(
      page,
      'GET',
      (u) =>
        u.pathname === ISSUES_PATH &&
        !(u.searchParams.get('type') === String(makeEpicType().id) && !u.searchParams.get('parent')),
    );
    const lastBodyIssuesUrl = () => bodySearches.lastUrl();
    await routeIssueSearch(page, async (route, url) => {
      if (url.searchParams.get('type') === String(makeEpicType().id) && !url.searchParams.get('parent')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([epic(10, '결제 리뉴얼', 6, 10)])),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    // 1) 「에픽 미할당」 클릭 → topLevel=true.
    await page.getByTestId('epic-filter-unassigned').click();
    await expect.poll(() => lastBodyIssuesUrl()?.searchParams.get('topLevel')).toBe('true');

    // 2) 특정 에픽 클릭 → parent=10, 미할당 해제.
    await page.getByTestId('epic-filter-10').click();
    await expect.poll(() => lastBodyIssuesUrl()?.searchParams.get('parent')).toBe('10');
    await expect(page.getByTestId('epic-filter-unassigned')).toHaveAttribute('aria-pressed', 'false');

    // 3) 「전체 이슈」 클릭 → parent/topLevel 모두 해제되어야 한다(에픽 미할당으로 되돌아가면 안 됨).
    await page.getByTestId('epic-filter-all').click();
    await expect.poll(() => lastBodyIssuesUrl()?.searchParams.get('parent')).toBeNull();
    expect(lastBodyIssuesUrl()!.searchParams.get('topLevel')).toBeNull();
    await expect(page.getByTestId('epic-filter-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('epic-filter-unassigned')).toHaveAttribute('aria-pressed', 'false');
  });

  test('열림 상태는 새로고침 후에도 프로젝트별로 유지된다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    // 두 번째 프로젝트 — 프로젝트별 독립 영속 검증용.
    await mockApi(page, 'GET', `/api/v1/projects/WP2`, createProject({ key: 'WP2', type: 'TEAM' }));
    await mockApi(page, 'GET', `/api/v1/projects/WP2/members`, []);
    await mockApi(page, 'GET', `/api/v1/projects/WP2/types`, systemTypes());
    await page.route(
      (url) => url.pathname === `/api/v1/projects/WP2/issues`,
      (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      }),
    );
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([epic(10, '결제 리뉴얼', 6, 10)])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    // 새로고침 후에도 열림 유지.
    await page.reload();
    await expect(page.getByTestId('epic-side-panel')).toBeVisible();

    // 다른 프로젝트는 독립 — 기본 닫힘.
    await page.goto(`/projects/WP2`);
    await expect(page.getByTestId('epic-side-panel')).not.toBeAttached();
  });

  test('에픽이 없으면 빈 상태를 보여준다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    await expect(page.getByTestId('epic-panel-empty')).toBeVisible();
    await expect(page.getByTestId('epic-panel-empty')).toContainText('진행 중인 에픽이 없습니다');
    await expect(page.getByTestId('epic-panel-count')).toHaveText('0');
  });

  test('EPIC 유형이 없는 프로젝트도 열면 빈 상태를 보여준다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(
      page,
      'GET',
      `/api/v1/projects/${PROJECT_KEY}/types`,
      systemTypes().filter((t) => t.name !== 'EPIC'),
    );
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);
    await expect(page.getByTestId('epic-panel-empty')).toBeVisible();
    await expect(page.getByTestId('epic-filter-unassigned')).not.toBeAttached();
  });

  test('＋ 에픽 만들기 클릭 시 EPIC 유형이 프리셋된 생성 다이얼로그가 열린다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);

    await page.getByTestId('epic-create-button').click();
    // 유형 select 가 EPIC 라벨로 프리셋 — getIssueTypeLabel('EPIC') 표기와 일치해야 함.
    await expect(page.getByTestId('create-type-select')).toContainText('에픽');
  });

  test('보드가 짧아도(빈 프로젝트) 에픽 패널이 영역 높이를 채운다', async ({ authenticatedPage: page }) => {
    // 회귀: 이전에는 aside 의 self-stretch 가 짧은 빈 보드의 콘텐츠 높이에만 맞춰져
    // '에픽 만들기'가 중간쯤 떠 있었다. 본문 래퍼가 남은 높이를 고정하고 section 이 flex-1 로 채워
    // 뷰포트 높이를 채우는지, 패널 높이와 하단 버튼 위치로 검증한다.
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    await routeIssueSearch(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await openEpicPanel(page);
    await expect(page.getByTestId('epic-panel-empty')).toBeVisible();

    // 빈 콘텐츠의 자연 높이는 300px 미만 — 채움 레이아웃이면 패널이 이보다 훨씬 커진다.
    // 패널이 열리며 높이가 자리 잡기 전 값을 잴 수 있어 측정·단언을 함께 재시도한다(WP-225).
    await expect(async () => {
      const panelBox = await measureBox(page.getByTestId('epic-side-panel'));
      expect(panelBox.height).toBeGreaterThan(500);

      // '에픽 만들기' 버튼은 패널 하단부에 고정(패널 바닥에서 120px 이내)돼 있어야 한다.
      const btnBox = await measureBox(page.getByTestId('epic-create-button'));
      expect(btnBox.y).toBeGreaterThan(panelBox.y + panelBox.height - 120);
    }).toPass();
  });

  test.describe('스크롤 영역 (WP-94)', () => {
    // 60건 목록 — 에픽 조회에는 에픽 1건, 본문 조회에는 긴 목록을 돌려준다.
    async function stubLongList(page: Page, viewport = { width: 1280, height: 800 }) {
      await page.setViewportSize(viewport);
      await stubProjectMeta(page);
      await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
      const manyIssues = Array.from({ length: 60 }, (_, i) =>
        createIssue({ id: 100 + i, number: 100 + i, title: `긴 목록 이슈 ${i}` }),
      );
      await routeIssueSearch(page, async (route, url) => {
        const isEpicQuery = url.searchParams.get('type') === String(makeEpicType().id);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse(isEpicQuery ? [epic(10, '결제 리뉴얼', 1, 2)] : manyIssues)),
        });
      });
    }

    // 스크롤 컨테이너 위에서 휠을 굴리고 실제로 스크롤됐는지 확인한다.
    async function wheelScroll(page: Page, testId: string) {
      const scroller = page.getByTestId(testId);
      await scroller.hover();
      await page.mouse.wheel(0, 3000);
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    }

    test('목록을 스크롤해도 에픽 패널·뷰 칩바·테이블 헤더는 제자리에 있다', async ({ authenticatedPage: page }) => {
      // 회귀: 본문 래퍼 하나가 스크롤 컨테이너여서 에픽 패널·툴바·목록이 함께 스크롤됐다.
      await stubLongList(page);
      await page.goto(`/projects/${PROJECT_KEY}`);
      await openEpicPanel(page);
      await expect(page.getByText('긴 목록 이슈 59')).toBeAttached();

      const panel = page.getByTestId('epic-side-panel');
      const toggle = page.getByTestId('epic-panel-toggle');
      const header = page.getByRole('columnheader', { name: '제목' });
      const before = { panel: await panel.boundingBox(), toggle: await toggle.boundingBox(), header: await header.boundingBox() };

      await wheelScroll(page, 'issue-list-scroll');

      // 같이 스크롤됐다면 y 가 위로 밀린다.
      expect((await panel.boundingBox())!.y).toBe(before.panel!.y);
      expect((await toggle.boundingBox())!.y).toBe(before.toggle!.y);
      expect((await header.boundingBox())!.y).toBe(before.header!.y);
      await expect(page.getByTestId('epic-create-button')).toBeInViewport();
      await expect(header).toBeInViewport();
    });

    test('보드를 세로 스크롤해도 컬럼 헤더가 보이고, 보드 하단(가로 스크롤바)이 화면 안에 있다', async ({
      authenticatedPage: page,
    }) => {
      // 데스크톱 최소 폭 — 컬럼 min-w 로 가로 스크롤이 생기는 조건. 1024px 미만은 모바일 보드(상태 탭·한 컬럼, WP-195)라 가로 스크롤이 없다.
      await stubLongList(page, { width: 1024, height: 700 });
      await page.goto(`/projects/${PROJECT_KEY}?view=board`);
      await expect(page.getByTestId('board-col-TODO')).toContainText('긴 목록 이슈 59');

      const scroller = page.getByTestId('board-scroll');
      // 보드 스크롤 컨테이너 자체가 뷰포트 안에서 끝난다 → 가로 스크롤바가 콘텐츠 끝이 아닌 화면 하단에 보인다.
      // 첫 렌더 직후 배치가 자리 잡을 때까지 다시 재며 단언한다(WP-225).
      await expect(async () => {
        const box = await measureBox(scroller);
        expect(box.y + box.height).toBeLessThanOrEqual(700);
      }).toPass();
      expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

      const colHeader = page.getByTestId('board-col-TODO').locator('header');
      const before = (await colHeader.boundingBox())!;
      await wheelScroll(page, 'board-scroll');
      // sticky 헤더 — 세로 스크롤 후에도 같은 위치에 남는다(컬럼 상단 테두리 1px 만큼만 올라간다).
      expect(Math.abs((await colHeader.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1);
      await expect(colHeader).toBeInViewport();
    });
  });

  test('에픽 선택·해제 후에도 group=none(그룹 없음 명시)이 유지된다 (#878)', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
    const epics = [epic(10, '결제 리뉴얼', 6, 10)];
    await routeIssueSearch(page, (route, url) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueSearchResponse(url.searchParams.get('type') === String(makeEpicType().id) ? epics : []),
        ),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}?group=none`);
    await openEpicPanel(page);

    await page.getByTestId('epic-filter-10').click();
    await expect(page).toHaveURL(/parent=10/);
    await expect(page).toHaveURL(/group=none/);

    await page.getByTestId('epic-filter-unassigned').click();
    await expect(page).toHaveURL(/topLevel=true/);
    await expect(page).toHaveURL(/group=none/);
  });

  test.describe('에픽 상세 진입 ↗ (WP-227)', () => {
    const setup = (page: Page) => setupDetailLinkPanel(page);

    test('hover 시 개수 자리에 ↗ 가 보이고, 누르면 필터 없이 에픽 상세로 이동한다', async ({ authenticatedPage: page }) => {
      await setup(page);
      // 평소엔 숨김 — 개수만 보인다.
      await expect(page.getByTestId('epic-open-10')).toHaveCSS('opacity', '0');
      await expect(page.getByTestId('epic-filter-10')).toContainText('6/10');

      await page.getByTestId('epic-filter-10').hover();
      await expect(page.getByTestId('epic-open-10')).toHaveCSS('opacity', '1');
      await expect(page.getByTestId('epic-open-10')).toHaveAccessibleName('결제 리뉴얼 상세 열기');
      // 같은 자리 교체 — 개수는 감춰지고, hover 하지 않은 다른 에픽의 ↗ 는 숨김 유지.
      await expect(page.getByTestId('epic-filter-10').getByText('6/10')).toBeHidden();
      await expect(page.getByTestId('epic-open-11')).toHaveCSS('opacity', '0');

      await page.getByTestId('epic-open-10').click();
      await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT_KEY}/issues/10$`));
    });

    test('행 클릭은 여전히 필터 — ↗ 와 겹치지 않는 제목 영역 클릭 시 상세로 가지 않는다', async ({ authenticatedPage: page }) => {
      await setup(page);
      await page.getByTestId('epic-filter-11').getByText('알림 개편').click();
      await expect(page).toHaveURL(/parent=11/);
      await expect(page).not.toHaveURL(/\/issues\//);
      await expect(page.getByTestId('epic-filter-11')).toHaveAttribute('aria-pressed', 'true');
    });

    test('키보드 — 에픽 버튼에 포커스하면 ↗ 가 보이고 Tab·Enter 로 상세에 간다', async ({ authenticatedPage: page }) => {
      await setup(page);
      // 키보드 모달리티로 전환한 뒤 포커스 — :focus-visible 이 성립해야 group-kbd 가 켜진다.
      await page.keyboard.press('Tab');
      await page.getByTestId('epic-filter-11').focus();
      await expect(page.getByTestId('epic-open-11')).toHaveCSS('opacity', '1');
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('epic-open-11')).toBeFocused();
      await expect(page.getByTestId('epic-open-11')).toHaveCSS('opacity', '1');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT_KEY}/issues/11$`));
    });
  });
});

// 리뷰 지적(WP-227): group-hover 는 hover 가능 기기에서만 걸려, 데스크톱 패널이 뜨는 ≥1024px 터치 태블릿에선 ↗ 에 닿을 수 없었다.
// 터치 판정은 pointer-coarse(messageToolbar 와 동일).
test.describe('에픽 상세 진입 ↗ — 터치 태블릿(≥1024px)', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });

  test('↗ 가 상시 보이고 개수도 함께 보이며, 탭하면 에픽 상세로 이동한다', async ({ authenticatedPage: page }) => {
    await setupDetailLinkPanel(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(page.getByTestId('epic-open-10')).toHaveCSS('opacity', '1');
    await expect(page.getByTestId('epic-filter-10').getByText('6/10')).toBeVisible();
    // 개수와 ↗ 가 겹치지 않는다.
    const count = (await page.getByTestId('epic-filter-10').getByText('6/10').boundingBox())!;
    const link = (await page.getByTestId('epic-open-10').boundingBox())!;
    expect(count.x + count.width).toBeLessThanOrEqual(link.x);
    await page.getByTestId('epic-open-10').tap();
    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT_KEY}/issues/10$`));
  });
});
