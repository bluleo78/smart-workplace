// 타임라인 에픽 계층 트리 E2E (#649) — 에픽 그룹 행/하위 트리/에픽 없음 그룹/접기-펼치기/
// 일정 미정 섹션 에픽 배지/그룹 행 클릭 이동을 검증한다.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeSubtaskType } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';

const KEY = 'WP';
const EPIC_TYPE = makeEpicType();
const SUBTASK_TYPE = makeSubtaskType();

function setupStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const members = [createMember({ userId: 2, name: '김개발', username: 'kim@example.com' })];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) });
    }),
    page.route(`**/api/v1/projects/${KEY}/labels`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject({ key: KEY })),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // 에픽 40(온보딩 개편, 하위 2/2 중 1 DONE) + 하위 2건(41 일정 있음, 42 미정) +
      // 에픽 없는 이슈 1건(18) + SUBTASK 1건(50, 그룹/미정 어디에도 나타나면 안 됨).
      const issues = [
        createIssue({
          number: 40,
          title: '온보딩 개편',
          type: EPIC_TYPE,
          childCount: 2,
          childDoneCount: 1,
        }),
        createIssue({
          number: 41,
          title: '가입 플로우',
          parent: { number: 40, title: '온보딩 개편', type: EPIC_TYPE },
          startDate: '2026-07-01',
          dueDate: '2026-07-05',
          status: 'DONE',
        }),
        createIssue({
          number: 42,
          title: '온보딩 미정 하위',
          parent: { number: 40, title: '온보딩 개편', type: EPIC_TYPE },
        }),
        createIssue({ number: 18, title: '에픽 없는 이슈', dueDate: '2026-07-08' }),
        createIssue({
          number: 50,
          title: '하위 태스크 이슈',
          type: SUBTASK_TYPE,
          parent: { number: 41, title: '가입 플로우', type: { ...EPIC_TYPE, name: 'TASK' } },
          dueDate: '2026-07-05',
        }),
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
  ]);
}

test('에픽 그룹 행 + 하위 트리 + 에픽 없음 그룹이 렌더된다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  const grid = page.locator('.timeline-gantt-root .wx-grid');
  await expect(grid).toContainText('온보딩 개편'); // 에픽 그룹 행
  await expect(grid).toContainText('(1/2)'); // 진행률
  await expect(grid).toContainText('가입 플로우'); // 하위 이슈 행
  await expect(grid).toContainText('에픽 없음'); // 가상 그룹 행
  // summary 롤업 막대 렌더 — 에픽(epic-40) 1개만 보인다. no-epic 가상 그룹의 summary 는
  // DOM 에는 존재하지만 group id 기준 CSS 로 항상 숨겨진다(timeline-gantt.css 참조) — 그리드
  // 컬럼에는 하위 막대 롤업 값이 뜨더라도(#662) 간트 영역엔 no-epic 막대를 그리지 않는다.
  await expect(page.locator('.timeline-gantt-root .wx-bar.wx-summary:visible')).toHaveCount(1);
  // "에픽 없음" 그룹 행의 시작일 컬럼은 하위 막대(18)의 실제 마감일(07-08) 기반 롤업이어야
  // 한다 — 다른 그룹/오늘 날짜 등 하위 막대와 무관한 값이 뜨면 회귀(#662).
  await expect(
    page.locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: '에픽 없음' }),
  ).toContainText('08-07-2026');
  // SUBTASK 는 어디에도 없다
  await expect(grid).not.toContainText('하위 태스크 이슈');
});

test('에픽 접기 → 하위 행 숨김 + localStorage 저장, 재방문 시 복원', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await page
    .locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: '온보딩 개편' })
    .locator('.wx-toggle-icon, [class*="toggle"]')
    .first()
    .click();
  await expect(page.locator('.timeline-gantt-root .wx-grid')).not.toContainText('가입 플로우');
  const stored = await page.evaluate((k) => localStorage.getItem(k), `timeline-collapsed:${KEY}`);
  expect(JSON.parse(stored ?? '[]')).toContain('epic-40');
  await page.reload();
  await expect(page.locator('.timeline-gantt-root .wx-grid')).toBeVisible();
  await expect(page.locator('.timeline-gantt-root .wx-grid')).not.toContainText('가입 플로우');
});

test('일정 미정 섹션에 소속 에픽 배지가 붙는다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('unscheduled-section').locator('summary').click();
  await expect(page.getByTestId('unscheduled-row-42')).toContainText('온보딩 개편');
});

