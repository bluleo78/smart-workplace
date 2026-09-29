// 사이클 관리 E2E — 목록+진행바 렌더, 생성 플로우, 수정/삭제, 피커, 필터.
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { CycleProgress, CycleResponse, CycleSummary } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';

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

// 사이클 페이지 섹션 이슈 검색 스텁 (#878) — GET /issues 를 cycle 파라미터 값별로 응답한다.
// byCycle 키: 사이클 id 문자열('1') 또는 백로그 'null'. 없는 키는 빈 목록. requests 에 쿼리스트링을 기록한다.
// 글롭은 쿼리스트링을 매칭하지 못하므로 pathname 정확 매칭 predicate 를 쓴다.
async function stubSectionIssues(
  page: import('@playwright/test').Page,
  byCycle: Record<string, IssueResponse[]> = {},
  requests?: URLSearchParams[],
) {
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const params = new URL(route.request().url()).searchParams;
      requests?.push(params);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(byCycle[params.get('cycle') ?? ''] ?? [])),
      });
    },
  );
}

// 사이클 페이지 공통 스텁 — project·cycles·progress·섹션 이슈 검색(빈 목록)을 mock.
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

  // 진행 중 사이클·백로그 섹션이 기본 펼침이라 이슈 검색이 곧바로 나간다 — 빈 기본 스텁으로 프록시 누수 차단.
  await stubSectionIssues(page);
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
    '진행바 색상은 완료율과 일치 — IN_PROGRESS 1건뿐이면 강조색 없이 0% 표시 (#771)',
    async ({ authenticatedPage: page }) => {
      const cycle = createCycle({ id: 1, name: '스프린트 1', status: 'ACTIVE' });
      const progress: CycleProgress = {
        cycleId: 1,
        total: 1,
        done: 0,
        byStatus: { IN_PROGRESS: 1 },
      };

      await setupCyclesPageStubs(page, [cycle], [progress]);
      await page.goto(`/projects/${KEY}/cycles`);

      const bar = page.getByTestId('cycle-progress-1');
      await expect(bar).toBeVisible();

      // IN_PROGRESS 세그먼트가 바 전체를 채워도 "완료"를 뜻하는 강조색(bg-primary/bg-destructive)이 없어야 한다.
      await expect(bar.locator('[class*="bg-primary"]')).toHaveCount(0);
      await expect(bar.locator('[class*="bg-destructive"]')).toHaveCount(0);
      await expect(bar.locator('[class*="bg-success"]')).toHaveCount(0);

      // 완료율 텍스트는 0/1 완료 (0%) 로, 시각적으로도 색이 채워지지 않아 모순이 없다.
      await expect(bar).toContainText('0/1 완료 (0%)');
    },
  );

  test('PageHeader 프로젝트 복귀 내비게이션 노출 (#667)', async ({ authenticatedPage: page }) => {
    await setupCyclesPageStubs(page, [], []);
    await page.goto(`/projects/${KEY}/cycles`);

    const header = page.getByTestId('page-header');
    await expect(header).toBeVisible();
    await expect(header).toContainText(KEY);
    await header.getByRole('button', { name: '프로젝트로 돌아가기' }).click();
    await expect(page).toHaveURL(`/projects/${KEY}`);
  });

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

      // 완료 사이클은 기본 숨김(#878) — 토글로 펼친 뒤 확인한다.
      await page.getByTestId('completed-cycles-toggle').click();
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

      const trigger = page.getByTestId('cycle-status-select');

      // shadcn Select — 트리거에 초기값 한국어 표시
      await expect(trigger).toBeVisible();
      await expect(trigger).not.toContainText('PLANNED');
      await expect(trigger).toContainText('계획됨');

      // 드롭다운 열어 전체 옵션 한국어 확인
      await trigger.click();
      const content = page.locator('[role="listbox"]');
      await expect(content.getByRole('option', { name: '계획됨' })).toBeVisible();
      await expect(content.getByRole('option', { name: '진행 중' })).toBeVisible();
      await expect(content.getByRole('option', { name: '완료됨' })).toBeVisible();
      await expect(content).not.toContainText('PLANNED');
      await expect(content).not.toContainText('ACTIVE');
      await expect(content).not.toContainText('COMPLETED');
      // 닫기
      await page.keyboard.press('Escape');
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
      await stubSectionIssues(page);

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
    '종료일이 시작일보다 빠르면 저장 차단 + 인라인 오류 (#804)',
    async ({ authenticatedPage: page }) => {
      await setupCyclesPageStubs(page, [], []);

      // POST 가 발생하면 실패 처리 — 버튼 비활성으로 애초에 막혀야 하므로 호출되면 안 됨.
      let postFired = false;
      await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        }
        if (method === 'POST') {
          postFired = true;
          return route.fallback();
        }
        return route.fallback();
      });

      await page.goto(`/projects/${KEY}/cycles`);

      await page.getByTestId('cycle-new').click();
      await expect(page.getByTestId('cycle-form-dialog')).toBeVisible();

      await page.getByTestId('cycle-name-input').fill('종료일역전테스트');
      await page.getByLabel('시작일').fill('2026-09-10');
      await page.getByLabel('종료일').fill('2026-09-01');

      // 인라인 오류 메시지 노출.
      await expect(page.getByTestId('cycle-date-range-error')).toContainText('종료일은 시작일 이후여야 합니다');

      // 저장 버튼 비활성화 확인.
      await expect(page.getByTestId('cycle-submit')).toBeDisabled();

      // 강제로 클릭해도(disabled 라 실제 클릭 불가하지만) POST 는 발생하지 않아야 함.
      await page.getByTestId('cycle-submit').click({ force: true });
      await page.waitForTimeout(300);
      expect(postFired).toBe(false);

      // 종료일을 시작일 이후로 고치면 오류가 사라지고 저장 버튼이 다시 활성화된다.
      await page.getByLabel('종료일').fill('2026-09-15');
      await expect(page.getByTestId('cycle-date-range-error')).toHaveCount(0);
      await expect(page.getByTestId('cycle-submit')).toBeEnabled();
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

      await stubSectionIssues(page);

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

      // ＋필터 팝오버를 열어 사이클 facet 이 노출되는지 확인(필터바 로드 대기 겸).
      await page.getByTestId('add-filter-trigger').click();
      await expect(page.getByTestId('add-filter-facet-cycle')).toBeVisible();

      // cycle=1 을 포함하는 이슈 검색 요청을 기다리는 waitForRequest 설정.
      const filteredReq = page.waitForRequest(
        (req) =>
          req.url().includes(`/projects/${KEY}/issues`) &&
          req.url().includes('cycle=1') &&
          req.method() === 'GET',
        { timeout: 5000 },
      );

      // 사이클 facet → 값 체크리스트에서 스프린트 1 선택.
      await page.getByTestId('add-filter-facet-cycle').click();
      await page.getByTestId('facet-value-cycle-1').click();
      await expect(page.getByTestId('filter-chip-cycle')).toBeVisible();

      // cycle=1 을 포함하는 요청이 발생했는지 확인.
      const req = await filteredReq;
      expect(new URL(req.url()).searchParams.get('cycle')).toBe('1');

      // URL 에도 cycle=1 이 반영되는지 확인.
      await expect(page).toHaveURL(/cycle=1/);
    },
  );
});

