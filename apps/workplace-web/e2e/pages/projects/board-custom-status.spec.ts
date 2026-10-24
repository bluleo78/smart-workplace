// 데스크톱 보드 — 프로젝트 상태 목록 컬럼·statusId DnD·범주 띠 ＋·헤더 ⋯ (WP-808).
// 백엔드 없이 page.route 로 모킹 — 상태 목록은 POST·PATCH 를 반영하는 상태 있는 목으로 둔다(추가·이름 변경 뒤 재조회).

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
  test('상태 목록대로 컬럼을 그리고 컬럼마다 statusId 로 조회한다', async ({ authenticatedPage: page }) => {
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

  test('상태 색이 컬럼 헤더 아이콘에 반영된다', async ({ authenticatedPage: page }) => {
    // 「리뷰 대기」만 PURPLE — 나머지는 범주 기본 색이라 지금까지의 범주 시맨틱 색을 그대로 쓴다(WP-809).
    const statuses = await stubBoard(page);
    statuses.find((s) => s.id === 12)!.color = 'PURPLE';
    await page.goto(`/projects/${KEY}?view=board`);

    // 헤더 아이콘 = 상태 이름 칸 바로 앞 svg(장식). 컬럼 안 카드 아이콘과 섞이지 않게 이름 span 의 형제로 좁힌다.
    const headerIcon = (id: number, name: string) =>
      page.getByTestId(`board-col-${id}`).locator(`span:has(> span[title="${name}"]) > svg`);
    await expect(headerIcon(12, '리뷰 대기')).toHaveClass(/text-purple-700/);
    await expect(headerIcon(12, '리뷰 대기')).toHaveClass(/dark:text-purple-300/);
    // 기본 색(BLUE) 진행 중 상태는 범주 색(text-primary) 그대로.
    await expect(headerIcon(11, '설계')).toHaveClass(/text-primary/);
    await expect(headerIcon(11, '설계')).not.toHaveClass(/text-blue-700/);
  });

  test('범주 띠 ＋ 로 진행 중 맨 뒤에 상태를 추가한다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    const posts = trackRequests(page, 'POST', STATUSES_PATH);
    const searches = trackRequests(page, 'GET', ISSUES_PATH);
    await page.goto(`/projects/${KEY}?view=board`);

    await page.getByTestId('board-band-add-IN_PROGRESS').click();
    await page.getByTestId('status-name-input').fill('QA 대기');
    await page.getByTestId('status-name-input').press('Enter');

    await expect.poll(() => posts.lastBody()).toEqual({ name: 'QA 대기', category: 'IN_PROGRESS' });
    await expect(page.getByTestId('board-col-28')).toContainText('QA 대기');
    await expect(page.getByTestId('status-name-input')).toHaveCount(0);
    // 새 컬럼은 자기 상태 id 로 조회한다.
    await expect.poll(() => searches.urls().some((u) => u.searchParams.get('statusId') === '28')).toBe(true);
  });

  test('「상태」 필터(statusId)로 고른 컬럼만 조회한다', async ({ authenticatedPage: page }) => {
    const searches = trackRequests(page, 'GET', ISSUES_PATH);
    await stubBoard(page, { issues: [createIssue({ id: 1, number: 1, title: '리뷰할 것', statusId: 12, statusName: '리뷰 대기', status: 'IN_PROGRESS' })] });
    await page.goto(`/projects/${KEY}?view=board&statusId=12`);

    await expect(page.getByTestId('board-col-12').getByTestId('issue-card-1')).toBeVisible();
    // 다른 컬럼은 그대로 보이지만(빈 열) 조회하지 않는다.
    await expect(page.getByTestId('board-col-empty-2')).toBeVisible();
    await expectStays(page, () => searches.urls().filter((u) => u.searchParams.get('statusId') !== '12').length, 0);
    expect(searches.count()).toBeGreaterThan(0);
  });

  test('띠가 화면보다 넓어도 그 범주의 ＋ 는 보이는 오른쪽 끝에 붙어 있다', async ({ authenticatedPage: page }) => {
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

  test('상태 목록을 불러오지 못하면 프로젝트 화면이 다시 시도를 보이고, 다시 시도 성공 뒤 보드가 그려진다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    // 500 — 전역 재시도 정책(shouldRetryQuery)이 한 번 더 부르므로 다시 시도를 누르기 전까지 계속 실패시킨다(WP-870).
    let fail = true;
    await page.route(`**${STATUSES_PATH}`, (route) =>
      route.request().method() === 'GET' && fail ? route.fulfill({ status: 500, json: { status: 500, message: '서버 오류' } }) : route.fallback(),
    );
    await page.goto(`/projects/${KEY}?view=board`);

    // 프로젝트 화면이 오류를 보이고, 보드는 상태 목록 없이 그리지 않는다.
    const error = page.getByTestId('project-statuses-error');
    await expect(error).toContainText('상태 목록을 불러오지 못했습니다');
    await expect(page.getByTestId('board-scroll')).toHaveCount(0);
    fail = false;
    await error.getByRole('button', { name: '다시 시도' }).click();
    await expect(page.getByTestId('board-col-12')).toBeVisible();
    await expect(error).toHaveCount(0);
  });

  test('헤더 ⋯ 이 뒤에 상태 추가는 afterStatusId 를 보낸다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    const posts = trackRequests(page, 'POST', STATUSES_PATH);
    await page.goto(`/projects/${KEY}?view=board`);

    await page.getByTestId('board-col-menu-2').click();
    await page.getByRole('menuitem', { name: '이 뒤에 상태 추가' }).click();
    await page.getByTestId('status-name-input').fill('QA 대기');
    await page.getByTestId('status-name-input').press('Enter');

    await expect.poll(() => posts.lastBody<{ afterStatusId?: number }>()?.afterStatusId).toBe(2);
    expect(posts.lastBody()).toEqual({ name: 'QA 대기', category: 'IN_PROGRESS', afterStatusId: 2 });
  });

  test('상태가 20개면 헤더 ⋯ 이 뒤에 상태 추가가 막히고 이유를 보인다', async ({ authenticatedPage: page }) => {
    const statuses = await stubBoard(page);
    // 8개 + 진행 중 12개 = 상한 20개.
    for (let i = 0; i < 12; i++) statuses.push(makeProjectStatus({ id: 100 + i, name: `추가 상태 ${i + 1}`, category: 'IN_PROGRESS', position: 20 + i }));
    const posts = trackRequests(page, 'POST', STATUSES_PATH);
    await page.goto(`/projects/${KEY}?view=board`);

    await page.getByTestId('board-col-menu-2').click();
    const item = page.getByRole('menuitem', { name: /이 뒤에 상태 추가/ });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    // 이유는 흐려지는 항목 밖에 또렷하게 두고 aria-describedby 로 잇는다(WP-809 디자이너 리뷰).
    const reason = page.getByTestId('board-col-add-after-reason');
    await expect(reason).toHaveText('상태는 프로젝트당 20개까지예요');
    await expect(item).toHaveAttribute('aria-describedby', (await reason.getAttribute('id'))!);
    // 같은 보드의 다른 진입점은 그대로다 — 막힌 것은 추가뿐.
    await expect(page.getByRole('menuitem', { name: '이름 변경' })).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    // 범주 띠 ＋ 도 같은 상한 — 막히고, 감싼 칸에 포커스하면 같은 이유가 툴팁으로 뜬다.
    for (const category of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) {
      await expect(page.getByTestId(`board-band-add-${category}`)).toBeDisabled();
    }
    await page.getByTestId('board-band-add-limit-TODO').focus();
    await expect(page.getByRole('tooltip')).toHaveText('상태는 프로젝트당 20개까지예요');
    expect(posts.count()).toBe(0);
  });

  // WP-809 — 보드에서 상태를 더 고치려면(색·순서·삭제) 설정 「상태」 섹션으로 바로 간다.
  test('헤더 ⋯ 상태 관리… 는 설정 상태 섹션으로 간다', async ({ authenticatedPage: page }) => {
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

  test('헤더 ⋯ 이름 변경은 인라인 편집으로 PATCH 한다', async ({ authenticatedPage: page }) => {
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

  test('키보드로 연 편집기를 Esc 로 닫으면 포커스가 연 버튼(⋯·＋)으로 돌아온다', async ({ authenticatedPage: page }) => {
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

  test('헤더 이름 편집은 헤더 높이를 바꾸지 않고, 바깥을 누르면 저장 없이 닫힌다', async ({ authenticatedPage: page }) => {
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

  test('중복 이름은 그 자리에 오류를 보인다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    // 다른 사람이 방금 같은 이름을 만든 경우 — 화면 목록엔 없어 서버가 409 로 거절한다.
    await page.route(`**${STATUSES_PATH}`, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 409, json: { status: 409, message: '이미 존재하는 상태 이름입니다: 검토 중' } })
        : route.fallback(),
    );
    await page.goto(`/projects/${KEY}?view=board`);

    await page.getByTestId('board-band-add-IN_PROGRESS').click();
    await page.getByTestId('status-name-input').fill('검토 중');
    await page.getByTestId('status-name-input').press('Enter');

    // 서버 409 는 클라이언트 중복 검사와 같은 문구로 보인다(이름은 바로 위 입력에 있다).
    await expect(page.getByTestId('status-name-error')).toHaveText('이미 존재하는 상태 이름입니다');
    // 입력은 그대로 남고 포커스가 돌아와 바로 고칠 수 있다.
    await expect(page.getByTestId('status-name-input')).toHaveValue('검토 중');
    await expect(page.getByTestId('status-name-input')).toBeFocused();
  });

  test('한글 조합 중 Enter 는 저장하지 않고, 확정 뒤 Enter 로 저장한다', async ({ authenticatedPage: page }) => {
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

  test('31자 이름은 저장하지 않고 오류를 보인다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    const posts = trackRequests(page, 'POST', STATUSES_PATH);
    await page.goto(`/projects/${KEY}?view=board`);

    await page.getByTestId('board-band-add-TODO').click();
    await page.getByTestId('status-name-input').fill('가'.repeat(31));
    await page.getByTestId('status-name-input').press('Enter');

    await expect(page.getByTestId('status-name-error')).toHaveText('상태 이름은 30자 이하로 입력해 주세요');
    await expectStays(page, posts.count, 0);
  });

  // 끄는 동안 오른쪽에 떠오르는 에픽 패널(드롭 대상 아님)이 4번째 컬럼을 가리지 않도록 넓은 화면에서 끈다.
  test.describe('카드 끌어 놓기', () => {
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
  });

  test('MEMBER 에게는 ＋와 ⋯ 편집 항목이 없다', async ({ authenticatedPage: page }) => {
    await stubBoard(page, { role: 'MEMBER' });
    await page.goto(`/projects/${KEY}?view=board`);

    await expect(page.getByTestId('board-col-2')).toBeVisible();
    // 범주 띠는 누구에게나 보이지만 ＋ 는 없다.
    await expect(page.getByTestId('board-band-IN_PROGRESS')).toBeVisible();
    await expect(page.locator('[data-testid^="board-band-add-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="board-col-menu-"]')).toHaveCount(0);
  });

  test('개인 프로젝트 보드는 3컬럼이고 편집 진입점이 없다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject({ type: 'PERSONAL', isDefault: true }));
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, [createMember({ userId: 1, role: 'OWNER' })]);
    await mockApi(page, 'GET', ISSUES_PATH, createIssueSearchResponse([]));
    for (const p of ['labels', 'cycles', 'types']) await mockApi(page, 'GET', `/api/v1/projects/${KEY}/${p}`, []);
    await page.goto(`/projects/${KEY}?view=board`);

    await expect(page.getByTestId('board-col-1')).toBeVisible();
    await expect(page.getByTestId('board-col-2')).toBeVisible();
    await expect(page.getByTestId('board-col-3')).toBeVisible();
    // 취소 범주 컬럼은 없다.
    await expect(page.locator('[data-testid^="board-col-"][data-status-id]')).toHaveCount(3);
    // 범주 띠 자체를 숨긴다(편집이 없고 컬럼이 범주와 1:1).
    await expect(page.locator('[data-testid^="board-band-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="board-col-menu-"]')).toHaveCount(0);
  });

  test('완료 범주의 모든 컬럼에 「완료 모두 보기」 안내가 붙는다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    await page.goto(`/projects/${KEY}?view=board`);

    await expect(page.getByTestId('board-col-show-closed-3')).toBeVisible();
    await expect(page.getByTestId('board-col-show-closed-14')).toBeVisible();
    await expect(page.getByTestId('board-col-show-closed-4')).toBeVisible();
    await expect(page.getByTestId('board-col-show-closed-1')).toHaveCount(0);
    await expect(page.getByTestId('board-col-show-closed-12')).toHaveCount(0);
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
