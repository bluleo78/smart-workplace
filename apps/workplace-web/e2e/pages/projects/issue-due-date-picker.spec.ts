// 이슈 상세 마감일 DatePicker E2E 회귀 테스트 (refs #284)
// native <input type="date"> → shadcn Popover + Calendar 교체 검증.
// 입력(날짜 선택) → 처리(PATCH payload) → 출력(UI 반영) 전 파이프라인 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const ISSUE_DETAIL_PATH = `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`;

/** 이슈 상세 페이지 진입에 필요한 기본 스텁 설정. */
async function setupStubs(
  page: import('@playwright/test').Page,
  initialDueDate: string | null = null,
) {
  let currentDueDate = initialDueDate;
  const patches: Record<string, unknown>[] = [];

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 이슈 상세 GET — 가변 dueDate 반영.
  await page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({
              id: ISSUE_NUMBER,
              number: ISSUE_NUMBER,
              dueDate: currentDueDate,
            }),
          }),
        ),
      });
    },
  );

  // 보조 엔드포인트.
  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route(
      (url) => url.pathname === `${ISSUE_DETAIL_PATH}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }

  // PATCH — payload 기록 + dueDate 상태 갱신.
  await page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      patches.push(payload);
      if (typeof payload.dueDate === 'string') currentDueDate = payload.dueDate;
      if (payload.clearDueDate === true) currentDueDate = null;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, dueDate: currentDueDate }),
        ),
      });
    },
  );

  return { patches };
}

test.describe('이슈 상세 마감일 DatePicker (#284)', () => {
  test(
    'native input이 없고 shadcn DatePicker 트리거 버튼이 렌더된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupStubs(page);
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // shadcn DatePicker 트리거 버튼이 표시됨.
      await expect(page.getByTestId('due-date-trigger')).toBeVisible();

      // native date input이 없어야 함 (회귀 방지).
      await expect(page.locator('input[type="date"]')).toHaveCount(0);

      // 날짜 미설정 시 "없음" 표시.
      await expect(page.getByTestId('due-date-trigger')).toContainText('없음');
    },
  );

  test(
    '날짜 선택 → PATCH {dueDate} 호출 + UI 반영',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const { patches } = await setupStubs(page, null);
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      await expect(page.getByTestId('due-date-trigger')).toContainText('없음');

      // DatePicker 열기.
      await page.getByTestId('due-date-trigger').click();
      await expect(page.getByTestId('due-date-popover')).toBeVisible();

      // 달력에서 15일 버튼 클릭 — shadcn Calendar는 day_button 역할의 버튼으로 구성됨.
      // Popover 안의 data-slot="calendar" 안에서 "15" 텍스트를 가진 버튼을 클릭.
      const day15 = page.locator('[data-testid="due-date-popover"] [data-slot="calendar"] button[data-day]', {
        hasText: '15',
      }).first();
      await day15.click();

      // PATCH 요청이 dueDate를 포함해야 함.
      await expect.poll(() => patches.length).toBeGreaterThanOrEqual(1);
      const last = patches[patches.length - 1];
      expect(typeof last.dueDate).toBe('string');
      // YYYY-MM-DD 형식 검증.
      expect(last.dueDate).toMatch(/^\d{4}-\d{2}-15$/);
      expect(last.clearDueDate).toBeFalsy();

      // Popover 닫힌 후 트리거에 날짜가 표시됨 ("15일" 포함).
      await expect(page.getByTestId('due-date-popover')).not.toBeVisible();
      await expect(page.getByTestId('due-date-trigger')).toContainText('15일');
    },
  );

  test(
    '마감일 설정 상태에서 지우기 → PATCH {clearDueDate: true} + "없음" 복원',
    async ({ authenticatedPage: page }) => {
      const { patches } = await setupStubs(page, '2026-06-15');
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 초기 상태: 날짜 표시.
      await expect(page.getByTestId('due-date-trigger')).toContainText('2026년 6월 15일');

      // 지우기 버튼 클릭.
      await expect(page.getByTestId('due-date-clear')).toBeVisible();
      await page.getByTestId('due-date-clear').click();

      // PATCH에 clearDueDate: true 포함 확인.
      await expect.poll(() => patches.length).toBeGreaterThanOrEqual(1);
      const last = patches[patches.length - 1];
      expect(last.clearDueDate).toBe(true);

      // 지우기 후 트리거가 "없음" 표시로 복원.
      await expect(page.getByTestId('due-date-trigger')).toContainText('없음');
      // 지우기 버튼이 사라짐.
      await expect(page.getByTestId('due-date-clear')).toHaveCount(0);
    },
  );
});
