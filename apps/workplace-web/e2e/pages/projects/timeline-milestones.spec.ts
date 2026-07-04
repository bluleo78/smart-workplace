// 타임라인 마일스톤 UX E2E — 툴바/레인 클릭 2경로 생성, 편집 팝오버(이름 수정·삭제), 드래그 이동.
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

function setupTimelineStubs(page: Page, milestones: MilestoneResponse[] = baseMilestones()) {
  return Promise.all([
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

test('툴바 버튼으로 마일스톤 생성', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
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

test('레인 빈곳 클릭 — 날짜 프리필된 생성 다이얼로그', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  let posted: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
    if (route.request().method() === 'POST') {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  const chart = page.locator('.wx-chart');
  await expect(chart).toBeVisible();
  const box = (await chart.boundingBox())!;
  // 어떤 막대/마일스톤과도 겹치지 않는 빈 그리드 영역(하단) 클릭 — onLaneClick 발화.
  await page.mouse.click(box.x + 30, box.y + box.height - 15);
  await expect(page.getByTestId('milestone-form-dialog')).toBeVisible();
  const dueDateInput = page.getByTestId('milestone-due-date-input');
  await expect(dueDateInput).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByTestId('milestone-name-input').fill('레인 생성 마일스톤');
  await page.getByTestId('milestone-submit').click();
  await expect.poll(() => posted).toMatchObject({ name: '레인 생성 마일스톤' });
});

test('다이아몬드 클릭 → 편집 팝오버에서 이름 수정', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
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
  await page.locator('[data-task-id="\\:milestone-1"]').click();
  const popover = page.getByTestId('milestone-edit-popover');
  await expect(popover).toBeVisible();
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
  await setupTimelineStubs(page);
  let deleted = false;
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() === 'DELETE') {
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  await page.locator('[data-task-id="\\:milestone-1"]').click();
  await page.getByTestId('milestone-delete-trigger').click();
  await expect(page.getByText('연결된 이슈 1개의 연결이 해제됩니다')).toBeVisible();
  await page.getByRole('button', { name: '삭제' }).last().click();
  await expect.poll(() => deleted).toBe(true);
});

test('다이아몬드 드래그로 날짜 변경', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
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
  const diamond = page.locator('[data-task-id="\\:milestone-1"]');
  await expect(diamond).toBeVisible();
  // 마일스톤 마감일이 초기 스크롤 위치보다 뒤라 뷰포트 밖일 수 있음 — 드래그는 자동 스크롤을 하지 않으므로 명시적으로 스크롤.
  await diamond.scrollIntoViewIfNeeded();
  const box = (await diamond.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => patch, { timeout: 5000 }).toMatchObject({
    dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
});

test('비멤버는 마일스톤 추가 버튼/레인 클릭 비활성', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  await page.route(`**/api/v1/projects/${KEY}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject({ key: KEY, viewerIsMember: false })),
    });
  });
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('milestone-add-button')).toHaveCount(0);
  const chart = page.locator('.wx-chart');
  const box = (await chart.boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height - 15);
  await expect(page.getByTestId('milestone-form-dialog')).toBeHidden();
});
