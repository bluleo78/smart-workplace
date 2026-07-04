// 타임라인 페이지 E2E — 프로젝트 홈 진입, 이슈/사이클/마일스톤 렌더, 줌 토글.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { CycleResponse } from '../../../src/types/cycle';
import type { MilestoneResponse } from '../../../src/types/milestone';

const KEY = 'WP';

function setupTimelineStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const members = [
        createMember({ userId: 2, name: '김개발', username: 'kim@example.com' }),
        createMember({ userId: 3, name: '이테스트', username: 'lee@example.com', role: 'MEMBER' }),
      ];
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
      const issues = [
        createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
        createIssue({ number: 2, title: '마감일만 이슈', dueDate: '2026-07-10' }),
        createIssue({ number: 3, title: '미정 이슈' }),
        createIssue({ number: 4, title: '취소된 이슈', status: 'CANCELED', dueDate: '2026-07-08' }),
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const now = new Date().toISOString();
      const cycles: CycleResponse[] = [
        {
          id: 7,
          projectId: 1,
          name: '사이클 7',
          goal: null,
          startDate: '2026-07-01',
          endDate: '2026-07-14',
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycles) });
    }),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const milestones: MilestoneResponse[] = [
        { id: 1, projectId: 1, name: 'v1 출시', dueDate: '2026-08-01', description: null, createdAt: '', updatedAt: '' },
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(milestones) });
    }),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
  ]);
}

test('프로젝트 홈 헤더에서 타임라인 진입', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  await page.goto(`/projects/${KEY}`);
  await page.getByRole('link', { name: '타임라인' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/timeline`));
  await expect(page.getByTestId('timeline-page')).toBeVisible();
});

test('이슈 막대·사이클 밴드·오늘선 렌더', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  // 기간 이슈 + 마감일만 이슈 막대가 렌더되고, 취소된 이슈/미정 이슈는 막대로 렌더되지 않는다.
  await expect(page.getByText('기간 이슈').first()).toBeVisible();
  await expect(page.getByText('마감일만 이슈').first()).toBeVisible();
  await expect(page.getByText('취소된 이슈')).toHaveCount(0);
  await expect(page.getByTestId('timeline-cycle-band')).toContainText('사이클 7');
  await expect(page.getByTestId('timeline-today-line')).toBeVisible();
});

test('이슈 막대가 상태별로 다른 색으로 렌더된다 (#639)', async ({ authenticatedPage: page }) => {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: KEY })) }),
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    const issues = [
      createIssue({ number: 1, title: '할일 이슈', status: 'TODO', startDate: '2026-07-01', dueDate: '2026-07-05' }),
      createIssue({
        number: 2,
        title: '진행중 이슈',
        status: 'IN_PROGRESS',
        startDate: '2026-07-06',
        dueDate: '2026-07-10',
      }),
      createIssue({ number: 3, title: '완료 이슈', status: 'DONE', startDate: '2026-07-11', dueDate: '2026-07-15' }),
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createIssueSearchResponse(issues)),
    });
  });

  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();

  const bg = async (issueNumber: number) =>
    page
      .locator(`.wx-bar[data-task-id$="${issueNumber}"]`)
      .evaluate((el) => getComputedStyle(el).backgroundColor);

  await expect.poll(() => bg(1)).not.toBe('');
  const [todoBg, progressBg, doneBg] = await Promise.all([bg(1), bg(2), bg(3)]);
  expect(todoBg).not.toBe(progressBg);
  expect(progressBg).not.toBe(doneBg);
  expect(todoBg).not.toBe(doneBg);
});

test('막대 드래그 이동 시 startDate+dueDate PATCH', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  let patch: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/projects/${KEY}/issues/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      patch = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssue({ number: 1, title: '기간 이슈' })),
      });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => patch, { timeout: 5000 }).toMatchObject({
    startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
});

test('PATCH 실패 시 토스트 노출 + 서버 상태 복원', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  let issuesRefetchCount = 0;
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    issuesRefetchCount += 1;
    const issues = [
      createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
      createIssue({ number: 2, title: '마감일만 이슈', dueDate: '2026-07-10' }),
      createIssue({ number: 3, title: '미정 이슈' }),
      createIssue({ number: 4, title: '취소된 이슈', status: 'CANCELED', dueDate: '2026-07-08' }),
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createIssueSearchResponse(issues)),
    });
  });
  await page.route(`**/api/v1/projects/${KEY}/issues/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '일정 변경에 실패했습니다' }),
      });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  const initialRefetchCount = issuesRefetchCount;
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('일정 변경에 실패했습니다')).toBeVisible();
  // 실패 시 invalidate 로 이슈 목록을 재조회해 서버 상태로 복원한다.
  await expect.poll(() => issuesRefetchCount).toBeGreaterThan(initialRefetchCount);
});

