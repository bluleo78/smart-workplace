// 이슈 목록 사이클 구간 드래그 앤 드롭 E2E (#881) — 행을 다른 구간(진행 중·예정 사이클 / 백로그)으로 끌어 사이클 할당·해제.
// 규칙: 구간 A→B = A 해제 + B 추가(그 외 사이클 유지), 백로그로 = 출발 사이클만 해제, 백로그에서 = 대상 추가.
// 서버 이동 규칙을 흉내 내는 목(POST .../cycles/move)이 구간별 이슈 목록을 갱신해, settle 재조회도 이동 결과를 돌려준다.
import type { Locator, Page } from '@playwright/test';

import type { CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;

function cycle(overrides: Partial<CycleResponse>): CycleResponse {
  return {
    id: 1,
    projectId: 1,
    name: '스프린트',
    goal: null,
    startDate: null,
    endDate: null,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

// 진행 중 2 · 예정 1 · 완료 1.
const CYCLES: CycleResponse[] = [
  cycle({ id: 1, name: '스프린트 12', status: 'ACTIVE', startDate: '2026-09-21', endDate: '2026-10-03' }),
  cycle({ id: 2, name: '핫픽스 주간', status: 'ACTIVE', startDate: '2026-09-22', endDate: '2026-10-05' }),
  cycle({ id: 3, name: '스프린트 13', status: 'PLANNED', startDate: '2026-10-06', endDate: '2026-10-17' }),
  cycle({ id: 5, name: '스프린트 11', status: 'COMPLETED', startDate: '2026-09-01', endDate: '2026-09-14' }),
];

type MoveBody = { fromCycleId: number | null; toCycleId: number | null };

interface SetupOptions {
  member?: boolean;
  failMove?: boolean;
}

/**
 * 공통 목 — 이슈의 사이클 집합(membership)을 서버 상태로 두고, 구간 검색은 그 집합으로 계산한다.
 * 백로그(cycle=null) = 진행 중·예정 사이클에 연결되지 않은 이슈(완료 사이클에만 남은 이슈 포함).
 * #11 은 스프린트 12·핫픽스 주간 두 사이클에 모두 속한다(M:N).
 */
async function setup(page: Page, { member = true, failMove = false }: SetupOptions = {}) {
  await page.clock.setFixedTime(new Date(2026, 8, 30, 10, 0));
  const issues = new Map<number, IssueResponse>([
    [11, createIssue({ id: 11, number: 11, title: '결제 모듈 리팩터링' })],
    [12, createIssue({ id: 12, number: 12, title: '결제 실패 알림' })],
    [21, createIssue({ id: 21, number: 21, title: '로그인 오류 수정' })],
    [41, createIssue({ id: 41, number: 41, title: '백로그 작업' })],
    [51, createIssue({ id: 51, number: 51, title: '지난 스프린트 작업' })],
  ]);
  const membership = new Map<number, Set<number>>([
    [11, new Set([1, 2])],
    [12, new Set([1])],
    [21, new Set([2])],
    [41, new Set()],
    [51, new Set([5])],
  ]);
  const openCycleIds = new Set(CYCLES.filter((c) => c.status !== 'COMPLETED').map((c) => c.id));
  const moves: MoveBody[] = [];

  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject({ viewerIsMember: member })),
    }),
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([createMember({ userId: 10, name: '김개발', username: 'kim' })]),
    }),
  );
  for (const p of ['labels', 'types']) {
    await page.route(`**/api/v1/projects/${KEY}/${p}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CYCLES) });
  });
  await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const cycleParam = new URL(route.request().url()).searchParams.get('cycle');
      const items = [...issues.values()].filter((it) => {
        const cs = membership.get(it.number)!;
        if (cycleParam === 'null') return ![...cs].some((id) => openCycleIds.has(id));
        return cycleParam != null && cs.has(Number(cycleParam));
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(items, null)),
      });
    },
  );
  // 서버 이동 규칙 모사 — from 연결이 있으면 끊고, to 에 없으면 붙인다. 실제 적용 차분을 돌려준다.
  await page.route(
    (url) => /^\/api\/v1\/projects\/WP\/issues\/\d+\/cycles\/move$/.test(url.pathname),
    (route) => {
      const body = route.request().postDataJSON() as MoveBody;
      moves.push(body);
      if (failMove) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '서버 오류' }) });
      }
      const number = Number(route.request().url().match(/issues\/(\d+)\/cycles/)![1]);
      const cs = membership.get(number)!;
      const removedFrom = body.fromCycleId != null && cs.delete(body.fromCycleId);
      const addedTo = body.toCycleId != null && !cs.has(body.toCycleId);
      if (addedTo) cs.add(body.toCycleId!);
      const cycles = CYCLES.filter((c) => cs.has(c.id)).map(({ id, name, status }) => ({ id, name, status }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cycles, removedFrom, addedTo }),
      });
    },
  );
  return { moves, membership };
}

const section = (page: Page, key: string) => page.getByTestId(`list-cycle-section-${key}`);
const row = (page: Page, key: string, n: number) => section(page, key).getByTestId(`issue-row-${n}`);

// 행을 대상 구간 헤더로 드래그 — PointerSensor distance:5 를 넘기도록 조금 움직인 뒤 헤더 중앙으로. beforeDrop 에서 드래그 중 상태를 단언한다.
async function dragRowTo(page: Page, source: Locator, targetKey: string, beforeDrop?: () => Promise<void>) {
  const box = (await source.boundingBox())!;
  const x = box.x + Math.min(120, box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y + 8, { steps: 4 });
  const header = page.getByTestId(`list-cycle-header-${targetKey}`);
  await expect(header).toBeVisible();
  const t = (await header.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 });
  if (beforeDrop) await beforeDrop();
  await page.mouse.up();
}

// 구간 펼치기 — dnd-kit 은 드롭 직후 50ms 동안 click 을 삼키므로, 펼쳐질 때까지 재시도한다(고정 대기 대신 조건 재시도).
async function expand(page: Page, key: string) {
  const toggle = page.getByTestId(`list-cycle-toggle-${key}`);
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
  }).toPass();
}

// 토스트 「되돌리기」 실행 — 한 줄 토스트는 페이지 헤더(z-45) 아래 층(토스터 z-40, #715)에 겹쳐 포인터 클릭이 막힐 수 있다.
// 이 스펙은 되돌리기 로직(역차분 요청)을 검증하므로 버튼에 click 이벤트를 직접 보낸다(가림 문제는 이 작업 범위 밖).
// 목 응답이 즉시 와서 토스트가 드롭 직후 50ms(dnd-kit click 삼킴) 안에 뜰 수 있어, 요청이 나갈 때까지 재시도한다.
async function clickUndo(page: Page, moves: MoveBody[]) {
  const before = moves.length;
  await expect(async () => {
    if (moves.length === before) await page.getByRole('button', { name: '되돌리기' }).dispatchEvent('click');
    await expect.poll(() => moves.length, { timeout: 500 }).toBeGreaterThan(before);
  }).toPass();
}

// 부재 확인 전용 대기 — "놓은 뒤 이동 요청이 없음"은 기다릴 조건이 없어 짧게 흘려보낸 뒤 단언한다(WP-82 예외: 부재 확인).
async function waitForNoRequest(page: Page) {
  await page.waitForTimeout(300);
}

test.describe('이슈 목록 사이클 구간 드래그 (#881)', () => {
  test(
    '진행 중 → 접힌 예정 구간 헤더 — 이동 요청·즉시 반영·되돌리기',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const { moves } = await setup(page);
      await page.goto(`/projects/${KEY}`);
      await expect(row(page, 'cycle-1', 12)).toBeVisible();
      await expect(page.getByTestId('list-cycle-toggle-cycle-3')).toHaveAttribute('aria-expanded', 'false');

      await dragRowTo(page, row(page, 'cycle-1', 12), 'cycle-3', async () => {
        // 드래그 중 — 대상 구간 전체 강조 + 안내, 출발 구간은 반응 없음.
        await expect(section(page, 'cycle-3')).toHaveAttribute('data-drop-target', 'true');
        await expect(page.getByTestId('list-cycle-drop-hint-cycle-3')).toHaveText('여기에 놓아 이동');
        await expect(section(page, 'cycle-1')).not.toHaveAttribute('data-drop-target', 'true');
      });

      await expect.poll(() => moves).toEqual([{ fromCycleId: 1, toCycleId: 3 }]);
      await expect(row(page, 'cycle-1', 12)).toHaveCount(0);
      await expect(page.getByText('WP-12 을(를) 스프린트 13(으)로 옮겼습니다')).toBeVisible();
      await expand(page, 'cycle-3');
      await expect(row(page, 'cycle-3', 12)).toBeVisible();

      // 되돌리기 — 역차분(3 해제 + 1 추가).
      await clickUndo(page, moves);
      await expect.poll(() => moves.at(-1)).toEqual({ fromCycleId: 3, toCycleId: 1 });
      await expect(row(page, 'cycle-1', 12)).toBeVisible();
      await expect(row(page, 'cycle-3', 12)).toHaveCount(0);
    },
  );

  test('두 사이클 공유 이슈 — 되돌리기는 뒤집기가 아닌 역차분(떼어낸 출발 사이클만 재연결)', async ({ authenticatedPage: page }) => {
    const { moves, membership } = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(row(page, 'cycle-2', 11)).toBeVisible();

    // 스프린트 12 → 핫픽스 주간(이미 연결) — 결과는 {핫픽스 주간}.
    await dragRowTo(page, row(page, 'cycle-1', 11), 'cycle-2');
    await expect.poll(() => moves).toEqual([{ fromCycleId: 1, toCycleId: 2 }]);
    await expect(row(page, 'cycle-1', 11)).toHaveCount(0);
    await expect(row(page, 'cycle-2', 11)).toBeVisible();

    // 되돌리기 — 2 는 원래 연결이라 떼지 않고 1 만 다시 붙인다.
    await clickUndo(page, moves);
    await expect.poll(() => moves.at(-1)).toEqual({ fromCycleId: null, toCycleId: 1 });
    await expect(row(page, 'cycle-1', 11)).toBeVisible();
    await expect(row(page, 'cycle-2', 11)).toBeVisible();
    expect([...membership.get(11)!].sort()).toEqual([1, 2]);
  });

  test('백로그 → 사이클, 사이클 → 백로그', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(row(page, 'backlog', 41)).toBeVisible();

    await dragRowTo(page, row(page, 'backlog', 41), 'cycle-1');
    await expect.poll(() => moves).toEqual([{ fromCycleId: null, toCycleId: 1 }]);
    await expect(row(page, 'cycle-1', 41)).toBeVisible();
    await expect(row(page, 'backlog', 41)).toHaveCount(0);

    await dragRowTo(page, row(page, 'cycle-1', 12), 'backlog');
    await expect.poll(() => moves.at(-1)).toEqual({ fromCycleId: 1, toCycleId: null });
    await expect(row(page, 'backlog', 12)).toBeVisible();
    await expect(row(page, 'cycle-1', 12)).toHaveCount(0);
  });

  test('다른 진행 중 사이클에도 속한 이슈를 백로그로 — 출발 사이클만 빠지고 백로그엔 안 보인다는 안내', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(row(page, 'cycle-1', 11)).toBeVisible();

    await dragRowTo(page, row(page, 'cycle-1', 11), 'backlog');
    await expect.poll(() => moves).toEqual([{ fromCycleId: 1, toCycleId: null }]);
    await expect(
      page.getByText('WP-11 을(를) 스프린트 12에서 뺐습니다 (다른 진행 중·예정 사이클에 남아 있어 백로그에는 표시되지 않습니다)'),
    ).toBeVisible();
    await expect(row(page, 'cycle-1', 11)).toHaveCount(0);
    await expect(row(page, 'cycle-2', 11)).toBeVisible();
    await expect(row(page, 'backlog', 11)).toHaveCount(0);
  });

  test('같은 구간에 놓으면 요청 없음', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(row(page, 'cycle-1', 12)).toBeVisible();

    await dragRowTo(page, row(page, 'cycle-1', 12), 'cycle-1');
    await waitForNoRequest(page);
    expect(moves).toEqual([]);
    await expect(row(page, 'cycle-1', 12)).toBeVisible();
  });

  test('사이클 필터로 보이는 완료 구간에는 놓을 수 없다 — 드래그 중 차단 표시', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page);
    await page.goto(`/projects/${KEY}?cycle=1,5`);
    await expect(row(page, 'cycle-1', 12)).toBeVisible();
    await expect(section(page, 'cycle-5')).toBeVisible();

    await dragRowTo(page, row(page, 'cycle-1', 12), 'cycle-5', async () => {
      await expect(section(page, 'cycle-5')).toHaveAttribute('data-drop-blocked', 'true');
      await expect(page.getByTestId('list-cycle-drop-blocked-cycle-5')).toHaveText('완료된 사이클에는 놓을 수 없음');
      await expect(section(page, 'cycle-5')).not.toHaveAttribute('data-drop-target', 'true');
    });
    await waitForNoRequest(page);
    expect(moves).toEqual([]);
    await expect(section(page, 'cycle-5')).not.toHaveAttribute('data-drop-blocked', 'true');

    // 완료 구간의 행은 사이클 이동에서 빠진다 — 다른 구간 위로 끌어도 반응·요청 없음(끝난 스프린트 이력 보호).
    await expand(page, 'cycle-5');
    await expect(row(page, 'cycle-5', 51)).toBeVisible();
    await dragRowTo(page, row(page, 'cycle-5', 51), 'cycle-1', async () => {
      await expect(section(page, 'cycle-1')).not.toHaveAttribute('data-drop-target', 'true');
      await expect(section(page, 'cycle-5')).not.toHaveAttribute('data-drop-blocked', 'true');
    });
    await waitForNoRequest(page);
    expect(moves).toEqual([]);
    await expect(row(page, 'cycle-5', 51)).toBeVisible();
  });

  test('이동 실패 시 원위치 복원 + 에러 토스트', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page, { failMove: true });
    await page.goto(`/projects/${KEY}`);
    await expect(row(page, 'cycle-1', 12)).toBeVisible();

    await dragRowTo(page, row(page, 'cycle-1', 12), 'cycle-2');
    await expect.poll(() => moves.length).toBe(1);
    await expect(page.getByText('서버 오류')).toBeVisible();
    await expect(row(page, 'cycle-1', 12)).toBeVisible();
    await expect(row(page, 'cycle-2', 12)).toHaveCount(0);
  });

  test('비멤버는 드래그할 수 없다', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page, { member: false });
    await page.goto(`/projects/${KEY}`);
    const r = row(page, 'cycle-1', 12);
    await expect(r).toBeVisible();
    await expect(r).not.toHaveAttribute('aria-roledescription', '드래그 가능한 이슈');

    await dragRowTo(page, r, 'cycle-2');
    await waitForNoRequest(page);
    expect(moves).toEqual([]);
    await expect(page.getByTestId('issue-row-drag-overlay')).toHaveCount(0);
  });

  test('키보드 — Space 로 집고 방향키로 사이클 구간을 골라 Space 로 놓기, 제목 링크 Enter 는 상세 이동', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page);
    await page.goto(`/projects/${KEY}`);
    const r = row(page, 'cycle-1', 12);
    await expect(r).toBeVisible();

    await r.focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('issue-row-drag-overlay')).toBeVisible();
    // 대상(백로그)에 닿을 때까지 아래로 — 에픽 항목·구간 수에 따라 필요한 횟수가 달라 조건으로 멈춘다.
    for (let i = 0; i < 20; i++) {
      if ((await section(page, 'backlog').getAttribute('data-drop-target')) === 'true') break;
      await page.keyboard.press('ArrowDown');
    }
    await expect(section(page, 'backlog')).toHaveAttribute('data-drop-target', 'true');
    await page.keyboard.press('Space');
    await expect.poll(() => moves).toEqual([{ fromCycleId: 1, toCycleId: null }]);

    // 행 안 제목 링크의 Enter 는 드래그가 아니라 상세 이동.
    await row(page, 'cycle-2', 21).getByRole('link').first().focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/21$`));
    expect(moves).toHaveLength(1);
  });
});
