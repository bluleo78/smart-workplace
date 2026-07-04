// 타임라인 마일스톤 UX E2E — 상단 고정 레인(칩)+세로 점선 렌더(#648), 툴바/레인 클릭 2경로 생성,
// 편집 팝오버(이름 수정·삭제), readOnly 비활성. 마일스톤 드래그 이동은 스코프 제외(팝오버 날짜 수정만 유지).
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
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

test('마일스톤이 상단 레인 칩으로 렌더되고 이슈 행을 차지하지 않는다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('milestone-lane')).toBeVisible();
  await expect(page.getByTestId('milestone-chip-1')).toContainText('v1 출시');
  // SVAR 차트에는 milestone 타입 다이아몬드가 더 이상 없다 — 완전히 레인으로 분리됐다.
  await expect(page.locator('.timeline-gantt-root .wx-bar.wx-milestone')).toHaveCount(0);
  // 마감일 세로 점선 렌더.
  await expect(page.getByTestId('milestone-vline-1')).toBeAttached();
});

test('툴바 버튼으로 마일스톤 생성', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  let posted: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
    if (route.request().method() === 'POST') {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 2,
          projectId: 1,
          name: posted!.name,
          dueDate: posted!.dueDate,
          description: null,
          createdAt: '',
          updatedAt: '',
        }),
      });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('milestone-add-button').click();
  await expect(page.getByTestId('milestone-form-dialog')).toBeVisible();
  await page.getByTestId('milestone-name-input').fill('v1.0 베타');
  await page.getByTestId('milestone-due-date-input').fill('2026-07-18');
  await page.getByTestId('milestone-submit').click();
  await expect.poll(() => posted).toMatchObject({ name: 'v1.0 베타', dueDate: '2026-07-18' });
  await expect(page.getByTestId('milestone-form-dialog')).toBeHidden();
});

test('레인 빈 곳 클릭 → 클릭 좌표 날짜가 채워진 생성 다이얼로그', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  let posted: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
    if (route.request().method() === 'POST') {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('milestone-lane').click({ position: { x: 400, y: 16 } });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const dueDateInput = dialog.locator('input[type="date"], input[name="dueDate"]').first();
  await expect(dueDateInput).not.toHaveValue('');
  await expect(dueDateInput).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByTestId('milestone-name-input').fill('레인 생성 마일스톤');
  await page.getByTestId('milestone-submit').click();
  await expect.poll(() => posted).toMatchObject({ name: '레인 생성 마일스톤' });
});

test('레인 좌측 끝(라벨 근처) 클릭 → 날짜가 클램프되어 비정상(1970년 등) 값이 채워지지 않는다', async ({
  authenticatedPage: page,
}) => {
  // 최종 리뷰 Minor #1 회귀 테스트 — dateFromClientX 가 클램프 없이 음수 offsetX 를 그대로
  // 날짜로 환산하면 "마일스톤" 라벨 근처(레인 좌측 끝) 클릭 시 1970년대 등 비정상 날짜가 채워졌다.
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
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

test('칩 클릭 → 편집 팝오버에서 이름 수정', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  let patch: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      patch = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...baseMilestones()[0], ...patch }),
      });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('milestone-chip-1').click();
  const popover = page.getByRole('dialog').or(page.getByTestId('milestone-edit-popover'));
  await expect(popover).toBeVisible();
  // 이름은 텍스트가 아니라 Input value 로 렌더된다.
  await expect(page.getByTestId('milestone-popover-name-input')).toHaveValue('v1 출시');
  await expect(popover).toContainText('연결된 이슈 1개 보기');
  await expect(page.getByTestId('milestone-linked-issues-link')).toHaveAttribute(
    'href',
    `/projects/${KEY}?milestone=1`,
  );
  const nameInput = page.getByTestId('milestone-popover-name-input');
  await nameInput.fill('v1 최종 출시');
  await nameInput.blur();
  await expect.poll(() => patch).toMatchObject({ name: 'v1 최종 출시' });
});

test('팝오버에서 삭제 — AlertDialog 경고 경유', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  let deleted = false;
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() === 'DELETE') {
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('milestone-chip-1').click();
  await page.getByTestId('milestone-delete-trigger').click();
  await expect(page.getByText('연결된 이슈 1개의 연결이 해제됩니다')).toBeVisible();
  await page.getByRole('button', { name: '삭제' }).last().click();
  await expect.poll(() => deleted).toBe(true);
});

test('readOnly(비멤버) — 칩 편집·레인 클릭 생성이 비활성', async ({ authenticatedPage: page }) => {
  await setupStubs(page, { viewerIsMember: false });
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('milestone-add-button')).toHaveCount(0);
  // 레인 빈 곳 클릭 — readOnly 에서는 handleLaneClick 이 조기 반환해 생성 다이얼로그가 뜨지 않는다.
  await page.getByTestId('milestone-lane').click({ position: { x: 400, y: 16 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('readOnly(비멤버) — 마일스톤 칩 클릭 시 편집 팝오버가 열리지 않는다', async ({ authenticatedPage: page }) => {
  await setupStubs(page, { viewerIsMember: false });
  await page.goto(`/projects/${KEY}/timeline`);
  await page.getByTestId('milestone-chip-1').click();
  const popover = page.getByRole('dialog').or(page.getByTestId('milestone-edit-popover'));
  await expect(popover).toHaveCount(0);
});