test('비멤버는 드래그 비활성', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  // setupTimelineStubs 이후 등록한 라우트가 우선 매칭되므로, viewerIsMember:false 오버라이드가 적용된다.
  await page.route(`**/api/v1/projects/${KEY}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject({ key: KEY, viewerIsMember: false })),
    });
  });
  let patchFired = false;
  await page.route(`**/api/v1/projects/${KEY}/issues/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      patchFired = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(patchFired).toBe(false);
});

test('의존 화살표 렌더 (표시 전용)', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  // 기간 이슈(1)→마감일만 이슈(2) 엣지 — 양끝 모두 막대가 있어 렌더 대상.
  await page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ fromIssueNumber: 1, toIssueNumber: 2 }]),
    });
  });
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  const link = page.locator('[data-link-id]');
  await expect(link).toHaveCount(1);
  // 비멤버 조회 전용(readOnly)에서는 링크 편집 UI(연결점 드래그 핸들)가 노출되지 않는다 —
  // TimelineGantt 는 SVAR `readonly` prop 하나로 막대/링크 편집을 동시에 잠근다.
  await page.route(`**/api/v1/projects/${KEY}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject({ key: KEY, viewerIsMember: false })),
    });
  });
  await page.goto(`/projects/${KEY}/timeline`);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  await bar.hover();
  await expect(bar.locator('.wx-link')).toHaveCount(0);
});

test('일정 미정 섹션 — 접이식 + 배치', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [
      createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
      createIssue({ number: 5, title: '미정 이슈A' }),
      createIssue({ number: 6, title: '미정 이슈B' }),
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createIssueSearchResponse(issues)),
    });
  });
  let patch: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/projects/${KEY}/issues/5`, (route) => {
    if (route.request().method() === 'PATCH') {
      patch = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssue({ number: 5, title: '미정 이슈A' })),
      });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline`);
  const section = page.getByTestId('unscheduled-section');
  await expect(section.getByText('일정 미정 (2)')).toBeVisible();
  // 접힘 상태 — 행이 아직 노출되지 않는다.
  await expect(page.getByTestId('unscheduled-row-5')).not.toBeVisible();
  await section.locator('summary').click();
  await expect(page.getByTestId('unscheduled-row-5')).toBeVisible();
  await expect(page.getByTestId('unscheduled-row-6')).toBeVisible();
  await page.getByTestId('unscheduled-schedule-5').click();
  await expect.poll(() => patch).not.toBeNull();
  const body = patch as unknown as { startDate: string; dueDate: string };
  expect(body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const diffDays =
    (new Date(body.dueDate).getTime() - new Date(body.startDate).getTime()) / (1000 * 60 * 60 * 24);
  expect(diffDays).toBe(7);
});

test('주/월 줌 토글', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  const weekButton = page.getByRole('button', { name: '주' });
  const monthButton = page.getByRole('button', { name: '월' });
  await expect(weekButton).toHaveAttribute('aria-pressed', 'true');
  await expect(monthButton).toHaveAttribute('aria-pressed', 'false');
  await monthButton.click();
  await expect(monthButton).toHaveAttribute('aria-pressed', 'true');
  await expect(weekButton).toHaveAttribute('aria-pressed', 'false');
});

test('필터바에 담당자/라벨/마일스톤 facet 이 노출된다 (#638)', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);

  await page.getByTestId('add-filter-trigger').click();
  await expect(page.getByTestId('add-filter-facet-assignee')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-label')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-milestone')).toBeVisible();

  await page.getByTestId('add-filter-facet-assignee').click();
  await expect(page.getByTestId('facet-value-assignee-2')).toContainText('김개발');
});

test('마일스톤 facet 선택 시 URL 파라미터에 반영된다 (#638)', async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);

  await page.getByTestId('add-filter-trigger').click();
  await page.getByTestId('add-filter-facet-milestone').click();
  const milestoneOption = page.getByTestId('facet-value-milestone-1');
  await expect(milestoneOption).toContainText('v1 출시');
  await milestoneOption.click();
  await expect(page).toHaveURL(/milestone=1/);
});
