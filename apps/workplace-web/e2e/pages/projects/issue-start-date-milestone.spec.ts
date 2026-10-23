// 이슈 상세 시작일 피커 + 마일스톤 피커, 생성 다이얼로그 시작일 입력 E2E (Task 11 / #620).
// 입력(날짜 선택/마일스톤 선택) → 처리(PATCH·POST payload) → 출력(UI 반영) 전 파이프라인 검증.

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { mockApi } from '../../fixtures/api-mock';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import type { MilestoneResponse } from '../../../src/types/milestone';
import { expectSelectedRow } from '../../fixtures/selection';

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
  const patches = trackRequests(page, 'PATCH', ISSUE_DETAIL_PATH);

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
    // 접근 이름에 보이는 값이 붙는다(WP-853) — 고정 이름 「시작일 선택」만 읽히던 문제.
    await expect(page.getByRole('button', { name: '시작일 선택: 없음', exact: true })).toBeVisible();

    await page.getByTestId('start-date-trigger').click();
    await expect(page.getByTestId('start-date-popover')).toBeVisible();

    const day10 = page.locator('[data-testid="start-date-popover"] [data-slot="calendar"] button[data-day]', {
      hasText: '10',
    }).first();
    await day10.click();

    await patches.waitFor();
    const last = patches.lastBody<Record<string, unknown>>()!;
    expect(typeof last.startDate).toBe('string');
    expect(last.startDate).toMatch(/^\d{4}-\d{2}-10$/);
    expect(last.clearStartDate).toBeFalsy();

    await expect(page.getByTestId('start-date-popover')).not.toBeVisible();
    await expect(page.getByTestId('start-date-trigger')).toContainText('10일');
    await expect(page.getByTestId('start-date-trigger')).toHaveAccessibleName(/^시작일 선택: \d{4}년 \d{1,2}월 10일$/);
  });

  test('마일스톤 선택 → PATCH {milestoneId} 호출 + UI 반영', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetailStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('milestone-picker-trigger')).toContainText('없음');
    // 접근 이름에 보이는 값이 붙는다(WP-853).
    await expect(page.getByRole('button', { name: '마일스톤 선택: 없음', exact: true })).toBeVisible();

    await page.getByTestId('milestone-picker-trigger').click();
    await expect(page.getByTestId('milestone-picker-popover')).toBeVisible();
    await page.getByTestId('milestone-option-2').click();

    await patches.waitFor();
    const last = patches.lastBody<Record<string, unknown>>()!;
    expect(last.milestoneId).toBe(2);
    expect(last.clearMilestone).toBeFalsy();

    await expect(page.getByTestId('milestone-picker-popover')).not.toBeVisible();
    await expect(page.getByTestId('milestone-picker-trigger')).toContainText('v2.0 출시');
    await expect(page.getByTestId('milestone-picker-trigger')).toHaveAccessibleName('마일스톤 선택: v2.0 출시');
  });

  test('마일스톤 선택 해제 → PATCH {clearMilestone: true} + "없음" 복원', async ({ authenticatedPage: page }) => {
    const { patches } = await setupDetailStubs(page, { milestoneId: 1 });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('milestone-picker-trigger')).toContainText('v1.0 출시');

    await page.getByTestId('milestone-picker-trigger').click();
    await expect(page.getByTestId('milestone-picker-popover')).toBeVisible();
    // WP-368 — 현재 연결된 마일스톤(1)만 선택 전용 표시(막대 + bg-selected).
    await expectSelectedRow(page.getByTestId('milestone-option-1'), page.getByTestId('milestone-option-2'));
    await page.getByTestId('milestone-option-clear').click();

    await patches.waitFor();
    const last = patches.lastBody<Record<string, unknown>>()!;
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

    const creates = trackRequests(page, 'POST', `/api/v1/projects/${PROJECT_KEY}/issues`);
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/issues`, (route) => {
      if (route.request().method() === 'POST') {
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
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible();

    await page.getByLabel('제목').fill('타임라인 이슈');
    await page.locator('#issue-start').fill('2026-07-01');
    await page.getByRole('button', { name: '생성' }).click();

    await expect.poll(() => creates.lastBody<{ startDate?: string }>()?.startDate).toBe('2026-07-01');
  });

  // WP-463: 4칸 한 줄이면 날짜 칸이 약 106px 라 연도가 잘렸다 — 2×2 로 두어 날짜 칸이 날짜 전체를 담을 폭을 갖는다.
  test('새 이슈 다이얼로그의 시작일·마감일 칸은 날짜 전체가 보일 만큼 넓다(WP-463)', async ({ authenticatedPage: page }) => {
    await stubProject(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible();

    for (const id of ['#issue-start', '#issue-due']) {
      const input = page.locator(id);
      await input.fill('2026-10-01');
      const box = await input.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(160);
    }
  });

  test('시작일 > 마감일이면 클라이언트 검증 에러로 제출이 막힌다', async ({ authenticatedPage: page }) => {
    await stubProject(page);

    const creates = trackRequests(page, 'POST', `/api/v1/projects/${PROJECT_KEY}/issues`);
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/issues`, (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible();

    await page.getByLabel('제목').fill('일정 역순 이슈');
    await page.locator('#issue-start').fill('2026-07-10');
    await page.locator('#issue-due').fill('2026-07-01');
    await page.getByRole('button', { name: '생성' }).click();

    await expect(page.getByText('시작일은 마감일보다 늦을 수 없습니다')).toBeVisible();
    expect(creates.count()).toBe(0);
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible();
  });
});
