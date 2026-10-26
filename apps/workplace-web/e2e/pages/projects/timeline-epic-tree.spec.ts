// 타임라인 에픽 계층 트리 E2E (#649) — CSS 로 숨기는 막대(에픽 없음 요약·미정 하위 막대)의 실제 보임 여부만 남긴다(@layout).
// 그리드 행 구성·접기/펼치기·localStorage 복원·그룹 행 클릭 이동·미정 하위의 자리·#656 크래시·상태색 주입(접미사 충돌)은
// 페이지 테스트 src/pages/projects/timelineEpicTree.test.tsx 가 지킨다(WP-971, WP-980).
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeSubtaskType } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';

const KEY = 'WP';
const EPIC_TYPE = makeEpicType();
const SUBTASK_TYPE = makeSubtaskType();

// 그룹 기본 상태는 "접힘"이다(사용자 요청 — 펼친 것만 localStorage 저장). 자식 행/막대를
// 검증하려면 먼저 해당 그룹 행의 토글 아이콘을 눌러 펼친다(행 클릭은 상세 이동이라 토글만 클릭).
async function expandGroup(page: Page, title: string) {
  await page
    .locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: title })
    .locator('.wx-toggle-icon, [class*="toggle"]')
    .first()
    .click();
}

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

test('접힌 기본 상태에서도 에픽 롤업 막대만 보이고 에픽 없음 요약 막대는 숨는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.locator('.timeline-gantt-root .wx-grid')).toContainText('온보딩 개편');
  // 접혀 있어도 에픽 롤업 막대는 그대로 보인다 — 접힘 기본에서도 차트가 비어 보이지 않는다.
  // (epic-40 1개만. no-epic summary 는 group id 기준 CSS 로 항상 숨김 — timeline-gantt.css 참조)
  await expect(page.locator('.timeline-gantt-root .wx-bar.wx-summary:visible')).toHaveCount(1);
});

// 미정 하위 노출(#에픽펼침) — 에픽에 날짜 없는 하위가 있으면 그 하위를 "일정 미정"이 아니라
// 에픽 아래 그리드 행으로 보여준다(간트 막대 없음, 시작일/기간 "미정"). 에픽은 자체 날짜로 막대를
// 그리고 항상 펼침 가능해야 한다.
function setupEpicWithUndatedStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}/members`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}/labels`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: KEY })) }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (r) => {
      if (r.request().method() !== 'GET') return r.fallback();
      const issues = [
        // 에픽(10) — 자체 날짜 있음(막대 O), 자식 2건 중 하나만 날짜 있음.
        createIssue({ number: 10, title: '온보딩 개편', type: EPIC_TYPE, startDate: '2026-07-01', dueDate: '2026-07-20', childCount: 2, childDoneCount: 1 }),
        createIssue({ number: 11, title: '가입 플로우', parent: { number: 10, title: '온보딩 개편', type: EPIC_TYPE }, startDate: '2026-07-02', dueDate: '2026-07-06', status: 'DONE' }),
        createIssue({ number: 12, title: '백엔드 설계', parent: { number: 10, title: '온보딩 개편', type: EPIC_TYPE } }),
        // WP-484: 시작일만 있는 하위·단독 — 마감일이 없어 미정이지만 시작일은 보여 준다.
        createIssue({ number: 13, title: '시작일만 하위', parent: { number: 10, title: '온보딩 개편', type: EPIC_TYPE }, startDate: '2026-07-10' }),
        createIssue({ number: 14, title: '시작일만 단독', startDate: '2026-07-15' }),
      ];
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())),
  ]);
}

test('에픽 아래 미정 하위 행은 차트 막대를 숨기고 날짜 있는 하위 막대만 보인다', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await setupEpicWithUndatedStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expandGroup(page, '온보딩 개편');
  await expect(page.locator('.timeline-gantt-root .wx-grid')).toContainText('백엔드 설계');
  // 미정 자식의 간트 막대는 CSS 로 숨겨진다(그리드 행은 있지만 차트 막대는 없음). 문자열 id 는 ':' 접두.
  await expect(page.locator(".timeline-gantt-root .wx-bar[data-task-id*='undated-12']")).toBeHidden();
  await expect(page.locator(".timeline-gantt-root .wx-bar[data-task-id*='undated-13']")).toBeHidden();
  // 날짜 자식(11)의 막대는 보인다.
  await expect(page.locator('.timeline-gantt-root .wx-bar[data-task-id="11"]')).toBeVisible();
});
