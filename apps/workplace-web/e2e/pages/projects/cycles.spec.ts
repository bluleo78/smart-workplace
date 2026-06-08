// 사이클 관리 E2E — 목록+진행바 렌더, 생성 플로우, 수정/삭제, 피커, 필터.
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { CycleProgress, CycleResponse, CycleSummary } from '../../../src/types/cycle';

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

// 사이클 페이지 공통 스텁 — project·cycles·progress 를 mock.
async function setupCyclesPageStubs(
  page: import('@playwright/test').Page,
  cycles: CycleResponse[],
  progress: CycleProgress[],
) {
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
      body: JSON.stringify(cycles),
    });
  });

  await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(progress),
    });
  });
}

// 이슈 상세 공통 스텁 — IssueDetailPage 에서 동시에 fetch 되는 부수 endpoint 모두 막음.
// assignees.spec.ts 의 setupCommonStubs 패턴을 사이클 픽커에 맞게 재사용.
async function setupIssueDetailStubs(page: import('@playwright/test').Page) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );

  await page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })]),
    });
  });

  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueDetail({
          summary: createIssue({ id: 1, number: 1, title: '사이클 테스트 이슈' }),
        })),
      });
    },
  );

  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1/watchers`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1/attachments`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    },
  );

  // 이슈 타입 — IssueChildrenSection 이 GET /types 로드.
  await page.route(`**/api/v1/projects/${KEY}/types`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // 커스텀 필드 — CustomFieldsSection 이 GET /fields 로드.
  await page.route(`**/api/v1/projects/${KEY}/fields`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // 자식 이슈 검색 — IssueChildrenSection 이 searchIssues(parent=1) 호출.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues` && url.search.includes('parent='),
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    },
  );
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

      await setupCyclesPageStubs(page, [cycle], [progress]);
      await page.goto(`/projects/${KEY}/cycles`);

      // 사이클 행이 렌더되고 이름이 표시된다.
      await expect(page.getByTestId('cycle-row-1')).toBeVisible();
      await expect(page.getByTestId('cycle-row-1')).toContainText('스프린트 1');

      // 진행바가 1/4 완료 (25%) 텍스트를 표시한다.
      await expect(page.getByTestId('cycle-progress-1')).toContainText('1/4 완료 (25%)');
    },
  );

  test(
    '상태 레이블 한국어 표시 — PLANNED/ACTIVE/COMPLETED 영문 enum 대신 한국어 표시',
    async ({ authenticatedPage: page }) => {
      const cycles: CycleResponse[] = [
        createCycle({ id: 1, name: '계획 사이클', status: 'PLANNED' }),
        createCycle({ id: 2, name: '진행 사이클', status: 'ACTIVE' }),
        createCycle({ id: 3, name: '완료 사이클', status: 'COMPLETED' }),
      ];

      await setupCyclesPageStubs(page, cycles, []);
      await page.goto(`/projects/${KEY}/cycles`);

      // 영문 enum 값이 그대로 표시되지 않고 한국어로 변환되어 표시된다.
      await expect(page.getByTestId('cycle-row-1')).toContainText('계획됨');
      await expect(page.getByTestId('cycle-row-1')).not.toContainText('PLANNED');

      await expect(page.getByTestId('cycle-row-2')).toContainText('진행 중');
      await expect(page.getByTestId('cycle-row-2')).not.toContainText('ACTIVE');

      await expect(page.getByTestId('cycle-row-3')).toContainText('완료됨');
      await expect(page.getByTestId('cycle-row-3')).not.toContainText('COMPLETED');
    },
  );

  test(
    '사이클 폼 다이얼로그 상태 드롭다운 한국어 표시 — PLANNED/ACTIVE/COMPLETED 영문 enum 대신 한국어 옵션',
    async ({ authenticatedPage: page }) => {
      await setupCyclesPageStubs(page, [], []);
      await page.goto(`/projects/${KEY}/cycles`);

      // 새 사이클 다이얼로그 열기.
      await page.getByTestId('cycle-new').click();
      await expect(page.getByTestId('cycle-form-dialog')).toBeVisible();

      const select = page.getByLabel('상태');

      // 영문 enum 값이 option 레이블로 노출되면 안 된다.
      await expect(select).not.toContainText('PLANNED');
      await expect(select).not.toContainText('ACTIVE');
      await expect(select).not.toContainText('COMPLETED');

      // 한국어 레이블이 옵션으로 표시된다.
      await expect(select.locator('option[value="PLANNED"]')).toHaveText('계획됨');
      await expect(select.locator('option[value="ACTIVE"]')).toHaveText('진행 중');
      await expect(select.locator('option[value="COMPLETED"]')).toHaveText('완료됨');
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

  test(
    '사이클 수정 — 수정 버튼 클릭 → 이름 변경 → PATCH payload 검증 + UI 반영',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const cycle = createCycle({ id: 1, name: '스프린트 1', status: 'ACTIVE' });
      const cyclesRef = { current: [cycle] };

      await setupCyclesPageStubs(page, cyclesRef.current, []);

      // PATCH /cycles/1 — 수정 요청 가로채기.
      let patchPayload: Record<string, unknown> | null = null;
      await page.route(`**/api/v1/projects/${KEY}/cycles/1`, (route) => {
        const method = route.request().method();
        if (method === 'PATCH') {
          patchPayload = route.request().postDataJSON() as Record<string, unknown>;
          const updated: CycleResponse = { ...cycle, name: patchPayload.name as string };
          cyclesRef.current = [updated];
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(updated),
          });
        }
        return route.fallback();
      });

      await page.goto(`/projects/${KEY}/cycles`);

      // 사이클 행이 렌더되는지 확인.
      await expect(page.getByTestId('cycle-row-1')).toBeVisible();

      // 수정 버튼 클릭 → 다이얼로그 열림.
      await page.getByTestId('cycle-row-1').getByLabel('수정').click();
      await expect(page.getByTestId('cycle-form-dialog')).toBeVisible();

      // 기존 이름이 pre-fill 되어 있음 → 지우고 새 이름 입력.
      await page.getByTestId('cycle-name-input').clear();
      await page.getByTestId('cycle-name-input').fill('스프린트 1 (수정됨)');

      // 저장 클릭.
      await page.getByTestId('cycle-submit').click();

      // PATCH payload 검증.
      await expect.poll(() => patchPayload, { timeout: 5000 }).toMatchObject({ name: '스프린트 1 (수정됨)' });

      // 성공 토스트 확인.
      await expect(page.getByText('사이클을 수정했습니다')).toBeVisible();
    },
  );

  test(
    '사이클 삭제 — AlertDialog 확인 → DELETE /cycles/{id} 발생 + 행 사라짐',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const cycle = createCycle({ id: 1, name: '스프린트 1', status: 'ACTIVE' });
      let cycleList: CycleResponse[] = [cycle];

      await page.route(`**/api/v1/projects/${KEY}`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
      );

      // GET /cycles — 삭제 후 재조회 시 빈 배열 반환.
      await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(cycleList),
        });
      });

      await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });

      // DELETE /cycles/1 — 204 응답 + cycleList 비우기.
      let deleteFired = false;
      await page.route(`**/api/v1/projects/${KEY}/cycles/1`, (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        deleteFired = true;
        cycleList = [];
        return route.fulfill({ status: 204, body: '' });
      });

      await page.goto(`/projects/${KEY}/cycles`);
      await expect(page.getByTestId('cycle-row-1')).toBeVisible();

      // 삭제 버튼 클릭 → shadcn AlertDialog 표시.
      await page.getByTestId('cycle-delete-1').click();

      // AlertDialog 의 삭제 확인 버튼 클릭 — window.confirm 대신 shadcn AlertDialog 사용 (#145).
      await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click();

      // DELETE 요청 발생 확인.
      await expect.poll(() => deleteFired, { timeout: 5000 }).toBe(true);

      // 성공 토스트 + 행 사라짐.
      await expect(page.getByText('사이클을 삭제했습니다')).toBeVisible();
      await expect(page.getByTestId('cycle-row-1')).toHaveCount(0);
    },
  );
});

