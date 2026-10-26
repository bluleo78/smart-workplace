// 데스크톱 보드 — 프로젝트 상태 목록 컬럼·statusId DnD·범주 띠 ＋·헤더 ⋯ (WP-808).
// 백엔드 없이 page.route 로 모킹 — 상태 목록은 POST·PATCH 를 반영하는 상태 있는 목으로 둔다(추가·이름 변경 뒤 재조회).
// 브라우저가 있어야 판정되는 것만 남긴다 — 컬럼 배선(@wiring)·띠 폭/＋ 위치·편집 중 헤더 높이(@layout)·포커스 복원·IME·카드 끌기(@input)·
// 설정 상태 섹션으로 넘어가기(@flow). 상태 색 클래스·＋/⋯ 추가 payload·상태 필터 조회·상태 목록 오류와 다시 시도·20개 상한·
// 409/30자 오류·컬럼에서 이슈 추가 중 상태 삭제(WP-936)·역할/개인 프로젝트별 진입점·「완료 모두 보기」는
// 페이지 테스트 src/pages/projects/boardCustomStatus.test.tsx 가 지킨다(WP-971).

import type { Page } from '@playwright/test';

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { inServerOrder, makeProjectStatus, statusFieldsOf, withCustomStatuses } from '../../factories/projectStatus.factory';
import { mockApi } from '../../fixtures/api-mock';
import { mockProjectSettings } from '../../fixtures/project-settings-mocks';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { pressMacChromeImeEnter } from '../../fixtures/ime';
import { dropDnd, expectStays } from '../../fixtures/wait';
import type { IssueResponse } from '../../../src/types/issue';
import type { ProjectStatus } from '../../../src/types/projectStatus';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;
const STATUSES_PATH = `/api/v1/projects/${KEY}/statuses`;

// 8개 상태 — 할 일(1) · 진행 중(2)·설계(11)·리뷰 대기(12)·배포 대기(13) · 완료(3)·배포 완료(14) · 취소(4).
function boardStatuses(): ProjectStatus[] {
  return [
    ...withCustomStatuses('설계', '리뷰 대기', '배포 대기'),
    makeProjectStatus({ id: 14, name: '배포 완료', category: 'DONE', position: 7 }),
  ];
}

// 프로젝트·멤버·상태·이슈 검색 목. 상태 목록은 POST(추가)·PATCH(이름 변경)를 반영해 다음 GET 에 돌려준다.
async function stubBoard(
  page: Page,
  {
    role = 'OWNER',
    type = 'TEAM',
    issues = [] as IssueResponse[],
  }: { role?: 'OWNER' | 'MEMBER'; type?: 'TEAM' | 'PERSONAL'; issues?: IssueResponse[] } = {},
) {
  const statuses = boardStatuses();
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject({ type }));
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, [createMember({ userId: 1, role })]);
  await page.route(`**${STATUSES_PATH}`, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: inServerOrder(statuses) });
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { name: string; category: ProjectStatus['category']; afterStatusId?: number };
      const created = makeProjectStatus({ id: 20 + statuses.length, name: body.name, category: body.category, position: 50 });
      statuses.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    return route.fallback();
  });
  await page.route(`**${STATUSES_PATH}/*`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const id = Number(new URL(route.request().url()).pathname.split('/').pop());
    const s = statuses.find((x) => x.id === id)!;
    s.name = (route.request().postDataJSON() as { name: string }).name;
    return route.fulfill({ json: s });
  });
  // 이슈 검색 — 컬럼 쿼리는 statusId 하나로 좁혀 온다. 서버처럼 그 상태 이슈만 돌려준다.
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const ids = (new URL(route.request().url()).searchParams.get('statusId') ?? '').split(',').filter(Boolean).map(Number);
      const items = issues.filter((i) => ids.length === 0 || ids.includes(i.statusId));
      return route.fulfill({ json: createIssueSearchResponse(items) });
    },
  );
  return statuses;
}

