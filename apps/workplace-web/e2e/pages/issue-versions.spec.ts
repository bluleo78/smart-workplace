// 프로젝트 버전(WP-888) 화면 E2E — 버전 화면에서 만들기·상세·출시 → 이슈에 붙이기 → 목록 필터 → 타임라인 레인 → 권한·오류 문구.
// 검증 축: 입력 → 요청 본문/쿼리(postDataJSON·searchParams) → 서버 응답을 따르는 화면.
// 서버 쪽 규칙(유일성·보관 차단·잠금)은 백엔드 통합 테스트가 맡고, 여기서는 화면이 올바른 요청을 보내고 응답을 그리는지만 본다.
// 버전 목록은 상태를 가진 모킹 — 만들기·출시 뒤 재조회가 바뀐 목록을 받아야 화면이 거기에 맞게 바뀐다.
import type { Page } from '@playwright/test';

import type { IssueResponse } from '../../src/types/issue';
import type { VersionIssueCount, VersionResponse } from '../../src/types/version';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory';
import { systemTypes } from '../factories/issueType.factory';
import { createMember, createProject } from '../factories/project.factory';
import { createVersion, toVersionSummary } from '../factories/version.factory';
import { expect, test } from '../fixtures/auth.fixture';
import { trackRequests } from '../fixtures/requests';

const KEY = 'WP';
const BASE = `/api/v1/projects/${KEY}`;

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** 현재 사용자(id 1)가 프로젝트 OWNER 인 구성원 목록 — 버전 관리 권한이 있다. */
const OWNER_MEMBERS = [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })];
/** 현재 사용자(id 1)가 일반 MEMBER 인 목록 — 버전 화면은 읽기 전용이다. */
const PLAIN_MEMBERS = [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'MEMBER' })];

interface SetupOptions {
  versions?: VersionResponse[];
  /** 이슈 목록·상세에 쓸 이슈(번호 1). */
  issue?: Partial<IssueResponse>;
  /** 버전 상세가 읽는 이슈 — fixVersion/affectsVersion 파라미터가 있는 검색에 이 목록을 돌려준다. */
  fixIssues?: IssueResponse[];
  affectsIssues?: IssueResponse[];
  /** 출시 대화상자가 읽는 붙은 이슈 수. */
  count?: VersionIssueCount;
  members?: ReturnType<typeof createMember>[];
}

/**
 * 버전 화면이 부르는 API 를 한꺼번에 모킹한다. 버전 목록은 서버처럼 상태를 들고 있다 —
 * 추가(POST)는 새 행을 만들고, 출시(POST release)는 그 버전을 RELEASED 로 바꾼다.
 * 반환값의 list() 는 지금 서버가 가진 목록이다.
 */
