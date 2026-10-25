// 프로젝트 구성요소(WP-933) 화면 E2E — 설정에서 관리 → 이슈에 붙이기 → 만들 때 고르기 → 목록 필터·열 → 오류 문구.
// 검증 축: 입력 → 요청 본문/쿼리(postDataJSON·searchParams) → 서버 응답을 따르는 화면.
// 서버 쪽 규칙(자동 지정·권한·유일성)은 백엔드 통합 테스트가 맡고, 여기서는 화면이 올바른 요청을 보내고 응답을 그리는지만 본다.
// 구성요소 목록은 상태를 가진 모킹 — 추가·보관·복원 뒤 재조회가 바뀐 목록을 받아야 화면이 거기에 맞게 바뀐다.
import type { Page } from '@playwright/test';

import type { ComponentResponse } from '../../src/types/component';
import type { IssueResponse } from '../../src/types/issue';
import { createAssignee, createComponent, toComponentSummary } from '../factories/component.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory';
import { systemTypes } from '../factories/issueType.factory';
import { createMember, createProject } from '../factories/project.factory';
import { expect, test } from '../fixtures/auth.fixture';
import { trackRequests } from '../fixtures/requests';

const KEY = 'WP';
const BASE = `/api/v1/projects/${KEY}`;

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** 박순(id 2) — 구성요소 담당자 후보. 현재 사용자(id 1)는 프로젝트 OWNER. */
const PARK = createAssignee();
const MEMBERS = [
  createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
  createMember({ userId: 2, username: 'park', name: '박순', role: 'MEMBER', active: true }),
];

interface SetupOptions {
  components?: ComponentResponse[];
  /** 프로젝트 응답 덮어쓰기(비구성원 등). */
  project?: Parameters<typeof createProject>[0];
  /** 이슈 목록·상세에 쓸 이슈(번호 1). */
  issue?: Partial<IssueResponse>;
}

/**
 * 구성요소 화면이 부르는 API 를 한꺼번에 모킹한다. 구성요소 목록은 서버처럼 상태를 들고 있다 —
 * 추가(POST)는 새 행을 만들고, 수정(PATCH)은 보낸 필드만 반영하며, 삭제(DELETE)는 뺀다.
 * 반환값의 list() 는 지금 서버가 가진 목록이다.
 */
