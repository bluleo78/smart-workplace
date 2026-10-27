// 타임라인 마일스톤 E2E(#648) — 레인의 기하만 남긴다(@layout): 구분선 x, 차트 밖 칩·점선 숨김, 클릭 좌표 → 날짜(클램프 포함).
// 칩 렌더·툴바 생성·입력 상한·편집 팝오버(수정·빈 값·409·삭제·Esc)·readOnly 는
// 페이지 테스트 src/pages/projects/timelineMilestones.test.tsx 가 지킨다(WP-971, WP-980).
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { CycleResponse } from '../../../src/types/cycle';
import type { MilestoneResponse } from '../../../src/types/milestone';

const KEY = 'WP';

function baseMilestones(): MilestoneResponse[] {
  return [
    { id: 1, projectId: 1, name: 'v1 출시', dueDate: '2026-08-01', description: null, createdAt: '', updatedAt: '' },
  ];
}

function setupStubs(
  page: Page,
  options: { milestones?: MilestoneResponse[]; viewerIsMember?: boolean } = {},
) {
  const milestones = options.milestones ?? baseMilestones();
  const viewerIsMember = options.viewerIsMember ?? true;
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject({ key: KEY, viewerIsMember })),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const issues = [
        createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
        createIssue({ number: 2, title: '연결 이슈', dueDate: '2026-07-10', milestoneId: 1 }),
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const cycles: CycleResponse[] = [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycles) });
    }),
    // 마일스톤 편집은 프로젝트 OWNER 만(WP-1008) — 멤버로 보는 기본 시나리오는 로그인 사용자(id 1)를 OWNER 로 둔다.
    page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const members = viewerIsMember ? [createMember({ userId: 1, role: 'OWNER' })] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) });
    }),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(milestones) });
    }),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
  ]);
}

test('마일스톤 레인의 그리드/차트 경계 구분선이 아래 차트 경계와 이어진다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('milestone-lane')).toBeVisible();
  const divider = page.getByTestId('milestone-lane-divider');
  await expect(divider).toBeAttached();
  // 레인 구분선의 left 오프셋이 0(끊어져 미배치)이 아니라 실제 그리드 패널 폭만큼 이동해
  // 아래 차트의 그리드/차트 경계선과 같은 x 좌표에 그려져야 한다.
  const dividerLeft = await divider.evaluate((el) => el.getBoundingClientRect().left);
  const chartLeft = await page
    .locator('.timeline-gantt-root .wx-chart')
    .first()
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs(dividerLeft - chartLeft)).toBeLessThan(2);
});

// 오늘 기준 days 일 뒤(음수면 앞) 날짜 — 첫 화면은 오늘 근처로 스크롤되므로 지난 마일스톤이 차트 왼쪽 밖에 놓인다.
function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// WP-861: 차트 시작보다 이른 마일스톤의 칩·점선이 왼쪽 이슈 표 위에 겹쳐 그려졌다.
test('차트 왼쪽 밖의 마일스톤은 칩·점선을 그리드 위에 그리지 않고, 보이는 칩은 차트 영역 안에서 시작한다', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await setupStubs(page, {
    milestones: [
      { id: 1, projectId: 1, name: '지난 마일스톤', dueDate: isoFromToday(-120), description: null, createdAt: '', updatedAt: '' },
      { id: 2, projectId: 1, name: '다음 마일스톤', dueDate: isoFromToday(7), description: null, createdAt: '', updatedAt: '' },
      // 첫 화면은 오늘 −7일 근처에서 시작하므로 −5일 마감은 차트 왼쪽 끝 바로 안쪽이다.
      { id: 3, projectId: 1, name: '경계 근처 마일스톤', dueDate: isoFromToday(-5), description: null, createdAt: '', updatedAt: '' },
    ],
  });
  // 기본 기간(사이클 없음 → 최근 3개월~향후 6개월)의 차트는 120일 전 마일스톤보다 늦게 시작한다.
  // 그 기간 안에 막대가 있어야 간트가 그려진다.
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [createIssue({ number: 1, title: '이번 주 이슈', startDate: isoFromToday(-1), dueDate: isoFromToday(3) })];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  await page.goto(`/projects/${KEY}/timeline`);
  const scroller = page.locator('.timeline-gantt-root .wx-chart').first();
  await expect(page.getByTestId('milestone-chip-2')).toBeVisible();
  const chartLeft = await scroller.evaluate((el) => el.getBoundingClientRect().left);

  // 차트 시작 전 마일스톤은 칩·점선이 숨고, 보이는 칩은 차트 왼쪽 경계 오른쪽에 있다.
  await expect(page.getByTestId('milestone-chip-1')).toBeHidden();
  await expect(page.getByTestId('milestone-vline-1')).toBeHidden();
  expect((await page.getByTestId('milestone-chip-2').boundingBox())!.x).toBeGreaterThanOrEqual(chartLeft - 1);
  expect((await page.getByTestId('milestone-vline-2').boundingBox())!.x).toBeGreaterThanOrEqual(chartLeft - 1);

  // 마감일은 차트 안이지만 칩 가운데 정렬로는 왼쪽 경계를 넘는 마일스톤은 차트 왼쪽 끝에 붙는다.
  await expect(page.getByTestId('milestone-chip-3')).toBeVisible();
  expect((await page.getByTestId('milestone-chip-3').boundingBox())!.x).toBeGreaterThanOrEqual(chartLeft - 1);
});

test('레인 빈 곳 클릭 → 클릭 좌표 날짜가 채워진 생성 다이얼로그', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  const posts = trackRequests(page, 'POST', `/api/v1/projects/${KEY}/milestones`);
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-lane').click({ position: { x: 400, y: 16 } });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const dueDateInput = dialog.locator('input[type="date"], input[name="dueDate"]').first();
  await expect(dueDateInput).not.toHaveValue('');
  await expect(dueDateInput).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByTestId('milestone-name-input').fill('레인 생성 마일스톤');
  await page.getByTestId('milestone-submit').click();
  await expect.poll(() => posts.lastBody()).toMatchObject({ name: '레인 생성 마일스톤' });
});

test('레인 좌측 끝(라벨 근처) 클릭 → 날짜가 클램프되어 비정상(1970년 등) 값이 채워지지 않는다', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  // 최종 리뷰 Minor #1 회귀 테스트 — dateFromClientX 가 클램프 없이 음수 offsetX 를 그대로
  // 날짜로 환산하면 "마일스톤" 라벨 근처(레인 좌측 끝) 클릭 시 1970년대 등 비정상 날짜가 채워졌다.
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  // x=2 는 "마일스톤" 라벨 바로 옆(레인 좌측 끝) — 스크롤 컨테이너 기준 offsetX 가 음수가 되는 지점.
  await page.getByTestId('milestone-lane').click({ position: { x: 2, y: 16 } });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const dueDateInput = dialog.locator('input[type="date"], input[name="dueDate"]').first();
  const value = await dueDateInput.inputValue();
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // 클램프된 값은 최소 scales.start 이상이어야 한다 — 1970년 등 음수 offsetX 환산값이면 실패.
  expect(new Date(value).getFullYear()).toBeGreaterThanOrEqual(2020);
});