test('에픽 그룹 행 클릭 → 에픽 이슈 상세로 이동', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await page.locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: '온보딩 개편' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/40`));
});

// 하위 이슈가 전부 일정 미정인 에픽 자신에게 startDate/dueDate 가 있는 경우(#656) — SVAR summary
// 타입은 자식이 최소 1개 있어야 하는데, 이 케이스는 range 는 채워지지만 group.bars 는 비어
// 있어(undated 하위는 별도 미정 목록으로 빠짐) 자식 없는 summary 가 만들어져 크래시했었다.
function setupBareEpicStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}/labels`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject({ key: KEY })),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // 에픽(60) 자신에게만 startDate/dueDate 부여 — 하위 2건(61, 62)은 전부 미정.
      const issues = [
        createIssue({
          number: 60,
          title: '탐색 EPIC 테스트',
          type: EPIC_TYPE,
          startDate: '2026-07-05',
          dueDate: '2026-07-12',
          childCount: 2,
          childDoneCount: 0,
        }),
        createIssue({
          number: 61,
          title: '미정 하위 1',
          parent: { number: 60, title: '탐색 EPIC 테스트', type: EPIC_TYPE },
        }),
        createIssue({
          number: 62,
          title: '미정 하위 2',
          parent: { number: 60, title: '탐색 EPIC 테스트', type: EPIC_TYPE },
        }),
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
  ]);
}

test('하위 이슈가 모두 일정 미정인 에픽만 배치돼도 간트가 크래시하지 않는다 (#656)', async ({
  authenticatedPage: page,
}) => {
  await setupBareEpicStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  const grid = page.locator('.timeline-gantt-root .wx-grid');
  // 크래시 시 PageErrorBoundary 가 이 텍스트로 전체 페이지를 대체한다 — 그리드 자체가
  // 정상 렌더된다는 것이 곧 크래시하지 않았다는 증거.
  await expect(grid).toContainText('탐색 EPIC 테스트');
  await expect(page.getByText('페이지를 불러오는 중 문제가 발생했습니다')).not.toBeVisible();
  // 미정 하위 2건은 그룹 트리가 아니라 일정 미정 섹션에 배지와 함께 나타난다.
  await page.getByTestId('unscheduled-section').locator('summary').click();
  await expect(page.getByTestId('unscheduled-row-61')).toContainText('탐색 EPIC 테스트');
  await expect(page.getByTestId('unscheduled-row-62')).toContainText('탐색 EPIC 테스트');
});

// 상태색 주입 셀렉터가 이슈 번호를 접미사($=)로 매칭하던 회귀 — 번호 5 가 번호 25(에픽 자식)의
// 접미사라 두 막대가 같은 요소로 매칭돼 서로 다른 상태색을 번갈아 덮어쓰며 MutationObserver
// 무한 루프 → 렌더러 프리즈를 일으켰다. 정확 매칭으로 고친 뒤 두 막대가 각자 올바른 색을 갖고
// 프리즈 없이 렌더되는지 검증한다. (에픽 자식이 로드되는 목록 기본값과 결합돼야만 드러났던 잠복 버그)
function setupSuffixCollisionStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}/members`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}/labels`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: KEY })) }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (r) => {
      if (r.request().method() !== 'GET') return r.fallback();
      // 에픽(10) + 날짜 있는 자식 25(DONE) + 에픽 없는 이슈 5(IN_PROGRESS). 5 는 25 의 접미사.
      const issues = [
        createIssue({ number: 10, title: '인증 에픽', type: EPIC_TYPE, childCount: 1, childDoneCount: 1 }),
        createIssue({ number: 25, title: '완료 하위', status: 'DONE', startDate: '2026-07-06', dueDate: '2026-07-10', parent: { number: 10, title: '인증 에픽', type: EPIC_TYPE } }),
        createIssue({ number: 5, title: '진행중 루트', status: 'IN_PROGRESS', startDate: '2026-06-10', dueDate: '2026-06-18' }),
      ];
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
  ]);
}

test('이슈 번호 접미사 충돌(5 vs 25)에도 프리즈 없이 각 막대가 올바른 상태색을 갖는다', async ({
  authenticatedPage: page,
}) => {
  await setupSuffixCollisionStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  // 프리즈였다면 렌더가 멈춰 이 대기가 타임아웃된다 — 두 막대가 모두 뜨는 것이 곧 비프리즈 증거.
  const bar25 = page.locator('.timeline-gantt-root .wx-bar[data-task-id="25"]');
  const bar5 = page.locator('.timeline-gantt-root .wx-bar[data-task-id="5"]');
  await expect(bar25).toBeVisible();
  await expect(bar5).toBeVisible();
  // 상태색 주입이 각 막대에 올바르게(서로 다르게) 적용됐는지 — 충돌 시엔 한 요소를 놓고 번갈아
  // 덮어써 둘 다 불안정하거나 같은 값이 된다. 이펙트가 심는 인라인 커스텀 프로퍼티 원본값을 읽어
  // DONE=success, IN_PROGRESS=primary 로 분리됐는지 확인한다.
  await expect
    .poll(() => bar25.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--wx-gantt-task-color')))
    .toBe('var(--success)');
  await expect
    .poll(() => bar5.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--wx-gantt-task-color')))
    .toBe('var(--primary)');
});