async function setup(page: Page, opts: SetupOptions = {}) {
  let list = [...(opts.components ?? [])];
  let projectOverrides = opts.project;
  let nextId = 900;
  const issue = createIssue({ id: 1, number: 1, title: '결제 모듈 개편', ...opts.issue });

  await page.route(`**${BASE}`, (route) => route.fulfill(json(createProject(projectOverrides))));
  await page.route(`**${BASE}/members`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(MEMBERS)) : route.fallback(),
  );
  await page.route(`**${BASE}/types`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(systemTypes())) : route.fallback(),
  );

  // 구성요소 목록 GET + 추가 POST.
  await page.route(
    (u) => u.pathname === `${BASE}/components`,
    (route) => {
      const req = route.request();
      if (req.method() === 'GET') return route.fulfill(json(list));
      if (req.method() !== 'POST') return route.fallback();
      const body = req.postDataJSON() as { name: string; description?: string | null; defaultAssigneeId?: number | null };
      const created = createComponent({
        id: nextId++,
        name: body.name,
        description: body.description ?? null,
        defaultAssignee: body.defaultAssigneeId === 2 ? PARK : null,
      });
      list = [...list, created];
      return route.fulfill(json(created, 201));
    },
  );
  // 단건 수정(PATCH)·삭제(DELETE) — 보관·복원은 archived 만 바꾼다.
  await page.route(
    (u) => /^\/api\/v1\/projects\/WP\/components\/\d+$/.test(u.pathname),
    (route) => {
      const req = route.request();
      const id = Number(new URL(req.url()).pathname.split('/').pop());
      if (req.method() === 'PATCH') {
        const patch = req.postDataJSON() as Partial<ComponentResponse>;
        list = list.map((c) => (c.id === id ? { ...c, ...patch } : c));
        return route.fulfill(json(list.find((c) => c.id === id)));
      }
      if (req.method() === 'DELETE') {
        list = list.filter((c) => c.id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    },
  );

  // 이슈 목록(GET)·만들기(POST).
  await page.route(
    (u) => u.pathname === `${BASE}/issues`,
    (route) => {
      const req = route.request();
      if (req.method() === 'POST') return route.fulfill(json(createIssue({ id: 2, number: 2, title: '새 이슈' }), 201));
      if (req.method() !== 'GET') return route.fallback();
      return route.fulfill(json(createIssueSearchResponse([issue], null)));
    },
  );
  // 이슈 상세 + 부속 목록.
  await page.route(
    (u) => u.pathname === `${BASE}/issues/1`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill(json(createIssueDetail({ summary: issue })))
        : route.fallback(),
  );
  for (const sub of ['watchers', 'attachments']) {
    await page.route(
      (u) => u.pathname === `${BASE}/issues/1/${sub}`,
      (route) => route.fulfill(json([])),
    );
  }
  return {
    list: () => list,
    issue,
    /** 프로젝트 응답을 바꾼다(구성원 → 비구성원). 다음 조회부터 반영된다. */
    setProject: (next: SetupOptions['project']) => {
      projectOverrides = next;
    },
  };
}

/**
 * 화면을 열고 구성요소 목록 응답이 도착해 화면에 반영될 때까지 기다린다.
 * 「칸이 없다」(toHaveCount(0)) 단언은 데이터가 오기 전에도 참이라, 응답을 기다리지 않으면 숨김 로직이 깨져도 통과한다.
 * 응답 뒤에는 React 가 그 결과를 그릴 시간(두 프레임)을 준다.
 */
async function gotoComponentsLoaded(page: Page, url: string) {
  const loaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${BASE}/components` && r.request().method() === 'GET',
  );
  await page.goto(url);
  await loaded;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * 세 화면(상세·목록 필터/열·만들기 창)의 구성요소 노출 여부를 본다 — 목록 응답이 반영된 뒤에 판정한다.
 * 숨김(shown=false)과 노출(shown=true) 테스트가 같은 코드를 써서, 숨김 단언이 선택자 오타로 거짓 통과하지 않게 양성 쪽이 같은 선택자를 검증한다.
 */
async function expectComponentVisibility(page: Page, shown: boolean) {
  const count = shown ? 1 : 0;
  // 이슈 상세 — 구성요소 칸. 같은 속성 레일의 담당자 칸이 그려진 뒤에 본다.
  await gotoComponentsLoaded(page, `/projects/${KEY}/issues/1`);
  await expect(page.getByTestId('property-group-status-people')).toBeVisible();
  await expect(page.getByTestId('issue-components-field')).toHaveCount(count);

  // 목록 — 필터 후보·열 후보.
  await gotoComponentsLoaded(page, `/projects/${KEY}?group=none`);
  await expect(page.getByTestId('issue-row-1')).toBeVisible();
  await page.getByTestId('add-filter-trigger').click();
  await expect(page.getByTestId('add-filter-facet-priority')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-component')).toHaveCount(count);
  await page.keyboard.press('Escape');
  await page.getByTestId('issue-column-picker').click();
  await expect(page.getByTestId('issue-column-option-assignee')).toBeVisible();
  await expect(page.getByTestId('issue-column-option-components')).toHaveCount(count);
  await page.keyboard.press('Escape');

  // 만들기 창 — 구성요소 칸.
  await page.getByRole('button', { name: '+ 새 태스크' }).click();
  const dialog = page.getByRole('dialog', { name: '새 이슈' });
  await expect(dialog.getByLabel('제목')).toBeVisible();
  await expect(dialog.getByTestId('create-components-field')).toHaveCount(count);
}

test.describe('프로젝트 구성요소 (WP-933)', () => {
  test(
    '설정에서 구성요소를 추가하면 POST 본문이 이름·설명·담당자를 담는다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setup(page);
      const posts = trackRequests(page, 'POST', `${BASE}/components`);

      await page.goto(`/projects/${KEY}/settings`);
      const section = page.getByTestId('component-section');
      await expect(section).toBeVisible();
      // 구성요소가 없으면 안내 문구.
      await expect(page.getByTestId('component-empty')).toBeVisible();

      await page.getByTestId('component-add').click();
      const dialog = page.getByTestId('component-edit-dialog');
      await expect(dialog).toBeVisible();
      await page.getByTestId('component-name-input').fill('  Compute ');
      await page.getByTestId('component-description-input').fill('컴퓨트 영역');
      await page.getByTestId('component-assignee-select').click();
      await page.getByRole('option', { name: '박순' }).click();
      await page.getByTestId('component-save').click();

      // 이름 앞뒤 공백은 잘려 나가고, 담당자는 id 로 간다.
      await expect.poll(() => posts.lastBody()).toEqual({
        name: 'Compute',
        description: '컴퓨트 영역',
        defaultAssigneeId: 2,
      });
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('구성요소를 추가했어요')).toBeVisible();
      const row = page.getByTestId('component-row-900');
      await expect(row).toContainText('Compute');
      await expect(row).toContainText('컴퓨트 영역');
      await expect(page.getByTestId('component-row-900-assignee')).toHaveText('박순');
      await expect(page.getByTestId('component-row-900-count')).toHaveText('이슈 0');
    },
  );

  test('설정에서 편집하면 바뀐 필드만 PATCH 로 가고, 보관 → 보관한 목록에서 복원', async ({ authenticatedPage: page }) => {
    await setup(page, { components: [createComponent({ id: 5, name: 'Compute', description: '기존 설명', defaultAssignee: PARK })] });
    const patches = trackRequests(page, 'PATCH', `${BASE}/components/5`);

    await page.goto(`/projects/${KEY}/settings`);
    await expect(page.getByTestId('component-row-5')).toContainText('Compute');

    // 이름만 고치면 이름만 간다(담당자·설명은 싣지 않는다).
    await page.getByRole('button', { name: 'Compute 편집' }).click();
    await page.getByTestId('component-name-input').fill('Compute Core');
    await page.getByTestId('component-save').click();
    await expect.poll(() => patches.lastBody()).toEqual({ name: 'Compute Core' });
    await expect(page.getByTestId('component-edit-dialog')).toHaveCount(0);
    await expect(page.getByTestId('component-row-5')).toContainText('Compute Core');

    // 보관 → 사용 중 목록에서 사라지고 「보관한 구성요소 1개 보기」 가 생긴다. 사용 중 행엔 삭제가 없다.
    await expect(page.getByRole('button', { name: 'Compute Core 삭제' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Compute Core 보관' }).click();
    await expect.poll(() => patches.lastBody()).toEqual({ archived: true });
    await expect(page.getByTestId('component-empty')).toBeVisible();
    const toggle = page.getByTestId('component-archived-toggle');
    await expect(toggle).toHaveText('보관한 구성요소 1개 보기');
    await toggle.click();
    await expect(page.getByTestId('component-row-5')).toContainText('Compute Core');

    // 복원 → 다시 사용 중.
    await page.getByRole('button', { name: 'Compute Core 복원' }).click();
    await expect.poll(() => patches.lastBody()).toEqual({ archived: false });
    await expect(page.getByTestId('component-archived-toggle')).toHaveCount(0);
    await expect(page.getByTestId('component-row-5')).toContainText('Compute Core');
  });

  test('삭제는 보관한 구성요소에서만 — 확인창이 이슈 수를 알리고 DELETE 가 간다', async ({ authenticatedPage: page }) => {
    await setup(page, { components: [createComponent({ id: 6, name: '옛 영역', archived: true, issueCount: 3 })] });
    const deletes = trackRequests(page, 'DELETE', `${BASE}/components/6`);

    await page.goto(`/projects/${KEY}/settings`);
    await page.getByTestId('component-archived-toggle').click();
    await page.getByRole('button', { name: '옛 영역 삭제' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('3');
    await page.getByTestId('component-delete-confirm').click();

    await expect.poll(() => deletes.count()).toBe(1);
    await expect(page.getByText('구성요소를 삭제했어요')).toBeVisible();
    await expect(page.getByTestId('component-row-6')).toHaveCount(0);
  });

  test('상세 담당자 아래 피커로 붙이면 PUT 본문이 componentIds 를 담고 칩이 보인다', async ({ authenticatedPage: page }) => {
    const compute = createComponent({ id: 1, name: 'Compute' });
    const storage = createComponent({ id: 2, name: 'Storage' });
    const net = createComponent({ id: 3, name: 'Network' });
    const server = await setup(page, { components: [compute, storage, net], issue: { components: [toComponentSummary(compute)] } });
    const puts = trackRequests(page, 'PUT', `${BASE}/issues/1/components`);
    await page.route(
      (u) => u.pathname === `${BASE}/issues/1/components`,
      (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        const ids = (route.request().postDataJSON() as { componentIds: number[] }).componentIds;
        // 다음 상세 재조회가 붙은 칩을 돌려주도록 서버 상태를 바꾼다.
        server.issue.components = server.list().filter((c) => ids.includes(c.id)).map(toComponentSummary);
        return route.fulfill(json(server.issue.components));
      },
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    const field = page.getByTestId('issue-components-field');
    await expect(field).toBeVisible();
    await expect(page.getByTestId('issue-components')).toContainText('Compute');
    // 담당자 행 바로 아래에 놓인다(상태·담당 묶음 안).
    await expect(page.getByTestId('property-group-status-people').getByTestId('issue-components-field')).toBeVisible();

    await page.getByTestId('component-picker-trigger').click();
    const picker = page.getByTestId('component-picker');
    await expect(picker.getByTestId('component-option-1').getByRole('checkbox')).toBeChecked();
    await picker.getByTestId('component-option-3').getByRole('checkbox').check();
    // 닫을 때 한 번만 저장한다.
    expect(puts.count()).toBe(0);
    await page.keyboard.press('Escape');

    await expect.poll(() => puts.lastBody()).toEqual({ componentIds: [1, 3] });
    expect(puts.count()).toBe(1);
    await expect(page.getByText('구성요소를 저장했어요')).toBeVisible();
    const chips = page.getByTestId('issue-components');
    await expect(chips).toContainText('Compute');
    await expect(chips).toContainText('Network');
    await expect(chips).not.toContainText('Storage');
  });

  test('만들기 창에서 구성요소를 고르면 자동 지정 안내가 보이고 POST 에 componentIds 가 실린다', async ({
    authenticatedPage: page,
  }) => {
    await setup(page, {
      components: [
        createComponent({ id: 1, name: 'Compute', defaultAssignee: PARK }),
        createComponent({ id: 2, name: 'Docs' }),
      ],
    });
    const posts = trackRequests(page, 'POST', `${BASE}/issues`);

    await page.goto(`/projects/${KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    const dialog = page.getByRole('dialog', { name: '새 이슈' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('create-components-field')).toBeVisible();
    // 목록이 로드돼 피커가 선택지를 가진 상태에서 시작한다(칸이 보인다 = 사용 중 구성요소가 로드됨).
    await dialog.getByLabel('제목').fill('컴퓨트 장애 확인');
    await dialog.getByTestId('component-picker-trigger').click();
    await expect(page.getByTestId('component-option-1')).toBeVisible();
    // 담당자 없는 Docs 만 고르면 붙을 사람이 없어 안내가 없다 — 선택 결과(칩)가 반영된 뒤에 본다.
    await page.getByTestId('component-option-2').getByRole('checkbox').check();
    await page.keyboard.press('Escape');
    await expect(dialog.getByTestId('create-components')).toContainText('Docs');
    await expect(dialog.getByTestId('create-component-assign-hint')).toHaveCount(0);
    // 이어서 담당자가 있는 Compute 도 → 안내.
    await dialog.getByTestId('component-picker-trigger').click();
    await page.getByTestId('component-option-1').getByRole('checkbox').check();
    await page.keyboard.press('Escape');

    await expect(dialog.getByTestId('create-components')).toContainText('Compute');
    await expect(dialog.getByTestId('create-components')).toContainText('Docs');
    await expect(dialog.getByTestId('create-component-assign-hint')).toHaveText('만들면 Compute 담당 박순 님이 맡아요');

    await dialog.getByRole('button', { name: '생성' }).click();
    await expect.poll(() => posts.lastBody()).toMatchObject({ title: '컴퓨트 장애 확인', componentIds: [1, 2] });
  });

  test('구성요소를 안 고르면 POST 에 componentIds 가 없다', async ({ authenticatedPage: page }) => {
    await setup(page, { components: [createComponent({ id: 1, name: 'Compute' })] });
    const posts = trackRequests(page, 'POST', `${BASE}/issues`);

    await page.goto(`/projects/${KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    const dialog = page.getByRole('dialog', { name: '새 이슈' });
    await dialog.getByLabel('제목').fill('그냥 이슈');
    await dialog.getByRole('button', { name: '생성' }).click();

    await expect.poll(() => posts.count()).toBe(1);
    expect(posts.lastBody()).not.toHaveProperty('componentIds');
  });

  test('구성요소 필터를 고르면 목록 요청에 component 파라미터가 실리고 URL 에 남는다 — 「구성요소 없음」은 none', async ({
    authenticatedPage: page,
  }) => {
    await setup(page, {
      components: [
        createComponent({ id: 1, name: 'Compute' }),
        createComponent({ id: 2, name: 'Storage' }),
      ],
    });
    // 이슈 목록 요청만 — 같은 경로로 가는 에픽 패널 요청(type=6)은 제외한다.
    const searches = trackRequests(page, 'GET', (u) => u.pathname === `${BASE}/issues` && !u.searchParams.has('type'));

    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    expect(searches.lastUrl()?.searchParams.has('component')).toBe(false);

    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-component').click();
    // 다른 facet 처럼 이슈 수는 보이지 않는다.
    await expect(page.getByTestId('facet-value-component-1')).toHaveText('Compute');
    await page.getByTestId('facet-value-component-1').click();
    await page.getByTestId('facet-value-component-2').click();
    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(/component=1(%2C|,)2/);
    await expect.poll(() => searches.lastUrl()?.searchParams.get('component')).toBe('1,2');
    await expect(page.getByTestId('filter-chip-component')).toBeVisible();

    // 새로고침해도 URL 의 필터가 그대로 요청에 실린다 — 새로고침 뒤에 나간 요청만 본다(이전 요청이 남아 거짓 통과하지 않게).
    const before = searches.count();
    const reloaded = page.waitForRequest(
      (r) => new URL(r.url()).pathname === `${BASE}/issues` && !new URL(r.url()).searchParams.has('type'),
    );
    await page.reload();
    expect(new URL((await reloaded).url()).searchParams.get('component')).toBe('1,2');
    expect(searches.count()).toBeGreaterThan(before);
    await expect(page.getByTestId('filter-chip-component')).toBeVisible();

    // 둘을 풀고 「구성요소 없음」 → none.
    await page.getByTestId('filter-chip-component-remove').click();
    await expect(page).not.toHaveURL(/component=/);
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-component').click();
    await page.getByTestId('facet-value-component-none').click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/component=none/);
    await expect.poll(() => searches.lastUrl()?.searchParams.get('component')).toBe('none');
  });

  // 숨김/노출을 한 테스트에서 두 단계로 이어 돌리면 전체 화면 로드(page.goto, Vite dev 변환 포함)가 4번 → 5.8초×2 = 12초가 한 테스트 예산(30초)에
  // 들어간다. 부하에서 로드가 2배만 느려져도 한도에 닿아 goto 가 시간 초과로 죽었다(단언 문제가 아니라 예산 문제).
  // 그래서 같은 판정 함수(expectComponentVisibility)를 쓰는 두 테스트로 나눠 각자 예산을 갖게 한다 — 판정 코드는 한 곳이라 양성 대조는 그대로다.
  test('구성요소가 없으면 상세·필터·열·만들기 창에 구성요소가 보이지 않는다', async ({ authenticatedPage: page }) => {
    await setup(page, { components: [] });
    await expectComponentVisibility(page, false);
  });

  test('사용 중 구성요소가 있으면 같은 화면(상세·필터·열·만들기 창)에 구성요소가 나타난다', async ({ authenticatedPage: page }) => {
    await setup(page, { components: [createComponent({ id: 1, name: 'Compute' })] });
    await expectComponentVisibility(page, true);
  });

  test('목록 열 고르기에서 구성요소 열을 켜면 칩이 보인다 — 2개까지 보이고 나머지는 +N', async ({ authenticatedPage: page }) => {
    const names = ['Compute', 'Storage', 'Network'];
    const comps = names.map((name, i) => createComponent({ id: i + 1, name }));
    await setup(page, { components: comps, issue: { components: comps.map(toComponentSummary) } });

    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    // 기본 열이 아니라 켜기 전엔 셀이 없다.
    await expect(page.getByTestId('issue-row-1-components')).toHaveCount(0);

    await page.getByTestId('issue-column-picker').click();
    await page.getByTestId('issue-column-option-components').click();
    await page.keyboard.press('Escape');

    const cell = page.getByTestId('issue-row-1-components');
    await expect(cell).toContainText('Compute');
    await expect(cell).toContainText('Storage');
    await expect(cell).not.toContainText('Network');
    await expect(cell).toContainText('+1');
    await expect(page.getByRole('columnheader', { name: '구성요소' })).toBeVisible();
  });

  test('보관된 구성요소는 피커에 없고 필터의 보관됨 묶음에 있다 — 이미 붙은 보관 구성요소만 피커에 「보관됨」으로 남는다', async ({
    authenticatedPage: page,
  }) => {
    const active = createComponent({ id: 1, name: 'Compute' });
    const attachedArchived = createComponent({ id: 2, name: '옛 영역', archived: true });
    const otherArchived = createComponent({ id: 3, name: '폐기 영역', archived: true });
    await setup(page, {
      components: [active, attachedArchived, otherArchived],
      issue: { components: [toComponentSummary(attachedArchived)] },
    });

    // 상세 피커 — 사용 중 + 이 이슈에 붙은 보관만. 안 붙은 보관은 없다.
    await page.goto(`/projects/${KEY}/issues/1`);
    await expect(page.getByTestId('issue-components-field')).toBeVisible();
    await page.getByTestId('component-picker-trigger').click();
    const picker = page.getByTestId('component-picker');
    await expect(picker.getByTestId('component-option-1')).toBeVisible();
    await expect(picker.getByTestId('component-option-2')).toContainText('보관됨');
    await expect(picker.getByTestId('component-option-2').getByRole('checkbox')).toBeChecked();
    await expect(picker.getByTestId('component-option-3')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 필터 — 두 보관 구성요소 모두 「보관됨」 묶음 머리글 아래에 있다.
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-component').click();
    await expect(page.getByTestId('facet-group-component-보관됨')).toBeVisible();
    await expect(page.getByTestId('facet-value-component-1')).toBeVisible();
    await expect(page.getByTestId('facet-value-component-2')).toBeVisible();
    await expect(page.getByTestId('facet-value-component-3')).toBeVisible();
    // 보관됨 머리글은 사용 중 값 뒤에 놓인다.
    const order = await page
      .locator('[data-testid="facet-value-component-1"], [data-testid="facet-group-component-보관됨"], [data-testid="facet-value-component-2"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(order).toEqual(['facet-value-component-1', 'facet-group-component-보관됨', 'facet-value-component-2']);
  });

  test('구성원이 아니면 만들기 창에 구성요소 칸이 없다', async ({ authenticatedPage: page }) => {
    // 같은 구성요소 데이터로 구성원일 땐 칸이 보이고(양성 대조), OPEN 프로젝트의 비구성원은 접수만 해서 칸이 없다.
    const server = await setup(page, {
      components: [createComponent({ id: 1, name: 'Compute', defaultAssignee: PARK })],
    });
    const posts = trackRequests(page, 'POST', `${BASE}/issues`);

    // 구성원 — 칸이 보인다(목록 응답이 반영된 뒤).
    await gotoComponentsLoaded(page, `/projects/${KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    const dialog = page.getByRole('dialog', { name: '새 이슈' });
    await expect(dialog.getByTestId('create-components-field')).toBeVisible();
    await expect(dialog.getByTestId('create-intake-notice')).toHaveCount(0);
    await page.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toHaveCount(0);

    // 비구성원 — 접수 안내가 보이는(= 비구성원 화면으로 그려진) 뒤에 칸이 없는지 본다.
    server.setProject({ type: 'OPEN', viewerIsMember: false });
    await gotoComponentsLoaded(page, `/projects/${KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    await expect(dialog.getByTestId('create-intake-notice')).toBeVisible();
    await expect(dialog.getByTestId('create-components-field')).toHaveCount(0);
    await expect(dialog.getByTestId('create-component-assign-hint')).toHaveCount(0);

    await dialog.getByLabel('제목').fill('접수 문의');
    await dialog.getByRole('button', { name: '생성' }).click();
    await expect.poll(() => posts.count()).toBe(1);
    expect(posts.lastBody()).not.toHaveProperty('componentIds');
  });

  test('구성요소 API 400 오류 메시지가 토스트로 보인다 — 이슈에 붙이기', async ({ authenticatedPage: page }) => {
    await setup(page, { components: [createComponent({ id: 1, name: 'Compute' })] });
    await page.route(
      (u) => u.pathname === `${BASE}/issues/1/components`,
      (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill(
              json(
                { status: 400, message: '보관된 구성요소는 새로 붙일 수 없습니다', errors: { code: 'COMPONENT_ARCHIVED' } },
                400,
              ),
            )
          : route.fallback(),
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    await expect(page.getByTestId('issue-components-field')).toBeVisible();
    await page.getByTestId('component-picker-trigger').click();
    await page.getByTestId('component-option-1').getByRole('checkbox').check();
    await page.keyboard.press('Escape');

    // 코드 문자열이 아니라 서버 문구가 보인다.
    await expect(page.getByText('보관된 구성요소는 새로 붙일 수 없습니다')).toBeVisible();
    await expect(page.getByText('COMPONENT_ARCHIVED')).toHaveCount(0);
  });

  test('구성요소 API 400 오류 메시지가 편집 창 안에 보이고 창은 닫히지 않는다 — 이름 중복', async ({ authenticatedPage: page }) => {
    await setup(page, { components: [createComponent({ id: 1, name: 'Compute' })] });
    await page.route(
      (u) => u.pathname === `${BASE}/components`,
      (route) =>
        route.request().method() === 'POST'
          ? route.fulfill(
              json({ status: 400, message: '같은 이름의 구성요소가 이미 있습니다', errors: { code: 'COMPONENT_NAME_TAKEN' } }, 400),
            )
          : route.fallback(),
    );

    await page.goto(`/projects/${KEY}/settings`);
    await page.getByTestId('component-add').click();
    await page.getByTestId('component-name-input').fill('compute');
    await page.getByTestId('component-save').click();

    await expect(page.getByTestId('component-edit-error')).toHaveText('같은 이름의 구성요소가 이미 있습니다');
    await expect(page.getByTestId('component-edit-dialog')).toBeVisible();
    // 입력은 그대로 남아 고쳐서 다시 저장할 수 있다.
    await expect(page.getByTestId('component-name-input')).toHaveValue('compute');
  });
});
