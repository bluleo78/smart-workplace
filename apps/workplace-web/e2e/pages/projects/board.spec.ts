// 태스크 보드 + 검색 + 필터 + 무한 스크롤 E2E.
// 백엔드 없이 `page.route()` 로 모킹 — 컨트랙트는 IssueResponse / IssueSearchResponse / IssueDetailResponse.

import type { Route } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import {
  createIssue,
  createIssueDetail,
  createIssueSearchResponse,
} from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;

// 공통: 프로젝트/멤버 메타 모킹.
async function stubProjectMeta(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject());
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/members`, []);
}

// 이슈 검색 라우트 헬퍼: pathname 매칭 + 쿼리 파라미터 캡처.
// handler 는 (route, requestUrl) 를 받아 응답을 결정한다.
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

// 카드를 컬럼 중앙으로 드래그. @dnd-kit PointerSensor distance:5 활성화 조건을
// 만족시키도록 down → move(0,0) → move(target, steps:10) 순서로 진행한다.
async function dragCardTo(
  page: import('@playwright/test').Page,
  cardTestId: string,
  columnTestId: string,
) {
  const card = page.getByTestId(cardTestId);
  const target = page.getByTestId(columnTestId);
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(0, 0);
  const box = await target.boundingBox();
  if (!box) throw new Error(`${columnTestId} bounding box 없음`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
}

test.describe('태스크 보드/검색', () => {
  test(
    '보드 진입 → DnD 로 TODO → IN_PROGRESS 카드 이동 + PATCH status 호출',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await stubProjectMeta(page);

      let issues: IssueResponse[] = [
        createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' }),
        createIssue({ id: 2, number: 2, title: 'B', status: 'IN_PROGRESS' }),
      ];

      await routeIssueSearch(page, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse(issues)),
        }),
      );

      // DnD 단축 PATCH — IssueDetailResponse 형태로 응답.
      let patchPayload: unknown = null;
      await page.route(`**${ISSUES_PATH}/1/status`, (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        patchPayload = route.request().postDataJSON();
        issues = issues.map((i) =>
          i.number === 1 ? { ...i, status: 'IN_PROGRESS' } : i,
        );
        const updated = issues.find((i) => i.number === 1)!;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueDetail({ summary: updated, body: null, comments: [], history: [] }),
          ),
        });
      });

      await page.goto(`/projects/${PROJECT_KEY}?view=board`);

      // 4 컬럼 모두 노출
      await expect(page.getByTestId('board-col-TODO')).toBeVisible();
      await expect(page.getByTestId('board-col-IN_PROGRESS')).toBeVisible();
      await expect(page.getByTestId('board-col-DONE')).toBeVisible();
      await expect(page.getByTestId('board-col-CANCELED')).toBeVisible();

      // TODO 컬럼 안에 카드 1 이 있는 상태에서 시작
      await expect(
        page.getByTestId('board-col-TODO').getByTestId('issue-card-1'),
      ).toBeVisible();

      await dragCardTo(page, 'issue-card-1', 'board-col-IN_PROGRESS');

      // PATCH 호출 payload 가 status: IN_PROGRESS
      await expect.poll(() => patchPayload).toEqual({ status: 'IN_PROGRESS' });

      // optimistic update + 서버 응답으로 카드가 IN_PROGRESS 컬럼에 위치
      await expect(
        page.getByTestId('board-col-IN_PROGRESS').getByTestId('issue-card-1'),
      ).toBeVisible();
    },
  );

  test('검색 입력 → 300ms debounce 후 q 쿼리 파라미터 + URL 동기화', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);

    const seenQueries: string[] = [];
    await routeIssueSearch(page, (route, url) => {
      seenQueries.push(url.search);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByLabel('태스크 검색').fill('login');

    // 백엔드 호출에 q=login 이 포함되어야 함
    await expect.poll(() => seenQueries.some((s) => s.includes('q=login'))).toBe(true);
    // URL 도 동기화
    await expect(page).toHaveURL(/q=login/);
  });

  test('status 필터 버튼 클릭 → URL + API status 파라미터 반영', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);

    const seenQueries: string[] = [];
    await routeIssueSearch(page, (route, url) => {
      seenQueries.push(url.search);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-status').click();
    await page.getByTestId('facet-value-status-IN_PROGRESS').click();
    await expect(page.getByTestId('filter-chip-status')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(/status=IN_PROGRESS/);
    await expect.poll(() => seenQueries.some((s) => s.includes('status=IN_PROGRESS'))).toBe(true);

    // 칩 제거 → URL 에서 status 파라미터가 빠진다.
    await page.getByTestId('filter-chip-status-remove').click();
    await expect(page).not.toHaveURL(/status=IN_PROGRESS/);
  });

  test('FilterChip × 버튼 터치 타겟 24px 이상 (WCAG 2.5.8 회귀)', async ({
    authenticatedPage: page,
  }) => {
    // × 버튼이 WCAG 2.5.8 최소 터치 타겟(24×24 CSS px) 이상인지 확인.
    await stubProjectMeta(page);
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-status').click();
    await page.getByTestId('facet-value-status-IN_PROGRESS').click();
    await expect(page.getByTestId('filter-chip-status')).toBeVisible();

    const removeBtn = page.getByTestId('filter-chip-status-remove');
    const box = await removeBtn.boundingBox();
    expect(box).not.toBeNull();
    // 터치 타겟 최소 24×24 px 보장 (WCAG 2.5.8 — #253 회귀 방지)
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });

  test('뷰 토글 리스트 ↔ 보드 → URL view 동기화', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page
      .getByRole('group', { name: '뷰 전환' })
      .getByRole('button', { name: '보드' })
      .click();
    await expect(page).toHaveURL(/view=board/);

    await page
      .getByRole('group', { name: '뷰 전환' })
      .getByRole('button', { name: '리스트' })
      .click();
    await expect(page).not.toHaveURL(/view=board/);
  });

  test('DnD PATCH 실패 → 카드 원위치 + 실패 토스트', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);

    const issues = [createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' })];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      }),
    );
    // PATCH 가 500 으로 떨어지면 optimistic 롤백 + 토스트.
    await page.route(`**${ISSUES_PATH}/1/status`, (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      // message/errors 가 비어 있어 handleApiError 가 fallback 메시지를 사용하도록 한다.
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 500,
          error: 'Internal Server Error',
          message: '',
          errors: null,
          timestamp: new Date().toISOString(),
          path: `${ISSUES_PATH}/1/status`,
        }),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await expect(
      page.getByTestId('board-col-TODO').getByTestId('issue-card-1'),
    ).toBeVisible();

    await dragCardTo(page, 'issue-card-1', 'board-col-DONE');

    // 실패 토스트 + 카드가 TODO 컬럼으로 롤백
    await expect(page.getByText(/태스크 상태 변경에 실패/)).toBeVisible();
    await expect(
      page.getByTestId('board-col-TODO').getByTestId('issue-card-1'),
    ).toBeVisible();
    await expect(
      page.getByTestId('board-col-DONE').getByTestId('issue-card-1'),
    ).toHaveCount(0);
  });

  test('보드 카드 — AGENT 담당자는 AI 마커로 사람과 시각/접근성 구분 (#199)', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);

    // 같은 카드에 AGENT + HUMAN 담당자를 나란히 둬서 "구분 가능"을 검증한다.
    // (마커 존재만 보면 누구에게나 마커가 새는 회귀를 못 잡으므로 둘을 대조)
    const issues = [
      createIssue({
        id: 1,
        number: 1,
        title: 'AI 위임 이슈',
        status: 'TODO',
        assignees: [
          { id: 10, username: 'my-ai', name: 'My AI', kind: 'AGENT' },
          { id: 11, username: 'ydh', name: '양동희', kind: 'HUMAN' },
        ],
      }),
    ];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    const card = page.getByTestId('board-col-TODO').getByTestId('issue-card-1');
    await expect(card).toBeVisible();

    // AGENT 아바타: Bot 마커가 붙고 accessible name 에 이름 + (AGENT) 가 모두 포함.
    const agentAvatar = card.getByTestId('user-avatar-10');
    await expect(agentAvatar).toBeVisible();
    const agentMarker = card.getByTestId('user-avatar-10-agent-marker');
    await expect(agentMarker).toBeVisible();
    await expect(agentAvatar).toHaveAttribute('aria-label', 'My AI (AGENT)');
    await expect(agentAvatar).toHaveAttribute('data-agent', 'true');
    // #208: AGENT 표식 색을 ai-accent 토큰으로 통일(raw purple 회귀 방지).
    await expect(agentAvatar).toHaveClass(/ring-ai-accent/);
    await expect(agentAvatar).not.toHaveClass(/ring-purple/);
    await expect(agentMarker).toHaveClass(/bg-ai-accent/);
    await expect(agentMarker).not.toHaveClass(/bg-purple/);

    // HUMAN 아바타: 마커 없음 + accessible name 은 순수 이름 (AGENT 표기 누수 없음).
    const humanAvatar = card.getByTestId('user-avatar-11');
    await expect(humanAvatar).toBeVisible();
    await expect(card.getByTestId('user-avatar-11-agent-marker')).toHaveCount(0);
    await expect(humanAvatar).toHaveAttribute('aria-label', '양동희');
    await expect(humanAvatar).not.toHaveAttribute('data-agent');
  });

  test('카드: 우선순위 막대 렌더 + 카드 전체(담당자 영역) 클릭으로 상세 이동 (#234)', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    const issue = createIssue({ id: 1, number: 7, title: '로그인 버그', status: 'IN_PROGRESS', priority: 'HIGH' });
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([issue])),
      }),
    );

    await page.goto(`/projects/WP?view=board`);
    const card = page.getByTestId('issue-card-7');
    await expect(card).toBeVisible();
    // 우선순위 막대 렌더 확인
    await expect(card.getByLabel('우선순위 높음')).toBeVisible();
    // 카드 전체(담당자 영역) 클릭 → 상세 이동
    await card.getByTestId('issue-card-7-assignees').click();
    await expect(page).toHaveURL(/\/projects\/WP\/issues\/7$/);
  });

  test('카드: 5px 이상 드래그는 상세를 열지 않는다(클릭/드래그 구분) (#234)', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    const issue = createIssue({ id: 1, number: 7, title: '로그인 버그', status: 'TODO', priority: 'MID' });
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([issue])),
      }),
    );

    await page.goto(`/projects/WP?view=board`);
    const card = page.getByTestId('issue-card-7');
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page).toHaveURL(/\/projects\/WP\?view=board$/);
  });

  test('보드: 1024px 좁은 폭에서 컬럼 min-width 240px 보존 (제목 절단 방지) (#132)', async ({
    authenticatedPage: page,
  }) => {
    // 무엇을: 1024px(lg 브레이크포인트) 진입 시 보드 컬럼 폭을 검증.
    // 왜: 기존 4-track grid 는 1024px 에서 컬럼이 ~160px 로 압축돼 truncate 제목이 1~2자로 절단 → 식별 불가.
    //     Option A(컬럼 min-w-[240px] + 가로 스크롤)로 컬럼이 최소 240px 를 유지하는지 직접 측정한다.
    await page.setViewportSize({ width: 1024, height: 768 });
    await stubProjectMeta(page);

    const issues = [
      createIssue({ id: 1, number: 1, title: '로그인 페이지에서 새로고침 시 세션이 풀리는 버그', status: 'TODO' }),
      createIssue({ id: 2, number: 2, title: '대시보드 위젯 로딩 스피너가 사라지지 않음', status: 'IN_PROGRESS' }),
      createIssue({ id: 3, number: 3, title: '알림 배지 카운트가 실시간으로 갱신되지 않는 문제', status: 'DONE' }),
    ];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // 컬럼이 노출되고, 폭이 최소 240px 이상이어야 한다(min-w floor).
    await expect(page.getByTestId('board-col-TODO')).toBeVisible();
    const colWidth = await page
      .getByTestId('board-col-TODO')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(colWidth).toBeGreaterThanOrEqual(240);
  });

  test('리스트 무한 스크롤 — 두번째 페이지가 cursor 로 자동 로드', async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);

    const firstPage = [
      createIssue({ id: 1, number: 1, title: 'First' }),
      createIssue({ id: 2, number: 2, title: 'Second' }),
    ];
    const secondPage = [createIssue({ id: 3, number: 3, title: 'Third' })];

    let calls = 0;
    let secondCursorSeen = false;
    await routeIssueSearch(page, (route, url) => {
      calls += 1;
      const cursor = url.searchParams.get('cursor');
      if (cursor) secondCursorSeen = true;
      const body = cursor
        ? JSON.stringify(createIssueSearchResponse(secondPage, null))
        : JSON.stringify(createIssueSearchResponse(firstPage, 'CURSOR1'));
      return route.fulfill({ status: 200, contentType: 'application/json', body });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect(page.getByTestId('issue-row-2')).toBeVisible();

    // sentinel(아래쪽 div) 이 진입하도록 스크롤
    await page.mouse.wheel(0, 5000);

    await expect.poll(() => secondCursorSeen, { timeout: 5_000 }).toBe(true);
    await expect(page.getByTestId('issue-row-3')).toBeVisible();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
