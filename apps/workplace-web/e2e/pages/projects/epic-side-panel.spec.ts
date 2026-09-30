// 왼쪽 에픽 패널 E2E — 목록/진행률 노출, 단일 선택 필터(재클릭 해제), 뷰 탭 바 토글로 열림/닫힘(프로젝트별 영속), 빈 상태(EPIC 미보유 포함).
import type { Route } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;

async function stubProjectMeta(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject({ key: PROJECT_KEY, type: 'TEAM' }));
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/members`, []);
}

function epic(number: number, title: string, done: number, total: number): IssueResponse {
  return createIssue({
    id: number,
    number,
    title,
    type: makeEpicType(),
    childCount: total,
    childDoneCount: done,
  });
}

// 이슈 검색 라우트: query 의 type/parent 로 "에픽 목록 조회"와 "본문 이슈 목록 조회"를 구분한다.
function routeIssueSearch(
  page: import('@playwright/test').Page,
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
async function openEpicPanel(page: import('@playwright/test').Page) {
  await page.getByTestId('epic-panel-toggle').click();
  await expect(page.getByTestId('epic-side-panel')).toBeVisible();
}

test.describe('에픽 왼쪽 패널', () => {
  test(
    '에픽 목록 + 진행률 노출, 클릭 시 이슈 검색에 parent 쿼리 적용, 재클릭 시 해제',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await stubProjectMeta(page);
      await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

      const epics = [epic(10, '결제 리뉴얼', 6, 10), epic(11, '알림 개편', 8, 10)];
      let lastBodyIssuesUrl: URL | null = null;

      await routeIssueSearch(page, async (route, url) => {
        if (url.searchParams.get('type') === String(makeEpicType().id)) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse(epics)),
          });
          return;
        }
        lastBodyIssuesUrl = url;
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
      await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('parent')).toBe('10');
      await expect(page.getByTestId('epic-filter-10')).toHaveAttribute('aria-pressed', 'true');

      // 재클릭 → 해제.
      await page.getByTestId('epic-filter-10').click();
      await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('parent')).toBeNull();
      await expect(page.getByTestId('epic-filter-10')).toHaveAttribute('aria-pressed', 'false');

      // 진행바 — 색상 단독 의존 금지(a11y): aria 값으로도 진행률 노출.
      await expect(
        page.getByTestId('epic-filter-10').getByRole('progressbar'),
      ).toHaveAttribute('aria-valuenow', '60');
    },
  );

  test('에픽 미할당 클릭 시 topLevel+excludeEpics 로 조회하고(유형 필터 불변), 재클릭 시 해제된다 (#874)', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

    let lastBodyIssuesUrl: URL | null = null;
    await routeIssueSearch(page, async (route, url) => {
      if (url.searchParams.get('type') === String(makeEpicType().id)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([epic(10, '결제 리뉴얼', 6, 10)])),
        });
        return;
      }
      lastBodyIssuesUrl = url;
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
    await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('topLevel')).toBe('true');
    expect(lastBodyIssuesUrl!.searchParams.get('excludeEpics')).toBe('true');
    expect(lastBodyIssuesUrl!.searchParams.get('type')).toBeNull();
    await expect(page).toHaveURL(/topLevel=true/);
    await expect(page.getByTestId('epic-filter-unassigned')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('epic-filter-all')).toHaveAttribute('aria-pressed', 'false');

    // 재클릭 → 해제(전체 이슈 상태 복귀: 기본 범위 = 에픽 하위 노출).
    await page.getByTestId('epic-filter-unassigned').click();
    await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('topLevel')).toBeNull();
    expect(lastBodyIssuesUrl!.searchParams.get('excludeEpics')).toBe('true');
    await expect(page.getByTestId('epic-filter-all')).toHaveAttribute('aria-pressed', 'true');
  });

  test('미할당 → 특정 에픽 → 전체 이슈 순서로 클릭해도 상호 배타성이 깨지지 않는다', async ({
    authenticatedPage: page,
  }) => {
    // 「에픽 미할당」(topLevel) → 특정 에픽 클릭(parent 지정, 미할당 해제) → 「전체 이슈」 클릭 시
    // 미할당으로 되돌아가지 않고 parent/topLevel 모두 해제되는지 검증한다.
    await stubProjectMeta(page);
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());

    let lastBodyIssuesUrl: URL | null = null;
    await routeIssueSearch(page, async (route, url) => {
      if (url.searchParams.get('type') === String(makeEpicType().id) && !url.searchParams.get('parent')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([epic(10, '결제 리뉴얼', 6, 10)])),
        });
        return;
      }
      lastBodyIssuesUrl = url;
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
    await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('topLevel')).toBe('true');

    // 2) 특정 에픽 클릭 → parent=10, 미할당 해제.
    await page.getByTestId('epic-filter-10').click();
    await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('parent')).toBe('10');
    await expect(page.getByTestId('epic-filter-unassigned')).toHaveAttribute('aria-pressed', 'false');

    // 3) 「전체 이슈」 클릭 → parent/topLevel 모두 해제되어야 한다(에픽 미할당으로 되돌아가면 안 됨).
    await page.getByTestId('epic-filter-all').click();
    await expect.poll(() => lastBodyIssuesUrl?.searchParams.get('parent')).toBeNull();
    expect(lastBodyIssuesUrl!.searchParams.get('topLevel')).toBeNull();
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
    await expect(page.getByTestId('epic-panel-empty')).toContainText('아직 에픽이 없습니다');
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
    // '에픽 만들기'가 중간쯤 떠 있었다. wrapper 에 min-h-full + section flex-1 을 부여해
    // 뷰포트 높이를 채우도록 고쳤는지, 패널 높이와 하단 버튼 위치로 검증한다.
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
    const panelBox = await page.getByTestId('epic-side-panel').boundingBox();
    expect(panelBox!.height).toBeGreaterThan(500);

    // '에픽 만들기' 버튼은 패널 하단부에 고정(패널 바닥에서 120px 이내)돼 있어야 한다.
    const btnBox = await page.getByTestId('epic-create-button').boundingBox();
    expect(btnBox!.y).toBeGreaterThan(panelBox!.y + panelBox!.height - 120);
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
});