// ─────────────────────────────────────────────
// 사이클 백로그 (#878) — Jira 백로그 방식 섹션 구조
// ─────────────────────────────────────────────

test.describe('사이클 백로그', () => {
  // 로컬 날짜 2026-06-10 고정(KST 12:00 / UTC 03:00 모두 같은 날) — D-N 계산을 결정적으로.
  const FIXED_NOW = new Date('2026-06-10T03:00:00Z');

  // 진행 중 2 · 예정 1 · 완료 1 사이클 + 섹션별 이슈. 이슈 7번은 활성 사이클 1·2 에 모두 속한다(M:N).
  const cycles: CycleResponse[] = [
    createCycle({ id: 3, name: '예정 스프린트', status: 'PLANNED', startDate: '2026-06-20', endDate: '2026-06-30' }),
    createCycle({ id: 4, name: '지난 스프린트', status: 'COMPLETED', startDate: '2026-05-01', endDate: '2026-05-15' }),
    createCycle({ id: 1, name: '스프린트 A', status: 'ACTIVE', startDate: '2026-06-01', endDate: '2026-06-15' }),
    createCycle({ id: 2, name: '스프린트 B', status: 'ACTIVE', startDate: '2026-06-02', endDate: '2026-06-08' }),
  ];
  const shared = createIssue({ id: 7, number: 7, title: '두 사이클 공유 이슈', status: 'IN_PROGRESS' });
  const byCycle: Record<string, IssueResponse[]> = {
    '1': [createIssue({ id: 1, number: 1, title: '스프린트 A 이슈' }), shared],
    '2': [shared],
    '3': [createIssue({ id: 3, number: 3, title: '예정 이슈' })],
    '4': [createIssue({ id: 4, number: 4, title: '지난 이슈', status: 'DONE' })],
    null: [createIssue({ id: 9, number: 9, title: '백로그 이슈' })],
  };

  // 진행률은 전체(하위 포함) 기준 — 섹션 헤더 숫자는 이 값 하나로 통일된다.
  const progress: CycleProgress[] = [{ cycleId: 1, total: 3, done: 1, byStatus: { DONE: 1, TODO: 2 } }];

  async function setup(page: import('@playwright/test').Page, requests: URLSearchParams[]) {
    await page.clock.setFixedTime(FIXED_NOW);
    await setupCyclesPageStubs(page, cycles, progress);
    await stubSectionIssues(page, byCycle, requests);
    await page.goto(`/projects/${KEY}/cycles`);
  }

  test('진행 중 사이클이 최상단·강조·기본 펼침, D-N/초과 표시', async ({ authenticatedPage: page }) => {
    const requests: URLSearchParams[] = [];
    await setup(page, requests);

    // 문서 순서: 진행 중(시작일순 A→B) → 예정 → 백로그. 완료는 기본 숨김.
    const sections = page.locator('section[data-testid^="cycle-row-"], section[data-testid="backlog-section"]');
    await expect(sections).toHaveCount(4);
    await expect(sections.nth(0)).toHaveAttribute('data-testid', 'cycle-row-1');
    await expect(sections.nth(1)).toHaveAttribute('data-testid', 'cycle-row-2');
    await expect(sections.nth(2)).toHaveAttribute('data-testid', 'cycle-row-3');
    await expect(sections.nth(3)).toHaveAttribute('data-testid', 'backlog-section');

    // 진행 중 사이클 강조 + 배지 + 기본 펼침으로 이슈 행 노출.
    const a = page.getByTestId('cycle-row-1');
    await expect(a).toHaveAttribute('data-active', 'true');
    // 진행 중 배지 — info 변형 + 장식 점(aria-hidden) + 한국어 라벨.
    const badge = a.locator('[data-slot="badge"]:visible');
    await expect(badge).toHaveText('진행 중');
    await expect(badge).toHaveAttribute('data-variant', 'info');
    await expect(badge.locator('span[aria-hidden="true"].rounded-full')).toHaveCount(1);
    const toggle1 = page.getByTestId('cycle-section-toggle-1');
    await expect(toggle1).toHaveAttribute('aria-expanded', 'true');
    // aria-controls 가 펼쳐진 본문 영역을 가리킨다.
    const bodyId = await toggle1.getAttribute('aria-controls');
    expect(bodyId).toBeTruthy();
    await expect(a.locator(`[id="${bodyId}"]`)).toContainText('스프린트 A 이슈');
    await expect(a.getByTestId('section-issue-1')).toContainText('스프린트 A 이슈');
    await expect(a.getByTestId('section-issue-1')).toContainText('WP-1');
    // 사이클 헤더 숫자는 progress 하나로 통일 — 행 수("N건")는 표시하지 않는다.
    await expect(page.getByTestId('cycle-progress-1')).toContainText('1/3 완료 (33%)');
    await expect(page.getByTestId('cycle-row-1-count')).toHaveCount(0);
    // 예정 사이클은 강조하지 않는다.
    await expect(page.getByTestId('cycle-row-3')).not.toHaveAttribute('data-active', 'true');

    // 남은 일수 — 종료 6/15 → D-5, 종료 6/8 → 2일 초과(경고 톤).
    await expect(page.getByTestId('cycle-remaining-1')).toHaveText('D-5');
    await expect(page.getByTestId('cycle-remaining-2')).toHaveText('2일 초과');
    await expect(page.getByTestId('cycle-remaining-2')).toHaveClass(/text-destructive/);

    // M:N — 공유 이슈 7번이 두 활성 섹션 모두에 표시된다.
    await expect(a.getByTestId('section-issue-7')).toBeVisible();
    await expect(page.getByTestId('cycle-row-2').getByTestId('section-issue-7')).toBeVisible();

    // 사이클 섹션 요청은 종료 이슈 숨김(hideInactiveClosed)을 보내지 않는다.
    await expect.poll(() => requests.filter((r) => r.get('cycle') === '1').length).toBeGreaterThan(0);
    for (const r of requests) expect(r.get('hideInactiveClosed')).toBeNull();
  });

  test('예정 사이클은 기본 접힘 — 펼치기 전엔 요청 없음, 펼치면 이슈 로드', async ({ authenticatedPage: page }) => {
    const requests: URLSearchParams[] = [];
    await setup(page, requests);

    const planned = page.getByTestId('cycle-row-3');
    await expect(planned).toBeVisible();
    await expect(page.getByTestId('cycle-section-toggle-3')).toHaveAttribute('aria-expanded', 'false');
    // 기본 펼침 섹션들의 요청이 끝날 때까지 기다린 뒤, 접힌 예정 사이클 요청이 없었음을 확인.
    await expect(page.getByTestId('backlog-section').getByTestId('section-issue-9')).toBeVisible();
    await expect(page.getByTestId('cycle-row-1').getByTestId('section-issue-1')).toBeVisible();
    expect(requests.some((r) => r.get('cycle') === '3')).toBe(false);
    await expect(planned.getByTestId('section-issue-3')).toHaveCount(0);

    await page.getByTestId('cycle-section-toggle-3').click();
    await expect(planned.getByTestId('section-issue-3')).toContainText('예정 이슈');
    expect(requests.some((r) => r.get('cycle') === '3')).toBe(true);
  });

  test('백로그는 cycle=null + 미종료 상태로 요청하고 해당 이슈만 표시', async ({ authenticatedPage: page }) => {
    const requests: URLSearchParams[] = [];
    await setup(page, requests);

    const backlog = page.getByTestId('backlog-section');
    await expect(backlog.getByTestId('section-issue-9')).toContainText('백로그 이슈');
    await expect(backlog.locator('[data-testid^="section-issue-"]')).toHaveCount(1);
    await expect(page.getByTestId('backlog-section-count')).toHaveText('1건');

    const req = requests.find((r) => r.get('cycle') === 'null');
    expect(req).toBeDefined();
    expect(req!.get('status')).toBe('TODO,IN_PROGRESS');
    expect(req!.get('hideInactiveClosed')).toBeNull();
  });

  test('완료 사이클은 기본 숨김 — 토글로 노출(접힘 상태, 편집·삭제 접근)', async ({ authenticatedPage: page }) => {
    const requests: URLSearchParams[] = [];
    await setup(page, requests);

    await expect(page.getByTestId('cycle-row-4')).toHaveCount(0);
    const toggle = page.getByTestId('completed-cycles-toggle');
    await expect(toggle).toHaveText('완료된 사이클 (1)');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const listId = await toggle.getAttribute('aria-controls');
    expect(listId).toBeTruthy();
    await expect(page.locator(`[id="${listId}"]`).getByTestId('cycle-row-4')).toBeVisible();
    const done = page.getByTestId('cycle-row-4');
    await expect(done).toBeVisible();
    await expect(done).toContainText('완료됨');
    await expect(page.getByTestId('cycle-section-toggle-4')).toHaveAttribute('aria-expanded', 'false');
    await expect(done.getByLabel('수정')).toBeVisible();
    await expect(page.getByTestId('cycle-delete-4')).toBeVisible();

    // 완료 사이클도 펼치면 DONE 이슈가 그대로 보인다(종료 이슈 숨김 미적용).
    await page.getByTestId('cycle-section-toggle-4').click();
    await expect(done.getByTestId('section-issue-4')).toContainText('지난 이슈');
  });

  test('완료 사이클이 없으면 토글 없음', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await setupCyclesPageStubs(page, cycles.filter((c) => c.status !== 'COMPLETED'), []);
    await page.goto(`/projects/${KEY}/cycles`);
    await expect(page.getByTestId('cycle-row-1')).toBeVisible();
    await expect(page.getByTestId('completed-cycles-toggle')).toHaveCount(0);
  });

  test('이슈 행 클릭 → 이슈 상세로 이동', async ({ authenticatedPage: page }) => {
    const requests: URLSearchParams[] = [];
    await setup(page, requests);
    await page.getByTestId('backlog-section').getByTestId('section-issue-9').click();
    await expect(page).toHaveURL(`/projects/${KEY}/issues/9`);
  });
  test('빈 섹션 문구 — 하위만 있는 사이클 / 배정 없는 사이클 / 빈 백로그', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    const emptyCycles: CycleResponse[] = [
      createCycle({ id: 5, name: '하위만 있는 스프린트', status: 'ACTIVE', startDate: '2026-06-01', endDate: '2026-06-15' }),
      createCycle({ id: 6, name: '빈 스프린트', status: 'ACTIVE', startDate: '2026-06-02', endDate: '2026-06-16' }),
    ];
    // 사이클 5 는 progress 에 2건(하위 이슈)이 있지만 섹션 범위(상위 작업) 행은 0 — 모순 대신 안내 문구로 설명한다.
    await setupCyclesPageStubs(page, emptyCycles, [
      { cycleId: 5, total: 2, done: 0, byStatus: { TODO: 2 } },
    ]);
    await page.goto(`/projects/${KEY}/cycles`);

    await expect(page.getByTestId('cycle-row-5').getByTestId('section-empty')).toHaveText(
      '표시할 상위 작업이 없습니다 (하위 이슈 2건 포함)',
    );
    await expect(page.getByTestId('cycle-progress-5')).toContainText('0/2 완료 (0%)');
    await expect(page.getByTestId('cycle-row-6').getByTestId('section-empty')).toHaveText(
      '이 사이클에 배정된 작업이 없습니다',
    );
    await expect(page.getByTestId('backlog-section').getByTestId('section-empty')).toHaveText(
      '사이클에 넣지 않은 미완료 이슈가 없습니다',
    );
    await expect(page.getByTestId('backlog-section-count')).toHaveText('0건');
  });

  test('접힌 예정 섹션에도 progress 기반 진행률이 보인다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await setupCyclesPageStubs(page, cycles, [{ cycleId: 3, total: 4, done: 2, byStatus: { DONE: 2, TODO: 2 } }]);
    await page.goto(`/projects/${KEY}/cycles`);
    await expect(page.getByTestId('cycle-section-toggle-3')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('cycle-progress-3')).toContainText('2/4 완료 (50%)');
  });

  test('좁은 화면 — 편집·삭제가 ⋯ 메뉴로 합쳐지고 이슈 행은 우선순위를 숨긴다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const requests: URLSearchParams[] = [];
    await setup(page, requests);

    const a = page.getByTestId('cycle-row-1');
    // 데스크톱 아이콘 버튼은 숨고 ⋯ 메뉴만 보인다.
    await expect(a.getByLabel('수정')).toBeHidden();
    await expect(page.getByTestId('cycle-delete-1')).toBeHidden();
    await expect(page.getByTestId('cycle-menu-1')).toBeVisible();
    // 배지는 메타 행으로 내려가 여전히 보인다.
    await expect(a.locator('[data-slot="badge"]:visible')).toHaveText('진행 중');
    // 이슈 행 — 우선순위 아이콘 숨김, 제목은 보인다.
    const row = a.getByTestId('section-issue-1');
    await expect(row.getByRole('link', { name: '스프린트 A 이슈' })).toBeVisible();
    await expect(row.locator('[aria-label^="우선순위"]:visible')).toHaveCount(0);

    // ⋯ → 수정 → 폼 다이얼로그.
    await page.getByTestId('cycle-menu-1').click();
    await page.getByRole('menuitem', { name: '수정' }).click();
    await expect(page.getByTestId('cycle-form-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cycle-form-dialog')).toBeHidden();

    // ⋯ → 삭제 → 확인 다이얼로그 → DELETE 발생.
    let deleteFired = false;
    await page.route(`**/api/v1/projects/${KEY}/cycles/1`, (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleteFired = true;
      return route.fulfill({ status: 204, body: '' });
    });
    await page.getByTestId('cycle-menu-1').click();
    await page.getByRole('menuitem', { name: '삭제' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click();
    await expect.poll(() => deleteFired, { timeout: 5000 }).toBe(true);
  });
});