// ─────────────────────────────────────────────
// 사이클 피커 (이슈 상세 사이드바)
// ─────────────────────────────────────────────
test.describe('사이클 피커', () => {
  test(
    '이슈 상세에서 사이클 선택 → Escape 닫기 → PUT {cycleIds:[1]} 발생 + 칩 노출',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const cycle = createCycle({ id: 1, name: '스프린트 1', status: 'ACTIVE' });
      const cycleSummary: CycleSummary = { id: 1, name: '스프린트 1', status: 'ACTIVE' };

      await setupIssueDetailStubs(page);

      // GET /cycles — 피커에 표시될 전체 사이클 목록.
      await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([cycle]),
        });
      });

      // GET /issues/1/cycles — 현재 연결된 사이클 없음.
      let issueCycles: CycleSummary[] = [];
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1/cycles`,
        (route) => {
          const method = route.request().method();
          if (method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(issueCycles),
            });
          }
          return route.fallback();
        },
      );

      // PUT /issues/1/cycles — payload 캡처.
      let putPayload: { cycleIds: number[] } | null = null;
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1/cycles`,
        (route) => {
          if (route.request().method() !== 'PUT') return route.fallback();
          putPayload = route.request().postDataJSON() as { cycleIds: number[] };
          issueCycles = [cycleSummary];
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([cycleSummary]),
          });
        },
      );

      await page.goto(`/projects/${KEY}/issues/1`);

      // 피커 트리거 클릭 → 팝오버 열림.
      await page.getByTestId('cycle-picker-trigger').click();
      await expect(page.getByTestId('cycle-picker')).toBeVisible();

      // 사이클 옵션 체크.
      await page.getByTestId('cycle-option-1').click();

      // Escape 로 팝오버 닫기 → onOpenChange(false) → PUT 발생.
      await page.keyboard.press('Escape');

      // PUT payload 검증.
      await expect.poll(() => putPayload, { timeout: 5000 }).toEqual({ cycleIds: [1] });

      // 성공 토스트.
      await expect(page.getByText('사이클을 변경했습니다')).toBeVisible();
    },
  );
});