// 카드를 컬럼 중앙으로 끈다 — PointerSensor distance:5 를 넘기도록 down → move(0,0) → move(target).
async function dragCardTo(page: Page, cardTestId: string, columnTestId: string) {
  await page.getByTestId(cardTestId).hover();
  await page.mouse.down();
  await page.mouse.move(0, 0);
  const box = await page.getByTestId(columnTestId).boundingBox();
  if (!box) throw new Error(`${columnTestId} bounding box 없음`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await dropDnd(page);
}

test.describe('보드 — 프로젝트 상태 컬럼(WP-808)', () => {
  test('상태 목록대로 컬럼을 그리고 컬럼마다 statusId 로 조회한다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
    const searches = trackRequests(page, 'GET', ISSUES_PATH);
    await stubBoard(page, { issues: [createIssue({ id: 1, number: 1, title: '리뷰할 것', statusId: 12, statusName: '리뷰 대기', status: 'IN_PROGRESS' })] });
    await page.goto(`/projects/${KEY}?view=board`);

    // 컬럼은 상태 표시 순서 그대로 — 범주 순서 → position.
    const order = [1, 2, 11, 12, 13, 3, 14, 4];
    await expect(page.locator('[data-testid^="board-col-"][data-status-id]')).toHaveCount(order.length);
    const ids = await page.locator('[data-testid^="board-col-"][data-status-id]').evaluateAll((els) =>
      els.map((e) => Number(e.getAttribute('data-status-id'))),
    );
    expect(ids).toEqual(order);
    await expect(page.getByTestId('board-col-12')).toContainText('리뷰 대기');
    await expect(page.getByTestId('board-col-12').getByTestId('issue-card-1')).toBeVisible();

    // 컬럼마다 statusId 한 개로 조회한다.
    await expect.poll(() => new Set(searches.urls().map((u) => u.searchParams.get('statusId'))).size).toBe(order.length);
    expect([...new Set(searches.urls().map((u) => Number(u.searchParams.get('statusId'))))].sort((a, b) => a - b)).toEqual(
      [...order].sort((a, b) => a - b),
    );
    // 범주 띠 — 진행 중 범주는 컬럼 4개에 걸친다(폭이 할 일 띠의 약 4배).
    const todo = (await page.getByTestId('board-band-TODO').boundingBox())!;
    const prog = (await page.getByTestId('board-band-IN_PROGRESS').boundingBox())!;
    expect(prog.width / todo.width).toBeGreaterThan(3.5);
  });

  test('띠가 화면보다 넓어도 그 범주의 ＋ 는 보이는 오른쪽 끝에 붙어 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubBoard(page);
    await page.goto(`/projects/${KEY}?view=board`);

    // 진행 중 띠(4컬럼)는 보드 폭을 넘는다 — 그래도 ＋ 는 화면 안. 상태 목록이 와서 띠가 그려진 뒤에 잰다.
    await expect(page.getByTestId('board-band-IN_PROGRESS')).toBeVisible();
    const scroller = (await page.getByTestId('board-scroll').boundingBox())!;
    const band = (await page.getByTestId('board-band-IN_PROGRESS').boundingBox())!;
    expect(band.x + band.width).toBeGreaterThan(scroller.x + scroller.width);
    await expect(page.getByTestId('board-band-add-IN_PROGRESS')).toBeInViewport();
    const plus = (await page.getByTestId('board-band-add-IN_PROGRESS').boundingBox())!;
    expect(plus.x + plus.width).toBeLessThanOrEqual(scroller.x + scroller.width + 1);
  });

  // WP-809 — 보드에서 상태를 더 고치려면(색·순서·삭제) 설정 「상태」 섹션으로 바로 간다.
  test('헤더 ⋯ 상태 관리… 는 설정 상태 섹션으로 간다', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    // 설정 화면 진입 목(라벨·유형·필드·상태별 이슈 수) — 상태 목록은 stubBoard 목이 그대로 준다.
    await mockProjectSettings(page);
    await page.goto(`/projects/${KEY}?view=board`);

    await page.getByTestId('board-col-menu-12').click();
    await page.getByRole('menuitem', { name: '상태 관리…' }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/settings#statuses$`));
    await expect(page.getByTestId('settings-statuses')).toBeInViewport();
    await expect(page.getByTestId('status-row-12')).toContainText('리뷰 대기');
  });

  test('헤더 ⋯ 이름 변경은 인라인 편집으로 PATCH 하고 포커스가 ⋯ 로 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    const patches = trackRequests(page, 'PATCH', `${STATUSES_PATH}/2`);
    await page.goto(`/projects/${KEY}?view=board`);

    await page.getByTestId('board-col-menu-2').click();
    await page.getByRole('menuitem', { name: '이름 변경' }).click();
    const input = page.getByTestId('board-col-2').getByTestId('status-name-input');
    // 헤더 자리에서 현재 이름으로 시작한다.
    await expect(input).toHaveValue('진행 중');
    await input.fill('작업 중');
    await input.press('Enter');

    await expect.poll(() => patches.lastBody()).toEqual({ name: '작업 중' });
    await expect(page.getByTestId('board-col-2').locator('header')).toContainText('작업 중');
    await expect(page.getByTestId('status-name-input')).toHaveCount(0);
    // Enter 로 끝내면 포커스는 그 컬럼의 ⋯ 로 돌아온다(body 로 떨어지지 않는다).
    await expect(page.getByTestId('board-col-menu-2')).toBeFocused();
  });

  test('키보드로 연 편집기를 Esc 로 닫으면 포커스가 연 버튼(⋯·＋)으로 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    await page.goto(`/projects/${KEY}?view=board`);
    const menu = page.getByTestId('board-col-menu-2');

    // 인라인 이름 변경 → Esc.
    await menu.click();
    await page.getByRole('menuitem', { name: '이름 변경' }).click();
    await expect(page.getByTestId('status-name-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status-name-input')).toHaveCount(0);
    await expect(menu).toBeFocused();

    // 「이 뒤에 상태 추가」 팝오버 → Esc.
    await menu.click();
    await page.getByRole('menuitem', { name: '이 뒤에 상태 추가' }).click();
    await expect(page.getByTestId('status-name-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status-name-input')).toHaveCount(0);
    await expect(menu).toBeFocused();

    // 범주 띠 ＋ 팝오버 → Esc.
    const plus = page.getByTestId('board-band-add-IN_PROGRESS');
    await plus.click();
    await expect(page.getByTestId('status-name-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status-name-input')).toHaveCount(0);
    await expect(plus).toBeFocused();
  });

  test('헤더 이름 편집은 헤더 높이를 바꾸지 않고, 바깥을 누르면 저장 없이 닫힌다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    const patches = trackRequests(page, 'PATCH', `${STATUSES_PATH}/2`);
    await page.goto(`/projects/${KEY}?view=board`);
    const header = page.getByTestId('board-col-2').locator('header');
    const before = (await header.boundingBox())!;

    await page.getByTestId('board-col-menu-2').click();
    await page.getByRole('menuitem', { name: '이름 변경' }).click();
    const input = page.getByTestId('board-col-2').getByTestId('status-name-input');
    await expect(input).toBeFocused();
    await input.fill('바뀔 뻔한 이름');
    expect((await header.boundingBox())!.height).toBeCloseTo(before.height, 0);

    // 보드의 다른 곳(할 일 컬럼 빈 자리)을 누르면 취소.
    await page.getByTestId('board-col-1').click({ position: { x: 20, y: 150 } });
    await expect(page.getByTestId('status-name-input')).toHaveCount(0);
    await expect(header).toContainText('진행 중');
    expect(patches.count()).toBe(0);
  });

  test('한글 조합 중 Enter 는 저장하지 않고, 확정 뒤 Enter 로 저장한다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    const posts = trackRequests(page, 'POST', STATUSES_PATH);
    await page.goto(`/projects/${KEY}?view=board`);

    await page.getByTestId('board-band-add-IN_PROGRESS').click();
    const input = page.getByTestId('status-name-input');
    await input.fill('검토');
    // 조합 Enter(isComposing)·꼬리 Enter 는 글자 확정용 — 설정 추가 폼과 같이 저장으로 보지 않는다(WP-937).
    await pressMacChromeImeEnter(input, '토');
    await expectStays(page, posts.count, 0);
    await expect(input).toHaveValue('검토');
    await input.press('Enter');
    await expect.poll(() => posts.lastBody()).toEqual({ name: '검토', category: 'IN_PROGRESS' });
  });

  // 끄는 동안 오른쪽에 떠오르는 에픽 패널(드롭 대상 아님)이 4번째 컬럼을 가리지 않도록 넓은 화면에서 끈다.
  test.describe('카드 끌어 놓기', { tag: '@input' }, () => {
    test.use({ viewport: { width: 1920, height: 1000 } });

    test('카드를 새 컬럼으로 끌면 statusId 로 PATCH 한다', async ({ authenticatedPage: page }) => {
      const issues = await stubIssuesWithPatch(page);
      const patches = trackRequests(page, 'PATCH', `${ISSUES_PATH}/1/status`);
      await page.goto(`/projects/${KEY}?view=board`);
      await expect(page.getByTestId('board-col-1').getByTestId('issue-card-1')).toBeVisible();

      await dragCardTo(page, 'issue-card-1', 'board-col-12');

      await expect.poll(() => patches.lastBody()).toEqual({ statusId: 12 });
      await expect(page.getByTestId('board-col-12').getByTestId('issue-card-1')).toBeVisible();
      // 서버 반영 뒤 재조회해도 새 컬럼에 남는다.
      await expect.poll(() => issues[0].statusId).toBe(12);
      await expectStays(page, () => page.getByTestId('board-col-12').getByTestId('issue-card-1').count(), 1);
    });

    test('PATCH 응답이 늦어도 카드는 새 컬럼에 바로 있다', async ({ authenticatedPage: page }) => {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      await stubIssuesWithPatch(page, held);
      await page.goto(`/projects/${KEY}?view=board`);
      await expect(page.getByTestId('board-col-1').getByTestId('issue-card-1')).toBeVisible();

      await dragCardTo(page, 'issue-card-1', 'board-col-12');

      // 응답을 붙잡아 둔 동안에도 낙관적 갱신(statusId 패치)으로 이미 새 컬럼에 있다.
      await expect(page.getByTestId('board-col-12').getByTestId('issue-card-1')).toBeVisible();
      await expect(page.getByTestId('board-col-1').getByTestId('issue-card-1')).toHaveCount(0);
      release();
    });

    // 409 STATUS_DELETED: 서버 확인 뒤 삭제가 커밋된 경합. 400 STATUS_NOT_FOUND: 요청 전에 이미 삭제돼 보드의 상태 목록이 낡은 경우.
    // 둘 다 서버 문구를 띄우고 상태 목록을 다시 받아 그 컬럼을 지운다(WP-936).
    for (const gone of [
      { status: 409, code: 'STATUS_DELETED', message: '상태가 방금 삭제됐어요. 다른 상태를 골라 주세요.' },
      { status: 400, code: 'STATUS_NOT_FOUND', message: '상태를 찾을 수 없어요. 다른 상태를 골라 주세요.' },
    ]) {
      test(`옮긴 상태가 없어졌으면(${gone.status} ${gone.code}) 서버 안내를 보이고 상태 목록을 다시 받아 그 컬럼을 지운다`, async ({ authenticatedPage: page }) => {
        const issues = [createIssue({ id: 1, number: 1, title: '옮길 카드', status: 'TODO' })];
        const statuses = await stubBoard(page, { issues });
        // 다른 사람이 「리뷰 대기」(12)를 지운 상황 — PATCH 는 거절되고, 이후 상태 목록에서 빠진다.
        await page.route(`**${ISSUES_PATH}/1/status`, async (route) => {
          if (route.request().method() !== 'PATCH') return route.fallback();
          statuses.splice(statuses.findIndex((s) => s.id === 12), 1);
          return route.fulfill({
            status: gone.status,
            json: { status: gone.status, message: gone.message, errors: { code: gone.code } },
          });
        });
        const statusGets = trackRequests(page, 'GET', STATUSES_PATH);
        await page.goto(`/projects/${KEY}?view=board`);
        await expect(page.getByTestId('board-col-1').getByTestId('issue-card-1')).toBeVisible();
        const before = statusGets.count();

        await dragCardTo(page, 'issue-card-1', 'board-col-12');

        // 토스트는 코드 문자열이 아니라 서버 문구 그대로다.
        await expect(page.getByText(gone.message)).toBeVisible();
        await statusGets.waitFor(before + 1);
        await expect(page.getByTestId('board-col-12')).toHaveCount(0);
        // 카드는 원래 컬럼으로 돌아온다(낙관적 갱신 복원).
        await expect(page.getByTestId('board-col-1').getByTestId('issue-card-1')).toBeVisible();
      });
    }
  });
});

// 카드 1장(할 일) + 상태 PATCH 목 — 본문 statusId 를 서버처럼 이슈에 반영한다. held 가 있으면 그동안 응답을 붙잡는다.
async function stubIssuesWithPatch(page: Page, held?: Promise<void>) {
  const issues = [createIssue({ id: 1, number: 1, title: '옮길 카드', status: 'TODO' })];
  const statuses = await stubBoard(page, { issues });
  await page.route(`**${ISSUES_PATH}/1/status`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    if (held) await held;
    const { statusId } = route.request().postDataJSON() as { statusId: number };
    const target = statuses.find((s) => s.id === statusId)!;
    Object.assign(issues[0], statusFieldsOf(statusId), { status: target.category, statusName: target.name });
    return route.fulfill({ json: createIssueDetail({ summary: issues[0], body: null, comments: [], history: [] }) });
  });
  return issues;
}
