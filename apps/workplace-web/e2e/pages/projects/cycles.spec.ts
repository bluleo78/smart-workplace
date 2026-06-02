// 사이클 관리 E2E — 목록+진행바 렌더, 생성 플로우.
import { expect, test } from '../../fixtures/auth.fixture';
import { createProject } from '../../factories/project.factory';
import type { CycleProgress, CycleResponse } from '../../../src/types/cycle';

const KEY = 'WP';

// 테스트용 사이클 팩토리.
function createCycle(overrides: Partial<CycleResponse> = {}): CycleResponse {
  const now = new Date().toISOString();
  return {
    id: 1,
    projectId: 1,
    name: '스프린트 1',
    goal: null,
    startDate: null,
    endDate: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test.describe('사이클 관리', () => {
  test(
    '목록 + 진행바 렌더 — ACTIVE 사이클과 1/4 완료(25%) 진행바 표시',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const cycle = createCycle({ id: 1, name: '스프린트 1', status: 'ACTIVE' });
      const progress: CycleProgress = {
        cycleId: 1,
        total: 4,
        done: 1,
        byStatus: { DONE: 1, TODO: 3 },
      };

      await page.route(`**/api/v1/projects/${KEY}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createProject()),
        }),
      );

      await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([cycle]),
        });
      });

      await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([progress]),
        });
      });

      await page.goto(`/projects/${KEY}/cycles`);

      // 사이클 행이 렌더되고 이름이 표시된다.
      await expect(page.getByTestId('cycle-row-1')).toBeVisible();
      await expect(page.getByTestId('cycle-row-1')).toContainText('스프린트 1');

      // 진행바가 1/4 완료 (25%) 텍스트를 표시한다.
      await expect(page.getByTestId('cycle-progress-1')).toContainText('1/4 완료 (25%)');
    },
  );

  test(
    '새 사이클 생성 — cycle-new → 이름 입력 → 저장 → POST 요청 발생',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const cycles: CycleResponse[] = [];

      await page.route(`**/api/v1/projects/${KEY}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createProject()),
        }),
      );

      await page.route(`**/api/v1/projects/${KEY}/cycles`, async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(cycles),
          });
        }
        if (method === 'POST') {
          const body = route.request().postDataJSON() as { name: string };
          const now = new Date().toISOString();
          const created: CycleResponse = {
            id: cycles.length + 1,
            projectId: 1,
            name: body.name,
            goal: null,
            startDate: null,
            endDate: null,
            status: 'PLANNED',
            createdAt: now,
            updatedAt: now,
          };
          cycles.push(created);
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(created),
          });
        }
        return route.fallback();
      });

      await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
      );

      await page.goto(`/projects/${KEY}/cycles`);

      // 빈 상태 — 아직 사이클이 없습니다 메시지 확인.
      await expect(page.getByText('아직 사이클이 없습니다.')).toBeVisible();

      // POST 요청 캡처를 위해 대기자 설정.
      let postFired = false;
      page.on('request', (req) => {
        if (
          req.url().includes(`/api/v1/projects/${KEY}/cycles`) &&
          !req.url().includes('/progress') &&
          req.method() === 'POST'
        ) {
          postFired = true;
        }
      });

      // 새 사이클 버튼 클릭 → 다이얼로그 열림.
      await page.getByTestId('cycle-new').click();
      await expect(page.getByTestId('cycle-form-dialog')).toBeVisible();

      // 이름 입력.
      await page.getByTestId('cycle-name-input').fill('스프린트 A');

      // 저장 버튼 클릭.
      await page.getByTestId('cycle-submit').click();

      // POST 가 발생했는지 확인.
      await expect.poll(() => postFired, { timeout: 5000 }).toBe(true);
    },
  );
});