async function setup(page: Page, opts: SetupOptions = {}) {
  let list = [...(opts.versions ?? [])];
  let members = opts.members ?? OWNER_MEMBERS;
  let nextId = 900;
  const issue = createIssue({ id: 1, number: 1, title: '결제 모듈 개편', ...opts.issue });

  await page.route(`**${BASE}`, (route) => route.fulfill(json(createProject())));
  await page.route(`**${BASE}/members`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(members)) : route.fallback(),
  );
  await page.route(`**${BASE}/types`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(systemTypes())) : route.fallback(),
  );

  // 버전 목록 GET + 추가 POST.
  await page.route(
    (u) => u.pathname === `${BASE}/versions`,
    (route) => {
      const req = route.request();
      if (req.method() === 'GET') return route.fulfill(json(list));
      if (req.method() !== 'POST') return route.fallback();
      const body = req.postDataJSON() as { name: string; description?: string | null; startDate?: string | null; releaseDate?: string | null };
      const created = createVersion({
        id: nextId++,
        name: body.name,
        description: body.description ?? null,
        startDate: body.startDate ?? null,
        releaseDate: body.releaseDate ?? null,
      });
      list = [...list, created];
      return route.fulfill(json(created, 201));
    },
  );
  // 붙은 이슈 수 · 출시.
  await page.route(
    (u) => /^\/api\/v1\/projects\/WP\/versions\/\d+\/issue-count$/.test(u.pathname),
    (route) => route.fulfill(json(opts.count ?? { fix: 0, affects: 0, unresolvedFix: 0 })),
  );
  await page.route(
    (u) => /^\/api\/v1\/projects\/WP\/versions\/\d+\/release$/.test(u.pathname),
    (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').slice(-2)[0]);
      list = list.map((v) => (v.id === id ? { ...v, status: 'RELEASED', releasedAt: new Date().toISOString() } : v));
      return route.fulfill(json(list.find((v) => v.id === id)));
    },
  );

  // 이슈 목록(GET) — 버전 파라미터가 있으면 상세용 목록, 없으면 기본 이슈 한 건.
  await page.route(
    (u) => u.pathname === `${BASE}/issues`,
    (route) => {
      const req = route.request();
      if (req.method() !== 'GET') return route.fallback();
      const q = new URL(req.url()).searchParams;
      if (q.has('fixVersion') && opts.fixIssues) return route.fulfill(json(createIssueSearchResponse(opts.fixIssues, null)));
      if (q.has('affectsVersion') && opts.affectsIssues) return route.fulfill(json(createIssueSearchResponse(opts.affectsIssues, null)));
      return route.fulfill(json(createIssueSearchResponse([issue], null)));
    },
  );
  // 이슈 상세 + 부속 목록.
  await page.route(
    (u) => u.pathname === `${BASE}/issues/1`,
    (route) =>
      route.request().method() === 'GET' ? route.fulfill(json(createIssueDetail({ summary: issue }))) : route.fallback(),
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
    /** 구성원 목록을 바꾼다(소유자 → 일반 멤버). 다음 조회부터 반영된다. */
    setMembers: (next: typeof members) => {
      members = next;
    },
  };
}

/**
 * 화면을 열고 버전 목록 응답이 도착해 반영될 때까지 기다린다.
 * 「칸이 없다」(toHaveCount(0)) 단언은 데이터가 오기 전에도 참이라, 응답을 기다리지 않으면 숨김 로직이 깨져도 통과한다.
 * 응답 뒤에는 React 가 그 결과를 그릴 시간(두 프레임)을 준다.
 */
async function gotoVersionsLoaded(page: Page, url: string) {
  const loaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `${BASE}/versions` && r.request().method() === 'GET',
  );
  await page.goto(url);
  await loaded;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * 두 화면(이슈 상세·목록 필터/열)의 버전 노출 여부를 본다 — 목록 응답이 반영된 뒤에 판정한다.
 * 숨김(shown=false)과 노출(shown=true) 테스트가 같은 코드를 써서, 숨김 단언이 선택자 오타로 거짓 통과하지 않게 양성 쪽이 같은 선택자를 검증한다.
 * 프로젝트 머리의 「버전」 링크는 버전이 없어도 늘 보인다(만들 곳이 있어야 한다).
 */
async function expectVersionVisibility(page: Page, shown: boolean) {
  const count = shown ? 1 : 0;
  // 이슈 상세 — 수정·영향 버전 두 줄. 같은 속성 레일의 담당자 칸이 그려진 뒤에 본다.
  await gotoVersionsLoaded(page, `/projects/${KEY}/issues/1`);
  await expect(page.getByTestId('property-group-status-people')).toBeVisible();
  await expect(page.getByTestId('issue-fix-versions-field')).toHaveCount(count);
  await expect(page.getByTestId('issue-affects-versions-field')).toHaveCount(count);

  // 목록 — 필터 후보·열 후보·머리 링크.
  await gotoVersionsLoaded(page, `/projects/${KEY}?group=none`);
  await expect(page.getByTestId('issue-row-1')).toBeVisible();
  await expect(page.getByRole('link', { name: '버전' })).toBeVisible();
  await page.getByTestId('add-filter-trigger').click();
  await expect(page.getByTestId('add-filter-facet-priority')).toBeVisible();
  await expect(page.getByTestId('add-filter-facet-fixVersion')).toHaveCount(count);
  await expect(page.getByTestId('add-filter-facet-affectsVersion')).toHaveCount(count);
  await page.keyboard.press('Escape');
  await page.getByTestId('issue-column-picker').click();
  await expect(page.getByTestId('issue-column-option-assignee')).toBeVisible();
  await expect(page.getByTestId('issue-column-option-fixVersions')).toHaveCount(count);
  await expect(page.getByTestId('issue-column-option-affectsVersions')).toHaveCount(count);
}

