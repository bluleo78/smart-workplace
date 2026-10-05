// 이슈 → 에픽 드래그 앤 드롭 E2E — 에픽 패널이 드롭 대상. 할당/해제/변경, 임시 패널, 차단, 롤백, 되돌리기.
import type { Page, Route } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { bodyOf, trackRequests } from '../../fixtures/requests';
import { expectStays, measureBox, stableBox } from '../../fixtures/wait';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeSubtaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import type { CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;
const EPIC_A = { number: 10, title: '결제 리뉴얼' };
const EPIC_B = { number: 11, title: '온보딩 개편' };

function epic(e: { number: number; title: string }): IssueResponse {
  return createIssue({ id: e.number, number: e.number, title: e.title, type: makeEpicType(), childCount: 0, childDoneCount: 0 });
}
function parentOf(e: { number: number; title: string } | null) {
  return e ? { number: e.number, title: e.title, type: makeEpicType() } : null;
}

// 상태를 갖는 목 서버 — PATCH /parent 가 성공하면 내부 이슈의 parent 를 바꿔, onSettled 재조회도 저장값을 돌려준다.
async function setup(
  page: Page,
  opts: {
    issues: IssueResponse[];
    member?: boolean;
    patchStatus?: number;
    panelOpen?: boolean;
    // 사이클 목(#878) — 기본 [] 라 목록은 평면 목록. 진행 중·예정 사이클이 있으면 목록이 사이클 구간 그룹이 된다.
    cycles?: CycleResponse[];
    // 사이클 구간별 이슈(cycle 파라미터 값 → 이슈 번호). 지정하면 구간 쿼리는 여기서, 백로그(cycle=null)는 [] 를 돌려준다.
    issuesByCycle?: Record<string, number[]>;
    // 에픽 목록 — 기본 A·B. 긴 목록(스크롤) 검증은 많이 넘긴다.
    epics?: { number: number; title: string }[];
    // 종료된 에픽(WP-245) — 에픽 조회에 status=DONE,CANCELED 가 오면 이 목록을 돌려준다. 기본 [] (구역 없음).
    closedEpics?: IssueResponse[];
  },
) {
  const epics = opts.epics ?? [EPIC_A, EPIC_B];
  const issues = new Map(opts.issues.map((i) => [i.number, i]));
  // PATCH /parent 기록 — 테스트가 뒤에서 같은 URL 을 다시 route 해도 빠지지 않게 요청 자체를 센다.
  const parentPatches = trackRequests(page, 'ANY', /\/api\/v1\/projects\/WP\/issues\/\d+\/parent$/);
  const patches = () =>
    parentPatches.requests().map((r) => ({
      number: Number(/issues\/(\d+)\/parent/.exec(r.url())![1]),
      parentNumber: (bodyOf(r) as { parentNumber: number | null }).parentNumber,
    }));
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject({ key: PROJECT_KEY, type: 'TEAM', viewerIsMember: opts.member ?? true }));
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/members`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/types`, systemTypes());
  // 사이클을 목킹하지 않으면 목록 기본 그룹 판정(useIssueGroupBy)이 실 API 응답에 좌우된다 — 항상 고정한다.
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/cycles`, opts.cycles ?? []);
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/cycles/progress`, []);
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = new URL(route.request().url());
      const cycleParam = url.searchParams.get('cycle');
      const isClosedQuery = (url.searchParams.get('status') ?? '').includes('DONE');
      const body = url.searchParams.get('type') === String(makeEpicType().id)
        ? (isClosedQuery ? (opts.closedEpics ?? []) : epics.map(epic))
        : opts.issuesByCycle && cycleParam != null
          ? (opts.issuesByCycle[cycleParam] ?? []).map((n) => issues.get(n)!)
          : [...issues.values()];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(body)) });
    },
  );
  await page.route(/\/api\/v1\/projects\/WP\/issues\/(\d+)\/parent$/, async (route) => {
    const number = Number(/issues\/(\d+)\/parent/.exec(route.request().url())![1]);
    const { parentNumber } = route.request().postDataJSON() as { parentNumber: number | null };
    if (opts.patchStatus && opts.patchStatus >= 400) {
      return route.fulfill({ status: opts.patchStatus, contentType: 'application/json', body: JSON.stringify({ message: opts.patchStatus === 403 ? '프로젝트 멤버가 아닙니다' : '서버 오류' }) });
    }
    const target = epics.find((e) => e.number === parentNumber) ?? null;
    const cur = issues.get(number)!;
    issues.set(number, { ...cur, parent: parentOf(target) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueDetail({ summary: { ...cur, parent: parentOf(target) } })) });
  });
  if (opts.panelOpen) {
    await page.addInitScript(() => localStorage.setItem('epicSidePanel.open.WP', 'true'));
  }
  return { patches };
}

