// 이슈 상세 시작일 피커 + 마일스톤 피커, 생성 다이얼로그 시작일 입력 E2E (Task 11 / #620).
// 입력(날짜 선택/마일스톤 선택) → 처리(PATCH·POST payload) → 출력(UI 반영) 전 파이프라인 검증.

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { mockApi } from '../../fixtures/api-mock';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import type { MilestoneResponse } from '../../../src/types/milestone';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const ISSUE_DETAIL_PATH = `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`;

function makeMilestone(overrides: Partial<MilestoneResponse> = {}): MilestoneResponse {
  const now = new Date().toISOString();
  return {
    id: 1,
    projectId: 1,
    name: 'v1.0 출시',
    dueDate: '2026-08-01',
    description: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 이슈 상세 페이지 진입에 필요한 기본 스텁 설정. */
async function setupDetailStubs(
  page: Page,
  initial: { startDate?: string | null; milestoneId?: number | null } = {},
) {
  let currentStartDate = initial.startDate ?? null;
  let currentMilestoneId = initial.milestoneId ?? null;
  const patches: Record<string, unknown>[] = [];

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/milestones`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([makeMilestone({ id: 1, name: 'v1.0 출시' }), makeMilestone({ id: 2, name: 'v2.0 출시' })]),
      }),
  );

  await page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    (route) => {
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON() as Record<string, unknown>;
        patches.push(payload);
        if (typeof payload.startDate === 'string') currentStartDate = payload.startDate;
        if (payload.clearStartDate === true) currentStartDate = null;
        if (typeof payload.milestoneId === 'number') currentMilestoneId = payload.milestoneId;
        if (payload.clearMilestone === true) currentMilestoneId = null;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssue({
              id: ISSUE_NUMBER,
              number: ISSUE_NUMBER,
              startDate: currentStartDate,
              milestoneId: currentMilestoneId,
            }),
          ),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({
              id: ISSUE_NUMBER,
              number: ISSUE_NUMBER,
              startDate: currentStartDate,
              milestoneId: currentMilestoneId,
            }),
          }),
        ),
      });
    },
  );

  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route(
      (url) => url.pathname === `${ISSUE_DETAIL_PATH}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }

  return { patches };
}

test.describe('이슈 상세 시작일/마일스톤 피커 (#620)', () => {
  test('시작일 지정 → PATCH {startDate} 호출 + UI 반영', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetailStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('start-date-trigger')).toContainText('없음');

    await page.getByTestId('start-date-trigger').click();
    await expect(page.getByTestId('start-date-popover')).toBeVisible();

    const day10 = page.locator('[data-testid="start-date-popover"] [data-slot="calendar"] button[data-day]', {
      hasText: '10',
    }).first();
    await day10.click();

    await expect.poll(() => patches.length).toBeGreaterThanOrEqual(1);
    const last = patches[patches.length - 1];
    expect(typeof last.startDate).toBe('string');
    expect(last.startDate).toMatch(/^\d{4}-\d{2}-10$/);
    expect(last.clearStartDate).toBeFalsy();

    await expect(page.getByTestId('start-date-popover')).not.toBeVisible();
    await expect(page.getByTestId('start-date-trigger')).toContainText('10일');
  });

  test('마일스톤 선택 → PATCH {milestoneId} 호출 + UI 반영', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetailStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('milestone-picker-trigger')).toContainText('없음');

    await page.getByTestId('milestone-picker-trigger').click();
    await expect(page.getByTestId('milestone-picker-popover')).toBeVisible();
    await page.getByTestId('milestone-option-2').click();

    await expect.poll(() => patches.length).toBeGreaterThanOrEqual(1);
    const last = patches[patches.length - 1];
    expect(last.milestoneId).toBe(2);
    expect(last.clearMilestone).toBeFalsy();

    await expect(page.getByTestId('milestone-picker-popover')).not.toBeVisible();
    await expect(page.getByTestId('milestone-picker-trigger')).toContainText('v2.0 출시');
  });

  test('마일스톤 선택 해제 → PATCH {clearMilestone: true} + "없음" 복원', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetailStubs(page, { milestoneId: 1 });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('milestone-picker-trigger')).toContainText('v1.0 출시');

    await page.getByTestId('milestone-picker-trigger').click();
    await expect(page.getByTestId('milestone-picker-popover')).toBeVisible();
    await page.getByTestId('milestone-option-clear').click();

    await expect.poll(() => patches.length).toBeGreaterThanOrEqual(1);
    const last = patches[patches.length - 1];
    expect(last.clearMilestone).toBe(true);

    await expect(page.getByTestId('milestone-picker-trigger')).toContainText('없음');
  });
});

test.describe('IssueCreateDialog 시작일 입력 (#620)', () => {
  async function stubProject(page: Page) {
    await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject());
    await mockApi(
      page,
      'GET',
      `/api/v1/projects/${PROJECT_KEY}/issues`,
      createIssueSearchResponse([createIssue({ title: '기존 이슈' })]),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/types`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(systemTypes()) }),
    );
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/**`, (route) => {
      if (route.request().method() === 'GET' && !route.request().url().includes('/issues')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.fallback();
    });
  }

  test('시작일 입력 → POST payload 에 startDate 포함', async ({ authenticatedPage: page }) => {
    await stubProject(page);

    let submittedStartDate: unknown;
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/issues`, (route) => {
      if (route.request().method() === 'POST') {
        submittedStartDate = route.request().postDataJSON().startDate;
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(createIssue({ startDate: '2026-07-01' })),
        });
      }
      return route.fallback();
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    await expect(page.getByRole('dialog', { name: '새 태스크' })).toBeVisible();

    await page.getByLabel('제목').fill('타임라인 이슈');
    await page.locator('#issue-start').fill('2026-07-01');
    await page.getByRole('button', { name: '생성' }).click();

    await expect.poll(() => submittedStartDate).toBe('2026-07-01');
  });

  test('시작일 > 마감일이면 클라이언트 검증 에러로 제출이 막힌다', async ({ authenticatedPage: page }) => {
    await stubProject(page);

    let createRequested = false;
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/issues`, (route) => {
      if (route.request().method() === 'POST') {
        createRequested = true;
        return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    await expect(page.getByRole('dialog', { name: '새 태스크' })).toBeVisible();

    await page.getByLabel('제목').fill('일정 역순 이슈');
    await page.locator('#issue-start').fill('2026-07-10');
    await page.locator('#issue-due').fill('2026-07-01');
    await page.getByRole('button', { name: '생성' }).click();

    await expect(page.getByText('시작일은 마감일보다 늦을 수 없습니다')).toBeVisible();
    expect(createRequested).toBe(false);
    await expect(page.getByRole('dialog', { name: '새 태스크' })).toBeVisible();
  });
});