/** 타임라인이 부르는 나머지 API — 이슈·사이클·마일스톤·의존. 간트가 그려질 이슈 한 건을 둔다. */
async function setupTimelineStubs(page: Page) {
  await page.route(`**${BASE}/cycles`, (route) => route.fulfill(json([])));
  await page.route(`**${BASE}/milestones`, (route) => route.fulfill(json([])));
  await page.route(`**${BASE}/issue-dependencies`, (route) => route.fulfill(json([])));
}

test.describe('프로젝트 버전 (WP-888)', () => {
  test(
    '버전 화면에서 버전을 만들면 POST 본문이 이름·설명·날짜를 담는다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setup(page);
      const posts = trackRequests(page, 'POST', `${BASE}/versions`);

      await page.goto(`/projects/${KEY}/versions`);
      // 버전이 없으면 안내 문구 — 목록 응답이 반영된 뒤의 화면.
      await expect(page.getByTestId('version-empty')).toBeVisible();

      await page.getByTestId('version-new').click();
      const dialog = page.getByTestId('version-form-dialog');
      await expect(dialog).toBeVisible();
      await page.getByTestId('version-name-input').fill('  1.0.0 ');
      await page.getByTestId('version-description-input').fill('첫 정식 출시');
      await page.getByTestId('version-start-input').fill('2026-11-01');
      await page.getByTestId('version-release-input').fill('2026-12-01');
      await page.getByTestId('version-save').click();

      // 이름 앞뒤 공백은 잘려 나가고 날짜는 yyyy-MM-dd 로 간다.
      await expect.poll(() => posts.lastBody()).toEqual({
        name: '1.0.0',
        description: '첫 정식 출시',
        startDate: '2026-11-01',
        releaseDate: '2026-12-01',
      });
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('버전을 만들었어요')).toBeVisible();
      const row = page.getByTestId('version-row-900');
      await expect(row).toContainText('1.0.0');
      await expect(row).toContainText('미출시');
      await expect(page.getByTestId('version-summary')).toHaveText('미출시 1 · 출시됨 0');
    },
  );

  test('버전 상세는 나가는 이슈를 유형별로 묶고 영향 버전 탭을 따로 보인다', async ({ authenticatedPage: page }) => {
    const v1 = createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01', progress: { done: 1, inProgress: 1, todo: 1 }, affectsCount: 1 });
    const v2 = createVersion({ id: 2, name: '1.1.0' });
    const task = createIssue({ id: 11, number: 11, title: '결제 화면', fixVersions: [toVersionSummary(v1), toVersionSummary(v2)] });
    const bug = createIssue({ id: 12, number: 12, title: '결제 오류', type: { id: 2, name: 'BUG', colorToken: 'RED', icon: 'Bug' }, fixVersions: [toVersionSummary(v1)] });
    const defect = createIssue({ id: 13, number: 13, title: '1.0.0 에서 난 결함', affectsVersions: [toVersionSummary(v1)] });
    await setup(page, { versions: [v1, v2], fixIssues: [bug, task], affectsIssues: [defect] });
    const searches = trackRequests(page, 'GET', (u) => u.pathname === `${BASE}/issues` && u.searchParams.has('fixVersion'));
    const affectSearches = trackRequests(page, 'GET', (u) => u.pathname === `${BASE}/issues` && u.searchParams.has('affectsVersion'));

    await page.goto(`/projects/${KEY}/versions/1`);
    // 나가는 이슈 탭 — 유형별 묶음(TASK 가 BUG 보다 앞: 프로젝트 유형 순서).
    const fix = page.getByTestId('version-issues-fixVersion');
    await expect(fix.getByTestId('version-group-1').getByTestId('version-issue-11')).toContainText('결제 화면');
    await expect(fix.getByTestId('version-group-2').getByTestId('version-issue-12')).toContainText('결제 오류');
    const order = await fix.locator('[data-testid^="version-group-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(order).toEqual(['version-group-1', 'version-group-2']);
    // 다른 버전에도 붙은 이슈엔 안내, 이 버전만인 이슈엔 없다.
    await expect(page.getByTestId('version-issue-11-also')).toContainText('1.1.0 에도 포함');
    await expect(page.getByTestId('version-issue-12-also')).toHaveCount(0);
    await expect(page.getByTestId('version-tab-fix')).toContainText('2');
    await expect(page.getByTestId('version-affects-note')).toHaveText('영향 버전으로 붙은 결함 1건');
    expect(searches.lastUrl()?.searchParams.get('fixVersion')).toBe('1');

    // 영향 버전 탭 — 결함만 보이고, 나가는 이슈는 보이지 않는다.
    await page.getByTestId('version-tab-affects').click();
    await expect(page.getByTestId('version-issues-affectsVersion').getByTestId('version-issue-13')).toContainText('1.0.0 에서 난 결함');
    await expect(page.getByTestId('version-issue-11')).toHaveCount(0);
    expect(affectSearches.lastUrl()?.searchParams.get('affectsVersion')).toBe('1');
  });

  test('출시 대화상자에서 다음 버전으로 옮기기를 고르면 release 요청에 moveUnresolvedTo 가 실린다', async ({
    authenticatedPage: page,
  }) => {
    const v1 = createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01' });
    const v2 = createVersion({ id: 2, name: '1.1.0', releaseDate: '2027-01-15' });
    const v3 = createVersion({ id: 3, name: '2.0.0' });
    await setup(page, { versions: [v1, v2, v3], count: { fix: 3, affects: 0, unresolvedFix: 2 } });
    const releases = trackRequests(page, 'POST', `${BASE}/versions/1/release`);

    await page.goto(`/projects/${KEY}/versions/1`);
    await page.getByTestId('version-release').click();
    const dialog = page.getByTestId('version-release-dialog');
    // 끝나지 않은 이슈 수가 와야 출시할 수 있다 — 안내가 보인 뒤에 선택한다.
    await expect(dialog.getByTestId('version-release-unresolved')).toContainText('2건');
    await expect(dialog.getByTestId('version-release-date')).toHaveValue('2026-12-01');
    // 기본 대상은 목록 순서상 다음 미출시 버전.
    await expect(dialog.getByTestId('version-release-target')).toContainText('1.1.0');
    await dialog.getByTestId('version-release-target').click();
    await page.getByRole('option', { name: '2.0.0' }).click();
    await dialog.getByTestId('version-release-submit').click();

    await expect.poll(() => releases.lastBody()).toEqual({ releaseDate: '2026-12-01', moveUnresolvedTo: 3 });
    expect(releases.count()).toBe(1);
    await expect(page.getByText('버전을 출시했어요')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('version-unrelease')).toBeVisible();
  });

  test('출시 대화상자에서 그대로 두기를 고르면 release 요청에 moveUnresolvedTo 가 없다', async ({ authenticatedPage: page }) => {
    const v1 = createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01' });
    const v2 = createVersion({ id: 2, name: '1.1.0' });
    await setup(page, { versions: [v1, v2], count: { fix: 3, affects: 0, unresolvedFix: 2 } });
    const releases = trackRequests(page, 'POST', `${BASE}/versions/1/release`);

    await page.goto(`/projects/${KEY}/versions/1`);
    await page.getByTestId('version-release').click();
    const dialog = page.getByTestId('version-release-dialog');
    await expect(dialog.getByTestId('version-release-unresolved')).toBeVisible();
    await dialog.getByLabel('그대로 두기').click();
    await expect(dialog.getByTestId('version-release-target')).toHaveCount(0);
    await dialog.getByTestId('version-release-submit').click();

    await expect.poll(() => releases.lastBody()).toEqual({ releaseDate: '2026-12-01' });
  });

  test('상세 피커로 수정 버전을 붙이면 PUT 본문이 fixVersionIds 만 담고 칩이 보인다', async ({ authenticatedPage: page }) => {
    const v1 = createVersion({ id: 1, name: '1.0.0' });
    const v2 = createVersion({ id: 2, name: '1.1.0' });
    const server = await setup(page, { versions: [v1, v2], issue: { fixVersions: [toVersionSummary(v1)], affectsVersions: [] } });
    const puts = trackRequests(page, 'PUT', `${BASE}/issues/1/versions`);
    await page.route(
      (u) => u.pathname === `${BASE}/issues/1/versions`,
      (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        const ids = (route.request().postDataJSON() as { fixVersionIds: number[] }).fixVersionIds;
        // 다음 상세 재조회가 붙은 칩을 돌려주도록 서버 상태를 바꾼다.
        server.issue.fixVersions = server.list().filter((v) => ids.includes(v.id)).map(toVersionSummary);
        return route.fulfill(json({ fixVersions: server.issue.fixVersions, affectsVersions: [] }));
      },
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    await expect(page.getByTestId('issue-fix-versions-field')).toBeVisible();
    await expect(page.getByTestId('issue-fix-versions')).toContainText('1.0.0');
    // 담당자 행 묶음 안에서 수정 버전 줄 다음에 영향 버전 줄이 온다.
    await expect(page.getByTestId('issue-affects-versions-field')).toBeVisible();

    await page.getByTestId('fix-version-picker-trigger').click();
    const picker = page.getByTestId('fix-version-picker');
    await expect(picker.getByTestId('fix-version-option-1').getByRole('checkbox')).toBeChecked();
    await picker.getByTestId('fix-version-option-2').getByRole('checkbox').check();
    // 닫을 때 한 번만 저장한다.
    expect(puts.count()).toBe(0);
    await page.keyboard.press('Escape');

    // 보낸 종류(수정 버전)만 담긴다 — 영향 버전 줄을 덮어쓰지 않는다.
    await expect.poll(() => puts.lastBody()).toEqual({ fixVersionIds: [1, 2] });
    expect(puts.count()).toBe(1);
    await expect(page.getByText('버전을 저장했어요')).toBeVisible();
    const chips = page.getByTestId('issue-fix-versions');
    await expect(chips).toContainText('1.0.0');
    await expect(chips).toContainText('1.1.0');
  });

  test('수정 버전 필터를 고르면 목록 요청에 fixVersion 이 실리고 URL 에 남는다 — 「수정 버전 없음」은 none', async ({
    authenticatedPage: page,
  }) => {
    await setup(page, { versions: [createVersion({ id: 1, name: '1.0.0' }), createVersion({ id: 2, name: '1.1.0' })] });
    // 이슈 목록 요청만 — 같은 경로로 가는 에픽 패널 요청(type=6)은 제외한다.
    const searches = trackRequests(page, 'GET', (u) => u.pathname === `${BASE}/issues` && !u.searchParams.has('type'));

    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    expect(searches.lastUrl()?.searchParams.has('fixVersion')).toBe(false);

    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-fixVersion').click();
    await expect(page.getByTestId('facet-value-fixVersion-1')).toContainText('1.0.0');
    await page.getByTestId('facet-value-fixVersion-1').click();
    await page.getByTestId('facet-value-fixVersion-2').click();
    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(/fixVersion=1(%2C|,)2/);
    await expect.poll(() => searches.lastUrl()?.searchParams.get('fixVersion')).toBe('1,2');
    await expect(page.getByTestId('filter-chip-fixVersion')).toBeVisible();

    // 새로고침해도 URL 의 필터가 그대로 요청에 실린다 — 새로고침 뒤에 나간 요청만 본다(이전 요청이 남아 거짓 통과하지 않게).
    const before = searches.count();
    const reloaded = page.waitForRequest(
      (r) => new URL(r.url()).pathname === `${BASE}/issues` && !new URL(r.url()).searchParams.has('type'),
    );
    await page.reload();
    expect(new URL((await reloaded).url()).searchParams.get('fixVersion')).toBe('1,2');
    expect(searches.count()).toBeGreaterThan(before);
    await expect(page.getByTestId('filter-chip-fixVersion')).toBeVisible();

    // 둘을 풀고 「수정 버전 없음」 → none.
    await page.getByTestId('filter-chip-fixVersion-remove').click();
    await expect(page).not.toHaveURL(/fixVersion=/);
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-fixVersion').click();
    await page.getByTestId('facet-value-fixVersion-none').click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/fixVersion=none/);
    await expect.poll(() => searches.lastUrl()?.searchParams.get('fixVersion')).toBe('none');
  });

  test('타임라인 버전 레인의 칩을 누르면 버전 상세로 간다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z'));
    await setup(page, {
      versions: [
        createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-07-10' }),
        // 보관·출시일 없음은 레인에 그리지 않는다.
        createVersion({ id: 2, name: '옛 버전', releaseDate: '2026-07-12', status: 'ARCHIVED' }),
        createVersion({ id: 3, name: '날짜 미정' }),
      ],
      issue: { startDate: '2026-07-01', dueDate: '2026-07-14' },
    });
    await setupTimelineStubs(page);

    await page.goto(`/projects/${KEY}/timeline?period=all`);
    await expect(page.getByTestId('timeline-gantt')).toBeVisible();
    const lane = page.getByTestId('version-lane');
    await expect(lane).toBeVisible();
    await expect(lane.getByTestId('version-chip-1')).toContainText('1.0.0');
    await expect(lane.getByTestId('version-chip-2')).toHaveCount(0);
    await expect(lane.getByTestId('version-chip-3')).toHaveCount(0);

    await lane.getByTestId('version-chip-1').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/versions/1$`));
    await expect(page.getByTestId('version-detail-page')).toBeVisible();
  });

  // 숨김/노출을 한 테스트에서 이어 돌리면 전체 화면 로드(page.goto)가 4번이라 부하에서 예산(30초)에 닿는다.
  // 같은 판정 함수(expectVersionVisibility)를 쓰는 두 테스트로 나눠 각자 예산을 갖게 한다 — 판정 코드는 한 곳이라 양성 대조는 그대로다.
  test('버전이 없으면 상세·필터·열에 버전이 보이지 않지만 머리의 「버전」 링크는 보인다', async ({ authenticatedPage: page }) => {
    await setup(page, { versions: [] });
    await expectVersionVisibility(page, false);
  });

  test('보관 안 된 버전이 있으면 같은 화면(상세·필터·열)에 버전이 나타난다', async ({ authenticatedPage: page }) => {
    await setup(page, { versions: [createVersion({ id: 1, name: '1.0.0' })] });
    await expectVersionVisibility(page, true);
  });

  test('버전이 없으면 타임라인에 버전 레인이 그려지지 않는다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z'));
    await setup(page, { versions: [], issue: { startDate: '2026-07-01', dueDate: '2026-07-14' } });
    await setupTimelineStubs(page);

    await gotoVersionsLoaded(page, `/projects/${KEY}/timeline?period=all`);
    // 마일스톤 레인이 그려진 간트가 떠 있어야 「레인 없음」 이 의미가 있다.
    await expect(page.getByTestId('timeline-gantt')).toBeVisible();
    await expect(page.getByTestId('timeline-today-line')).toBeVisible();
    await expect(page.getByTestId('version-lane')).toHaveCount(0);
  });

  test('보관된 버전은 피커에 없고 필터의 보관됨 묶음에 있다 — 이미 붙은 보관 버전만 피커에 「보관됨」으로 남는다', async ({
    authenticatedPage: page,
  }) => {
    const active = createVersion({ id: 1, name: '1.0.0' });
    const attachedArchived = createVersion({ id: 2, name: '옛 버전', status: 'ARCHIVED' });
    const otherArchived = createVersion({ id: 3, name: '폐기 버전', status: 'ARCHIVED' });
    await setup(page, {
      versions: [active, attachedArchived, otherArchived],
      issue: { fixVersions: [toVersionSummary(attachedArchived)], affectsVersions: [] },
    });

    // 상세 피커 — 보관 안 된 것 + 이 이슈에 붙은 보관만. 안 붙은 보관은 없다.
    await page.goto(`/projects/${KEY}/issues/1`);
    await expect(page.getByTestId('issue-fix-versions-field')).toBeVisible();
    await page.getByTestId('fix-version-picker-trigger').click();
    const picker = page.getByTestId('fix-version-picker');
    await expect(picker.getByTestId('fix-version-option-1')).toBeVisible();
    await expect(picker.getByTestId('fix-version-option-2')).toContainText('보관됨');
    await expect(picker.getByTestId('fix-version-option-2').getByRole('checkbox')).toBeChecked();
    await expect(picker.getByTestId('fix-version-option-3')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 필터 — 두 보관 버전 모두 「보관됨」 묶음 머리글 아래에 있다.
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-fixVersion').click();
    await expect(page.getByTestId('facet-group-fixVersion-보관됨')).toBeVisible();
    await expect(page.getByTestId('facet-value-fixVersion-1')).toBeVisible();
    await expect(page.getByTestId('facet-value-fixVersion-2')).toBeVisible();
    await expect(page.getByTestId('facet-value-fixVersion-3')).toBeVisible();
    // 보관됨 머리글은 사용 중 값 뒤에 놓인다.
    const order = await page
      .locator('[data-testid="facet-value-fixVersion-1"], [data-testid="facet-group-fixVersion-보관됨"], [data-testid="facet-value-fixVersion-2"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(order).toEqual(['facet-value-fixVersion-1', 'facet-group-fixVersion-보관됨', 'facet-value-fixVersion-2']);
  });

  test('멤버는 버전 화면에서 만들기·⋯ 메뉴가 없다', async ({ authenticatedPage: page }) => {
    // 같은 데이터로 소유자일 땐 만들기·⋯ 가 보이고(양성 대조), 일반 멤버는 읽기 전용이다.
    const server = await setup(page, { versions: [createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-12-01' })] });

    await page.goto(`/projects/${KEY}/versions`);
    await expect(page.getByTestId('version-row-1')).toBeVisible();
    await expect(page.getByTestId('version-new')).toBeVisible();
    await expect(page.getByTestId('version-menu-1')).toBeVisible();

    // 구성원 목록 응답이 반영된 뒤에 본다 — 응답 전에는 권한 판정이 비어 「없음」 이 거짓 통과한다.
    server.setMembers(PLAIN_MEMBERS);
    const members = page.waitForResponse((r) => new URL(r.url()).pathname === `${BASE}/members`);
    await page.reload();
    await members;
    await expect(page.getByTestId('version-row-1')).toBeVisible();
    await expect(page.getByTestId('version-row-1')).toContainText('1.0.0');
    await expect(page.getByTestId('version-new')).toHaveCount(0);
    await expect(page.getByTestId('version-menu-1')).toHaveCount(0);
  });

  test('버전 API 400 오류 메시지가 토스트로 보인다 — 이슈에 붙이기', async ({ authenticatedPage: page }) => {
    await setup(page, { versions: [createVersion({ id: 1, name: '1.0.0' })], issue: { fixVersions: [], affectsVersions: [] } });
    await page.route(
      (u) => u.pathname === `${BASE}/issues/1/versions`,
      (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill(
              json({ status: 400, message: '보관된 버전은 새로 붙일 수 없습니다', errors: { code: 'VERSION_ARCHIVED' } }, 400),
            )
          : route.fallback(),
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    await expect(page.getByTestId('issue-fix-versions-field')).toBeVisible();
    await page.getByTestId('fix-version-picker-trigger').click();
    await page.getByTestId('fix-version-option-1').getByRole('checkbox').check();
    await page.keyboard.press('Escape');

    await expect(page.getByText('보관된 버전은 새로 붙일 수 없습니다')).toBeVisible();
  });
});