// 드래그 시작 — PointerSensor distance:5 를 넘기도록 조금 움직인다. 이후 moveOver/drop 로 이어간다.
async function startDrag(page: Page, sourceTestId: string) {
  const box = await stableBox(page.getByTestId(sourceTestId), sourceTestId);
  const x = box.x + Math.min(60, box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y + 8, { steps: 4 });
}
async function moveOver(page: Page, targetTestId: string) {
  const target = page.getByTestId(targetTestId);
  await expect(target).toBeVisible();
  const box = await stableBox(target, targetTestId);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
}
// 이슈 1 상태 PATCH 기록.
function trackStatusPatch(page: Page) {
  return trackRequests(page, 'ANY', /\/issues\/1\/status$/);
}
async function dragTo(page: Page, sourceTestId: string, targetTestId: string) {
  await startDrag(page, sourceTestId);
  await moveOver(page, targetTestId);
  await page.mouse.up();
}

test.describe('이슈 → 에픽 드래그 앤 드롭', () => {
  test('보드: A 소속 카드를 에픽 B 로 옮기면 PATCH parentNumber=B, 카드 배지 B', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, {
      issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO', parent: parentOf(EPIC_A) })],
      panelOpen: true,
    });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await dragTo(page, 'issue-card-1', `epic-filter-${EPIC_B.number}`);
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: EPIC_B.number }]);
    await expect(page.getByTestId('issue-card-1')).toContainText(EPIC_B.title);
    await expect(page.getByText(`「${EPIC_B.title}」에 연결했습니다`)).toBeVisible();
  });

  test('보드 회귀: 컬럼 간 드래그는 상태만 바꾸고 에픽 PATCH 없음', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, {
      issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })],
      panelOpen: true,
    });
    const statusPatches = trackStatusPatch(page);
    await page.route('**/issues/1/status', (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '카드', status: 'IN_PROGRESS' }) })) });
    });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await dragTo(page, 'issue-card-1', 'board-col-IN_PROGRESS');
    await expect.poll(() => statusPatches.lastBody()).toEqual({ status: 'IN_PROGRESS' });
    expect(patches()).toEqual([]);
  });

  test('패널 닫힘 → 드래그 중 임시 패널 표시(에픽 즉시 보임), 놓으면 사라지고 닫힘 설정 유지', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })] });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await expect(page.getByTestId('epic-side-panel')).not.toBeAttached();
    await startDrag(page, 'issue-card-1');
    await expect(page.getByTestId(`epic-filter-${EPIC_A.number}`)).toBeVisible();
    await expect(page.getByTestId('epic-drop-hint')).toHaveText('에픽에 놓으면 연결됩니다');
    await moveOver(page, `epic-filter-${EPIC_A.number}`);
    await expect(page.getByTestId(`epic-filter-${EPIC_A.number}`)).toHaveAttribute('data-drop-state', 'over');
    await page.mouse.up();
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: EPIC_A.number }]);
    await expect(page.getByTestId('epic-side-panel')).not.toBeAttached();
    await expect(page.getByTestId('epic-panel-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  test('드래그 중 상태: 현재 에픽=current, 다른 에픽·미할당=allowed', async ({ authenticatedPage: page }) => {
    await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO', parent: parentOf(EPIC_A) })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await startDrag(page, 'issue-card-1');
    await expect(page.getByTestId(`epic-filter-${EPIC_A.number}`)).toHaveAttribute('data-drop-state', 'current');
    await expect(page.getByTestId(`epic-filter-${EPIC_A.number}`)).toContainText('현재');
    await expect(page.getByTestId(`epic-filter-${EPIC_B.number}`)).toHaveAttribute('data-drop-state', 'allowed');
    await expect(page.getByTestId('epic-filter-unassigned')).toHaveAttribute('data-drop-state', 'allowed');
    await page.mouse.up();
  });

  test('현재 에픽에 놓으면 아무 일 없음', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO', parent: parentOf(EPIC_A) })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await dragTo(page, 'issue-card-1', `epic-filter-${EPIC_A.number}`);
    await expectStays(page, patches, []);
  });

  test('드래그 시작 후 이동 없이 곧바로 놓으면 PATCH 없음', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })] });
    const statusPatch = trackStatusPatch(page);
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await startDrag(page, 'issue-card-1');
    await page.mouse.up();
    await expectStays(page, patches, []);
    expect(statusPatch.count()).toBe(0);
  });

  test('패널(고정)과 보드 사이 틈에 놓으면 상태·에픽 PATCH 모두 없음', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })], panelOpen: true });
    const statusPatch = trackStatusPatch(page);
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    const aside = (await page.getByTestId('epic-side-panel').boundingBox())!;
    const col = (await page.getByTestId('board-col-TODO').boundingBox())!;
    await startDrag(page, 'issue-card-1');
    // 틈 = 패널 오른쪽 끝과 첫 컬럼 왼쪽 끝의 중간, 컬럼 세로 중앙.
    await page.mouse.move((aside.x + aside.width + col.x) / 2, col.y + col.height / 2, { steps: 10 });
    await page.mouse.up();
    await expectStays(page, patches, []);
    expect(statusPatch.count()).toBe(0);
  });

  // 떠 있는 패널은 보드 오른쪽 컬럼을 덮는다 — 패널 위 어디에 놓아도 아래 카드/컬럼으로 새면 안 된다.
  for (const c of [
    { name: '현재 에픽', issue: () => createIssue({ id: 1, number: 1, title: '카드', status: 'TODO', parent: parentOf(EPIC_A) }), target: `epic-filter-${EPIC_A.number}` },
    { name: 'SUBTASK 카드를 에픽', issue: () => createIssue({ id: 1, number: 1, title: '카드', status: 'TODO', type: makeSubtaskType(), parent: { number: 9, title: '부모', type: makeSubtaskType() } }), target: `epic-filter-${EPIC_A.number}` },
  ]) {
    test(`패널 닫힘(떠 있는 패널): ${c.name} 위에 놓으면 상태·에픽 PATCH 모두 없음`, async ({ authenticatedPage: page }) => {
      const { patches } = await setup(page, { issues: [c.issue()] });
      const statusPatch = trackStatusPatch(page);
      // SUBTASK 카드를 보드에 노출하려면 유형 필터가 필요 — 기본 범위는 SUBTASK 숨김.
      await page.goto(`/projects/${PROJECT_KEY}?view=board${c.name.startsWith('SUBTASK') ? `&type=${makeSubtaskType().id}` : ''}`);
      await startDrag(page, 'issue-card-1');
      await moveOver(page, c.target);
      await page.mouse.up();
      await expectStays(page, patches, []);
      expect(statusPatch.count()).toBe(0);
    });
  }

  // 배너는 기본 뷰포트에서 보드 컬럼보다 위에 떠 아래에 깔린 대상이 없다 — 그래서 누수 검증은 패널 하단 빈 여백 중
  // 가려진 컬럼 몸통과 겹치는 지점에서 한다(에픽 항목이 아닌 패널 영역).
  test('패널 닫힘(떠 있는 패널): 가려진 컬럼 위 패널 빈 여백에 놓으면 상태·에픽 PATCH 모두 없음', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })] });
    const statusPatch = trackStatusPatch(page);
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await startDrag(page, 'issue-card-1');
    await expect(page.getByTestId('epic-drop-hint')).toBeVisible();
    const panel = (await page.getByTestId('epic-side-panel').boundingBox())!;
    const lastEpic = (await page.getByTestId(`epic-filter-${EPIC_B.number}`).boundingBox())!;
    const x = panel.x + panel.width / 2;
    // 패널 중앙 x 아래에 깔린 컬럼 — 상태명으로 정확히 찾는다(board-col-count-* 등 접두 일치 회피).
    let covered: { x: number; y: number; width: number; height: number } | null = null;
    for (const st of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) {
      const b = await page.getByTestId(`board-col-${st}`).boundingBox();
      if (b && b.x <= x && x <= b.x + b.width) covered = b;
    }
    expect(covered, '떠 있는 패널이 덮는 보드 컬럼이 있어야 한다').not.toBeNull();
    const y = covered!.y + covered!.height - 10;
    // 지점이 마지막 에픽 항목 아래(빈 여백)이면서 패널 안이어야 의미가 있다.
    expect(y).toBeGreaterThan(lastEpic.y + lastEpic.height);
    expect(y).toBeLessThan(panel.y + panel.height);
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
    await expectStays(page, patches, []);
    expect(statusPatch.count()).toBe(0);
  });

  test('그룹 보드(담당자) 카드도 에픽으로 옮길 수 있다', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=board&group=assignee`);
    await dragTo(page, 'issue-card-1', `epic-filter-${EPIC_A.number}`);
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: EPIC_A.number }]);
  });

  test('목록: 미소속 행 → 에픽 A 할당, 행 칩 A', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행' })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await dragTo(page, 'issue-row-1', `epic-filter-${EPIC_A.number}`);
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: EPIC_A.number }]);
    await expect(page.getByTestId('issue-row-1')).toContainText(EPIC_A.title);
  });

  // 사이클 그룹 목록(#878)도 같은 행(IssueRow)이라 에픽으로 끌 수 있다. 이슈 1 은 두 진행 중 사이클에 모두 속해(M:N)
  // 두 구간에 같은 행이 렌더된다 — 드래그 id 가 구간별로 달라야 잡은 행이 정확히 끌린다.
  test('사이클 그룹 목록: 여러 구간에 보이는 행을 에픽 A 로 옮기면 PATCH parentNumber=A', async ({ authenticatedPage: page }) => {
    const active = (id: number, name: string): CycleResponse => ({
      id, projectId: 1, name, goal: null, startDate: '2026-09-21', endDate: '2026-10-03', status: 'ACTIVE', createdAt: '', updatedAt: '',
    });
    const { patches } = await setup(page, {
      issues: [createIssue({ id: 1, number: 1, title: '행' })],
      panelOpen: true,
      cycles: [active(1, '스프린트 12'), active(2, '핫픽스 주간')],
      issuesByCycle: { '1': [1], '2': [1] },
    });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    const first = page.getByTestId('list-cycle-section-cycle-1').getByTestId('issue-row-1');
    const second = page.getByTestId('list-cycle-section-cycle-2').getByTestId('issue-row-1');
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    // 첫 구간 행을 잡으면 그 행만 드래그 중(opacity-40)이어야 한다 — id 가 겹치면 다른 구간 행이 잡힌다.
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 68, box.y + box.height / 2 + 8, { steps: 4 });
    await expect(first).toHaveClass(/opacity-40/);
    await expect(second).not.toHaveClass(/opacity-40/);
    await moveOver(page, `epic-filter-${EPIC_A.number}`);
    await page.mouse.up();
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: EPIC_A.number }]);
  });

  test('목록: A 소속 → 에픽 미할당 = 해제', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행', parent: parentOf(EPIC_A) })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await dragTo(page, 'issue-row-1', 'epic-filter-unassigned');
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: null }]);
    await expect(page.getByText('에픽 연결을 해제했습니다')).toBeVisible();
    await expect(page.getByTestId('issue-row-1')).not.toContainText(EPIC_A.title);
  });

  test('SUBTASK 드래그: 사유 배너, 놓아도 PATCH 없음', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, {
      issues: [createIssue({ id: 2, number: 2, title: '하위', type: makeSubtaskType(), parent: { number: 1, title: '부모', type: makeSubtaskType() } })],
      panelOpen: true,
    });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await startDrag(page, 'issue-row-2');
    await expect(page.getByTestId('epic-drop-blocked-reason')).toHaveText('하위 작업은 에픽에 직접 연결할 수 없습니다 — 부모 이슈를 옮겨 주세요');
    await expect(page.getByTestId(`epic-filter-${EPIC_A.number}`)).toHaveAttribute('data-drop-state', 'blocked');
    await moveOver(page, `epic-filter-${EPIC_A.number}`);
    await page.mouse.up();
    await expectStays(page, patches, []);
  });

  test('EPIC 드래그: 사유 배너, PATCH 없음', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [epic({ number: 12, title: '다른 에픽' })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await startDrag(page, 'issue-row-12');
    await expect(page.getByTestId('epic-drop-blocked-reason')).toHaveText('에픽은 다른 에픽에 넣을 수 없습니다');
    await moveOver(page, `epic-filter-${EPIC_A.number}`);
    await page.mouse.up();
    await expectStays(page, patches, []);
  });

  test('비멤버: 드래그 안 됨', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행' })], member: false, panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await startDrag(page, 'issue-row-1');
    await moveOver(page, `epic-filter-${EPIC_A.number}`);
    // 드래그가 아예 시작되지 않아야 한다 — 고스트·흐림·안내 배너 모두 없음(놓기 전에 확인).
    await expect(page.getByTestId('issue-row-drag-overlay')).not.toBeAttached();
    await expect(page.getByTestId('issue-row-1')).not.toHaveClass(/opacity-40/);
    await expect(page.getByTestId('epic-drop-hint')).not.toBeAttached();
    await page.mouse.up();
    await expectStays(page, patches, []);
  });

  for (const status of [403, 500]) {
    test(`PATCH ${status} → 칩 원복 + 오류 토스트`, async ({ authenticatedPage: page }) => {
      const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행', parent: parentOf(EPIC_A) })], patchStatus: status, panelOpen: true });
      // PATCH 이후의 목록 재조회(onSettled)를 붙잡아 둔다 — 칩 원복이 재조회가 아니라 낙관적 롤백으로만 일어나는지 검증.
      // (나중에 등록한 route 가 우선한다)
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let held = 0;
      await page.route(
        (url) => url.pathname === ISSUES_PATH,
        async (route) => {
          if (route.request().method() !== 'GET' || patches().length === 0) return route.fallback();
          held++;
          await gate;
          try {
            await route.fallback();
          } catch {
            // 테스트 종료 후 풀린 요청 — 페이지가 닫혀 있으면 무시.
          }
        },
      );
      await page.goto(`/projects/${PROJECT_KEY}?view=list`);
      await dragTo(page, 'issue-row-1', `epic-filter-${EPIC_B.number}`);
      await expect(page.getByText(status === 403 ? '프로젝트 멤버가 아닙니다' : /서버 오류|에픽 변경에 실패했습니다/)).toBeVisible();
      // 재조회가 실제로 붙잡혀 있는 상태에서 단언해야 의미가 있다.
      await expect.poll(() => held).toBeGreaterThan(0);
      await expect(page.getByTestId('issue-row-1')).toContainText(EPIC_A.title);
      await expect(page.getByTestId('issue-row-1')).not.toContainText(EPIC_B.title);
      release();
    });
  }

  // FIXME: 우상단 sonner 토스트(z-40)가 PageHeader(z-[45]) 아래에 깔려 「되돌리기」 버튼 클릭을 헤더가 가로챈다
  // (기존 전역 토스터 레이어링 문제 — 이 작업 범위 밖이라 토스터는 건드리지 않음). 레이어링을 고치면 fixme 를 푼다.
  // 증거 스크린샷: test-results/exploratory/epic-dnd/undo-toast-covered.png
  test.fixme('되돌리기 → 이전 부모로 두 번째 PATCH', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행', parent: parentOf(EPIC_A) })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await dragTo(page, 'issue-row-1', `epic-filter-${EPIC_B.number}`);
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect.poll(patches).toEqual([
      { number: 1, parentNumber: EPIC_B.number },
      { number: 1, parentNumber: EPIC_A.number },
    ]);
    await expect(page.getByText('되돌렸습니다')).toBeVisible();
    await expect(page.getByTestId('issue-row-1')).toContainText(EPIC_A.title);
  });

  // FIXME: 위 되돌리기 테스트와 같은 사유(토스트가 PageHeader 아래에 깔림). 레이어링을 고치면 fixme 를 푼다.
  // 첫 토스트의 되돌리기는 이후 다시 옮겨진 이슈(미소속→A→B)를 옛 부모로 덮으면 안 된다 — PATCH 없이 안내만.
  test.fixme('오래된 되돌리기: 이후 다시 옮겨졌으면 PATCH 없이 안내, 칩 유지', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행' })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await dragTo(page, 'issue-row-1', `epic-filter-${EPIC_A.number}`);
    await expect(page.getByText(`「${EPIC_A.title}」에 연결했습니다`)).toBeVisible();
    await dragTo(page, 'issue-row-1', `epic-filter-${EPIC_B.number}`);
    await expect(page.getByText(`「${EPIC_B.title}」에 연결했습니다`)).toBeVisible();
    // sonner 는 최신 토스트가 앞이라 첫 토스트는 뒤쪽 — 문구로 그 토스트의 버튼을 특정한다.
    await page.locator('[data-sonner-toast]', { hasText: `「${EPIC_A.title}」에 연결했습니다` }).getByRole('button', { name: '되돌리기' }).click();
    await expect(page.getByText('이후에 다시 옮겨져 되돌릴 수 없습니다')).toBeVisible();
    expect(patches()).toEqual([
      { number: 1, parentNumber: EPIC_A.number },
      { number: 1, parentNumber: EPIC_B.number },
    ]);
    await expect(page.getByTestId('issue-row-1')).toContainText(EPIC_B.title);
  });

  test('키보드: 행 포커스 → Space → ↓ 로 에픽 B 선택 → Space, 제목 링크 Enter 는 상세 이동', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행' })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await page.getByTestId('issue-row-1').focus();
    await page.keyboard.press('Space');
    // 가장 가까운 대상이 아닌 B 를 명시적으로 골라야 한다 — 방향키가 실제로 대상 사이를 옮기는지 검증.
    const b = page.getByTestId(`epic-filter-${EPIC_B.number}`);
    for (let i = 0; i < 5 && (await b.getAttribute('data-drop-state')) !== 'over'; i++) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(b).toHaveAttribute('data-drop-state', 'over');
    await page.keyboard.press('Space');
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: EPIC_B.number }]);
    // 드롭 후 행에 에픽 칩(링크)도 생기므로 제목 링크를 이름으로 특정한다.
    await page.getByTestId('issue-row-1').getByRole('link', { name: '행', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projects\/WP\/issues\/1$/);
  });

  test('짧은 클릭은 상세 이동, 체크박스는 선택, 드래그 후 원위치 놓기는 이동 안 함', async ({ authenticatedPage: page }) => {
    await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행' })], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await page.getByTestId('select-issue-1').click();
    await expect(page.getByTestId('select-issue-1')).toBeChecked();
    const box = (await page.getByTestId('issue-row-1').boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 5 });
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    // 원위치 놓기는 상세로 이동하지 않는다(목록에 머묾).
    await expectStays(page, () => /view=list/.test(page.url()), true);
    await page.getByTestId('issue-row-1').click({ position: { x: 60, y: box.height / 2 } });
    await expect(page).toHaveURL(/\/projects\/WP\/issues\/1$/);
  });
  // ── 최종 리뷰 후속 ─────────────────────────────────────────────────────────
  const manyEpics = Array.from({ length: 25 }, (_, i) => ({ number: 100 + i, title: `에픽 ${i + 1}` }));

  // dnd-kit droppable 사각형은 스크롤 컨테이너 잘림을 모른다 — 목록을 스크롤하면 위로 가려진 에픽 사각형이
  // 「전체 이슈」 자리에 겹친다. 거기 놓아도 보이지 않는 에픽으로 PATCH 되면 안 된다.
  test('긴 에픽 목록을 스크롤한 뒤 「전체 이슈」에 놓으면 PATCH 없음(가려진 에픽이 잡히지 않음)', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행' })], epics: manyEpics });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await startDrag(page, 'issue-row-1');
    // 떠 있는 패널(고정 높이)의 에픽 목록을 끝까지 스크롤.
    const list = page.getByTestId('epic-panel-list');
    await expect(page.getByTestId(`epic-filter-${manyEpics[24].number}`)).toBeAttached();
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const all = (await page.getByTestId('epic-filter-all').boundingBox())!;
    const p = { x: all.x + all.width / 2, y: all.y + all.height / 2 };
    // 전제: 드롭 지점 아래에 (가려진) 에픽 사각형이 실제로 겹쳐 있어야 이 테스트가 의미가 있다.
    let overlapped = false;
    for (const e of manyEpics) {
      const b = await page.getByTestId(`epic-filter-${e.number}`).boundingBox();
      if (b && b.x <= p.x && p.x <= b.x + b.width && b.y <= p.y && p.y <= b.y + b.height) overlapped = true;
    }
    expect(overlapped, '「전체 이슈」 아래에 스크롤로 가려진 에픽 사각형이 겹쳐야 한다').toBe(true);
    await page.mouse.move(p.x, p.y, { steps: 10 });
    await page.mouse.up();
    await expectStays(page, patches, []);
  });

  // 떠 있는 패널(고정 높이)이라 에픽 목록이 내부 스크롤된다 — 도킹 패널은 목록 높이가 제한되지 않아 페이지가 스크롤되고,
  // 그 페이지 스크롤은 KeyboardSensor 가 직접 처리한다.
  // 뷰포트 900 — 페이지 자체는 스크롤되지 않고 에픽 목록만 넘친다(떠 있는 패널은 고정 높이라 목록이 내부 스크롤).
  // KeyboardSensor 는 over 노드의 스크롤 조상만 굴린다 — over 가 아직 목록 밖일 때 가려진 에픽으로 들어서면 직접 드러내야 한다.
  test('키보드(떠 있는 패널): 목록 스크롤로 가려진 에픽으로 옮기면 드러나고, 끝 에픽까지 옮겨 PATCH', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '행' })], epics: manyEpics });
    await page.goto(`/projects/${PROJECT_KEY}?view=list`);
    await page.getByTestId('issue-row-1').focus();
    await page.keyboard.press('Space');
    const list = page.getByTestId('epic-panel-list');
    const first = page.getByTestId(`epic-filter-${manyEpics[0].number}`);
    const last = page.getByTestId(`epic-filter-${manyEpics[24].number}`);
    await expect(last).toBeAttached();
    // 드래그 중 목록을 끝까지 스크롤(휠 등) — 앞쪽 에픽(현재 over 포함)은 위로 가려진다.
    await expect(page.locator('[data-drop-state="over"]')).toHaveCount(1);
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(first).not.toBeInViewport();
    // 다음 대상은 목록 위쪽에 가려진 에픽 — 센서는 ↓ 방향으로만 굴려 드러내지 못하므로 직접 드러내야 한다.
    await page.keyboard.press('ArrowDown');
    const over = page.locator('[data-epic-panel] [data-drop-state="over"]');
    await expect(over).toHaveCount(1);
    // IntersectionObserver 기반이라 조상 overflow 잘림을 반영 — 목록 안에서 실제로 보여야 통과.
    await expect(over).toBeInViewport();
    // 끝 에픽까지 — 목록 안에서는 센서가 부드럽게(smooth) 굴리므로 스크롤이 멈춘 뒤 다음 키를 누른다.
    const settled = async () => {
      let prev = -1;
      await expect
        .poll(async () => {
          const cur = await list.evaluate((el) => el.scrollTop);
          const same = cur === prev;
          prev = cur;
          return same;
        }, { intervals: [100] })
        .toBe(true);
    };
    for (let i = 0; i < 40 && (await last.getAttribute('data-drop-state')) !== 'over'; i++) {
      await page.keyboard.press('ArrowDown');
      await settled();
    }
    await expect(last).toHaveAttribute('data-drop-state', 'over');
    await expect(last).toBeInViewport();
    // 스크린리더 안내 — 원시 id(epic-124) 가 아니라 이슈 키·에픽 제목으로 읽는다.
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText(`WP-1 이슈가 에픽 「${manyEpics[24].title}」 위에 있습니다.`);
    await page.keyboard.press('Space');
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: manyEpics[24].number }]);
  });

  // 떠 있는 패널은 스크롤 조상이 에픽 목록뿐 — 포인터가 에픽 위에 있다고 자동 스크롤을 막으면 가려진 에픽에 닿을 수 없다.
  test('떠 있는 패널: 에픽 목록 아래 가장자리 에픽에 머물면 목록이 자동 스크롤된다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })], epics: manyEpics });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await startDrag(page, 'issue-card-1');
    const list = page.getByTestId('epic-panel-list');
    await expect(page.getByTestId(`epic-filter-${manyEpics[24].number}`)).toBeAttached();
    // 드래그 시작 직후 떠 있는 패널이 자리 잡는 중이면 null 일 수 있어 다시 잰다(WP-225).
    const lb = await stableBox(list, 'epic-panel-list');
    const listBottom = lb.y + lb.height;
    // 아래 가장자리 영역(높이 20%) 안이면서 보이는 에픽 항목 위인 점을 고른다.
    let p: { x: number; y: number } | null = null;
    for (const e of manyEpics) {
      const b = (await page.getByTestId(`epic-filter-${e.number}`).boundingBox())!;
      const y = Math.min(b.y + b.height, listBottom) - 3;
      if (b.y < y && y > listBottom - lb.height * 0.2) {
        p = { x: b.x + b.width / 2, y };
        break;
      }
    }
    expect(p, '목록 아래 가장자리에 보이는 에픽 항목이 있어야 한다').not.toBeNull();
    expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
    await page.mouse.move(p!.x, p!.y, { steps: 10 });
    await expect.poll(() => list.evaluate((el) => el.scrollTop), { timeout: 3000 }).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // 다중 담당자 이슈는 담당자 그룹마다 한 번씩 렌더된다 — 드래그 id 가 겹치면 두 사본이 함께 흐려지고 고스트가 다른 사본에서 뜬다.
  const twoAssignees = () =>
    createIssue({
      id: 1,
      number: 1,
      title: '공동 작업',
      status: 'TODO',
      assignees: [
        { id: 1, username: 'alice', name: 'Alice', kind: 'HUMAN' },
        { id: 2, username: 'bob', name: 'Bob', kind: 'HUMAN' },
      ],
    });

  test('목록 담당자 그룹: 여러 그룹에 보이는 행은 잡은 사본만 끌리고 고스트는 포인터 옆', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [twoAssignees()], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=list&group=assignee`);
    const first = page.getByTestId('list-group-u-1').getByTestId('issue-row-1');
    const second = page.getByTestId('list-group-u-2').getByTestId('issue-row-1');
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const box = (await first.boundingBox())!;
    const p = { x: box.x + 60, y: box.y + box.height / 2 };
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 8, p.y + 8, { steps: 4 });
    await expect(first).toHaveClass(/opacity-40/);
    await expect(second).not.toHaveClass(/opacity-40/);
    const ghost = (await page.getByTestId('issue-row-drag-overlay').boundingBox())!;
    expect(Math.abs(ghost.y + ghost.height / 2 - (p.y + 8))).toBeLessThan(40);
    await moveOver(page, `epic-filter-${EPIC_A.number}`);
    await page.mouse.up();
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: EPIC_A.number }]);
  });

  test('보드 담당자 그룹: 여러 컬럼에 보이는 카드는 잡은 사본만 끌리고 고스트는 포인터 옆', async ({ authenticatedPage: page }) => {
    const { patches } = await setup(page, { issues: [twoAssignees()], panelOpen: true });
    await page.goto(`/projects/${PROJECT_KEY}?view=board&group=assignee`);
    const first = page.getByTestId('board-col-u-1').getByTestId('issue-card-1');
    const second = page.getByTestId('board-col-u-2').getByTestId('issue-card-1');
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const box = (await first.boundingBox())!;
    const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 8, p.y + 8, { steps: 4 });
    await expect(first).toHaveCSS('opacity', '0.4');
    await expect(second).toHaveCSS('opacity', '1');
    const ghost = (await page.getByTestId('issue-card-drag-overlay').boundingBox())!;
    expect(Math.abs(ghost.x + ghost.width / 2 - (p.x + 8))).toBeLessThan(40);
    expect(Math.abs(ghost.y + ghost.height / 2 - (p.y + 8))).toBeLessThan(40);
    await moveOver(page, `epic-filter-${EPIC_A.number}`);
    await page.mouse.up();
    await expect.poll(patches).toEqual([{ number: 1, parentNumber: EPIC_A.number }]);
  });

  // 떠 있는 패널이 CANCELED 컬럼을 덮는다 — →가 에픽 항목으로 새면 키보드로 CANCELED 에 못 간다(기존 키보드 상태 변경 회귀).
  test('키보드(패널 닫힘): 카드를 → 로 옮기면 CANCELED 컬럼에 닿고 Space 로 상태 CANCELED, 에픽 PATCH 없음', async ({ authenticatedPage: page }) => {
    // 1440 — 보드가 가로로 넘치지 않으면서(넘치면 KeyboardSensor 가 이동 대신 가로 스크롤만 해 CANCELED 에 못 닿는다 —
    // 패널과 무관한 기존 동작) 떠 있는 패널의 에픽 항목이 CANCELED 컬럼 위에 겹치는 폭.
    await page.setViewportSize({ width: 1440, height: 900 });
    const { patches } = await setup(page, { issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })] });
    const statusPatches = trackStatusPatch(page);
    await page.route('**/issues/1/status', (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '카드', status: 'CANCELED' }) })) });
    });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await page.getByTestId('issue-card-1').focus();
    await page.keyboard.press('Space');
    // 드래그 중 떠 있는 패널이 뜬 뒤에 방향키를 누른다(패널 에픽이 후보에 들어온 상태에서 검증).
    await expect(page.getByTestId('epic-side-panel')).toBeVisible();
    // 전제: 떠 있는 패널이 CANCELED 컬럼과 실제로 겹쳐야 이 테스트가 의미가 있다.
    // 패널이 막 뜬 직후라 배치가 자리 잡을 때까지 다시 재며 단언한다(WP-225).
    await expect(async () => {
      const panelBox = await measureBox(page.getByTestId('epic-side-panel'));
      const canceledBox = await measureBox(page.getByTestId('board-col-CANCELED'));
      expect(panelBox.x).toBeLessThan(canceledBox.x + canceledBox.width);
      expect(panelBox.x + panelBox.width).toBeGreaterThan(canceledBox.x);
    }).toPass();
    const canceled = page.getByTestId('board-col-CANCELED');
    for (let i = 0; i < 10 && !/bg-accent\/30/.test((await canceled.getAttribute('class')) ?? ''); i++) {
      await page.keyboard.press('ArrowRight');
    }
    await expect(canceled).toHaveClass(/bg-accent\/30/);
    await page.keyboard.press('Space');
    await expect.poll(() => statusPatches.lastBody()).toEqual({ status: 'CANCELED' });
    await expectStays(page, patches, []);
  });

  test('드래그 중에는 「종료된 에픽」 구역이 숨겨지고, 놓으면 다시 보이며 펼침 상태가 유지된다 (WP-245)', async ({ authenticatedPage: page }) => {
    await setup(page, {
      issues: [createIssue({ id: 1, number: 1, title: '카드', status: 'TODO' })],
      closedEpics: [createIssue({ id: 12, number: 12, title: '끝난 에픽', type: makeEpicType(), status: 'DONE', childCount: 0, childDoneCount: 0 })],
      panelOpen: true,
    });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    // 섹션 펼치기 — toggle 을 클릭해 펼침 상태로 만든다.
    const toggle = page.getByTestId('epic-closed-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // 종료된 에픽 행이 보인다.
    await expect(page.getByTestId('epic-closed-filter-12')).toBeVisible();
    // 드래그 시작 — 섹션이 숨겨진다(DOM 에서 제거되지 않음, display:none 또는 visibility:hidden).
    await startDrag(page, 'issue-card-1');
    await expect(page.getByTestId('epic-closed-section')).not.toBeVisible();
    // 드래그 종료 — 섹션이 다시 보이고, 펼침 상태가 유지된다.
    await page.mouse.up();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('epic-closed-filter-12')).toBeVisible();
  });
});