// ─────────────────────────────────────────────
// 사이클 필터 (프로젝트 이슈 목록 페이지)
// ─────────────────────────────────────────────
test.describe('사이클 필터', () => {
  test(
    '사이클 필터 선택 → 이슈 검색 요청 URL 에 cycle=1 포함',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const cycle = createCycle({ id: 1, name: '스프린트 1', status: 'ACTIVE' });

      await page.route(`**/api/v1/projects/${KEY}`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
      );

      await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      // 사이클 목록 — 필터 팝오버에 표시.
      await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([cycle]),
        });
      });

      await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse([])),
          }),
      );

      await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });

      await page.goto(`/projects/${KEY}`);

      // 사이클 필터가 있는 필터바 로드 대기.
      await expect(page.getByTestId('cycle-filter-trigger')).toBeVisible();

      // cycle=1 을 포함하는 이슈 검색 요청을 기다리는 waitForRequest 설정.
      const filteredReq = page.waitForRequest(
        (req) =>
          req.url().includes(`/projects/${KEY}/issues`) &&
          req.url().includes('cycle=1') &&
          req.method() === 'GET',
        { timeout: 5000 },
      );

      // 사이클 필터 팝오버 열기 → 스프린트 1 옵션 클릭.
      await page.getByTestId('cycle-filter-trigger').click();
      await page.getByTestId('cycle-filter-option-1').click();

      // cycle=1 을 포함하는 요청이 발생했는지 확인.
      const req = await filteredReq;
      expect(new URL(req.url()).searchParams.get('cycle')).toBe('1');

      // URL 에도 cycle=1 이 반영되는지 확인.
      await expect(page).toHaveURL(/cycle=1/);
    },
  );
});
