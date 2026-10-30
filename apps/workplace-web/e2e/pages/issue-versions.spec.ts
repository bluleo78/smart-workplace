// 프로젝트 버전(WP-888) 화면 E2E — 브라우저가 있어야 판정되는 것만 남긴다(WP-971 판정 태그).
// - @wiring: 버전 목록(만들기 → 행)·버전 상세(나가는 이슈 묶음) 화면이 라우트 → API → 화면으로 이어진다(화면당 1건).
// - @flow: 목록 필터 → URL → 새로고침 뒤 요청(+@platform), 타임라인 버전 칩 → 버전 상세 이동처럼 화면을 넘는 흐름.
// 브라우저 없이 판정되는 검사는 페이지 테스트(MSW)로 옮겼다:
// - 출시 대화상자 → release 본문(moveUnresolvedTo 유무)·멤버 읽기 전용 → src/pages/projects/versions/versionManage.test.tsx
// - 상세 피커 → PUT fixVersionIds·400 오류 토스트·보관 버전 피커 규칙 → src/components/versions/issueVersions.test.tsx
// - 버전이 없을 때 상세·필터·열·타임라인 레인 숨김(있을 때 노출)·필터 「보관됨」 묶음 → src/pages/projects/versionVisibility.test.tsx
// 서버 쪽 규칙(유일성·보관 차단·잠금)은 백엔드 통합 테스트가 맡는다.
// 버전 목록은 상태를 가진 모킹 — 만들기 뒤 재조회가 바뀐 목록을 받아야 화면이 거기에 맞게 바뀐다.
import type { Page } from '@playwright/test';

import type { IssueResponse } from '../../src/types/issue';
import type { VersionResponse } from '../../src/types/version';
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

interface SetupOptions {
  versions?: VersionResponse[];
  /** 이슈 목록·상세에 쓸 이슈(번호 1). */
  issue?: Partial<IssueResponse>;
  /** 버전 상세가 읽는 이슈 — fixVersion/affectsVersion 파라미터가 있는 검색에 이 목록을 돌려준다. */
  fixIssues?: IssueResponse[];
  affectsIssues?: IssueResponse[];
}

/**
 * 버전 화면이 부르는 API 를 한꺼번에 모킹한다. 버전 목록은 서버처럼 상태를 들고 있다 —
 * 추가(POST)는 새 행을 만든다.
 */
async function setup(page: Page, opts: SetupOptions = {}) {
  let list = [...(opts.versions ?? [])];
  let nextId = 900;
  const issue = createIssue({ id: 1, number: 1, title: '결제 모듈 개편', ...opts.issue });

  await page.route(`**${BASE}`, (route) => route.fulfill(json(createProject())));
  await page.route(`**${BASE}/members`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(OWNER_MEMBERS)) : route.fallback(),
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
    { tag: ['@wiring', '@smoke'] },
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

  // QA 재현 두 가지(WP-1137) — 모바일은 공백 있는 27자 이름, 데스크톱은 이름 상한(40자)을 꽉 채운 공백 없는 이름에서(제목도 줄을 바꿔야 한다) 넘쳤다.
  for (const c of [
    { label: '모바일', viewport: { width: 390, height: 844 }, name: '2026년 4분기 정기 릴리스 모바일·웹 동시 배포' },
    { label: '데스크톱', viewport: { width: 1280, height: 800 }, name: '2026년4분기정기릴리스모바일·웹동시배포및핫픽스후속점검과회귀확인전용버전' },
  ]) {
    test(`${c.label}: 출시·삭제 창은 긴 버전 이름이 있어도 내용을 창 폭 안에 두고 옮길 버전 칸을 말줄임으로 자른다(WP-1137)`, { tag: '@layout' }, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize(c.viewport);
      await setup(page, {
        versions: [
          createVersion({ id: 1, name: '1.0.0' }),
          createVersion({ id: 2, name: c.name }),
          createVersion({ id: 3, name: '0.9.0', status: 'ARCHIVED' }),
        ],
      });
      // 끝나지 않은·붙은 이슈가 있어야 「옮길 버전」 칸이 보인다.
      await page.route(
        (u) => /\/versions\/\d+\/issue-count$/.test(u.pathname),
        (route) => route.fulfill(json({ fix: 2, affects: 1, unresolvedFix: 2 })),
      );
      await page.goto(`/projects/${KEY}/versions`);

      /** 창 내용이 창보다 넓어지지 않았는지(scrollWidth ≤ clientWidth), 고른 칸의 이름이 말줄임으로 잘렸는지 본다. */
      const measure = (dialogId: string, triggerId: string) =>
        page.evaluate(
          ([d, t]) => {
            const dialog = document.querySelector(`[data-testid="${d}"]`)!;
            const value = document.querySelector<HTMLElement>(`[data-testid="${t}"] [data-slot="select-value"]`)!;
            return {
              fits: dialog.scrollWidth <= dialog.clientWidth,
              ellipsis: getComputedStyle(value).textOverflow === 'ellipsis' && value.scrollWidth > value.clientWidth,
            };
          },
          [dialogId, triggerId],
        );

      // 출시 — 옮길 버전 기본값이 긴 이름(다음 미출시 버전)이다.
      await page.getByTestId('version-menu-1').click();
      await page.getByTestId('version-action-release').or(page.getByTestId('mobile-action-release')).click();
      await expect(page.getByTestId('version-release-target')).toContainText(c.name.slice(0, 6));
      expect(await measure('version-release-dialog', 'version-release-target')).toEqual({ fits: true, ellipsis: true });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('version-release-dialog')).toHaveCount(0);

      // 삭제 — 보관한 버전을 지우며 긴 이름 버전으로 옮긴다.
      await page.getByTestId('version-archived-toggle').click();
      await page.getByTestId('version-menu-3').click();
      await page.getByTestId('version-action-delete').or(page.getByTestId('mobile-action-delete')).click();
      await page.getByRole('radio', { name: '다른 버전으로 옮기기' }).click();
      await page.getByTestId('version-delete-target').click();
      await page.getByRole('option', { name: c.name }).click();
      await expect(page.getByTestId('version-delete-target')).toContainText(c.name.slice(0, 6));
      expect(await measure('version-delete-dialog', 'version-delete-target')).toEqual({ fits: true, ellipsis: true });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('version-delete-dialog')).toHaveCount(0);

      // 긴 이름 버전 자신을 출시하면 제목이 줄을 바꾸되 닫기(X) 버튼과 겹치지 않는다.
      await page.getByTestId('version-menu-2').click();
      await page.getByTestId('version-action-release').or(page.getByTestId('mobile-action-release')).click();
      await expect(page.getByTestId('version-release-dialog').getByRole('heading')).toContainText(c.name.slice(0, 6));
      // 옮길 버전 칸은 이 버전의 이슈 수 조회(버전마다 새 조회)가 끝나야 그려진다 — 제목만 기다리고 재면 응답이 늦을 때 칸이 없어 깨졌다(WP-1230).
      await expect(page.getByTestId('version-release-target').locator('[data-slot="select-value"]')).toBeVisible();
      // 제목 상자는 오른쪽 여백을 포함하므로 글자가 실제로 그려진 끝(Range)과 닫기 버튼 왼쪽을 비교한다.
      const { textRight, closeLeft } = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="version-release-dialog"]')!;
        const range = document.createRange();
        range.selectNodeContents(dialog.querySelector('h2')!);
        const closeBtn = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('닫기'))!;
        return { textRight: range.getBoundingClientRect().right, closeLeft: closeBtn.getBoundingClientRect().left };
      });
      expect(textRight).toBeLessThanOrEqual(closeLeft);
      expect((await measure('version-release-dialog', 'version-release-target')).fits).toBe(true);
    });
  }

  test('버전 상세는 나가는 이슈를 유형별로 묶고 영향 버전 탭을 따로 보인다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
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

  // 필터 → URL → 새로고침 뒤에도 같은 요청 — 화면 상태가 주소를 거쳐 실제 새로고침을 넘는다(@flow·@platform).
  test(
    '수정 버전 필터를 고르면 목록 요청에 fixVersion 이 실리고 URL 에 남는다 — 「수정 버전 없음」은 none',
    { tag: ['@flow', '@platform'] },
    async ({ authenticatedPage: page }) => {
      await setup(page, { versions: [createVersion({ id: 1, name: '1.0.0' }), createVersion({ id: 2, name: '1.1.0' })] });
      // 이슈 목록 요청만 — 같은 경로로 가는 에픽 패널 요청(type=6)은 제외한다.
      const searches = trackRequests(page, 'GET', (u) => u.pathname === `${BASE}/issues` && !u.searchParams.has('type'));

      await page.goto(`/projects/${KEY}?group=none`);
      await expect(page.getByTestId('issue-row-1')).toBeVisible();
      expect(searches.lastUrl()?.searchParams.has('fixVersion')).toBe(false);

      // 수정 버전은 빠른 필터 「더 보기」 소속(WP-1020).
      await page.getByTestId('quick-filter-more').click();
      await page.getByTestId('quick-filter-more-facet-fixVersion').click();
      await expect(page.getByTestId('facet-value-fixVersion-1')).toContainText('1.0.0');
      await page.getByTestId('facet-value-fixVersion-1').click();
      await page.getByTestId('facet-value-fixVersion-2').click();
      await page.keyboard.press('Escape');

      await expect(page).toHaveURL(/fixVersion=1(%2C|,)2/);
      await expect.poll(() => searches.lastUrl()?.searchParams.get('fixVersion')).toBe('1,2');
      await expect(page.getByTestId('quick-filter-fixVersion')).toHaveAttribute('data-active', 'true');

      // 새로고침해도 URL 의 필터가 그대로 요청에 실린다 — 새로고침 뒤에 나간 요청만 본다(이전 요청이 남아 거짓 통과하지 않게).
      const before = searches.count();
      const reloaded = page.waitForRequest(
        (r) => new URL(r.url()).pathname === `${BASE}/issues` && !new URL(r.url()).searchParams.has('type'),
      );
      await page.reload();
      expect(new URL((await reloaded).url()).searchParams.get('fixVersion')).toBe('1,2');
      expect(searches.count()).toBeGreaterThan(before);
      await expect(page.getByTestId('quick-filter-fixVersion')).toHaveAttribute('data-active', 'true');

      // 둘을 풀고 「수정 버전 없음」 → none.
      await page.getByTestId('quick-filter-fixVersion-remove').click();
      await expect(page).not.toHaveURL(/fixVersion=/);
      await page.getByTestId('quick-filter-more').click();
      await page.getByTestId('quick-filter-more-facet-fixVersion').click();
      await page.getByTestId('facet-value-fixVersion-none').click();
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/fixVersion=none/);
      await expect.poll(() => searches.lastUrl()?.searchParams.get('fixVersion')).toBe('none');
    },
  );

  test('타임라인 버전 레인의 칩을 누르면 버전 상세로 간다', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z'));
    await setup(page, {
      // 레인에 무엇을 그리는지(보관·출시일 없음 제외)는 페이지 테스트(versionVisibility.test.tsx)가 본다.
      versions: [createVersion({ id: 1, name: '1.0.0', releaseDate: '2026-07-10' })],
      issue: { startDate: '2026-07-01', dueDate: '2026-07-14' },
    });
    await setupTimelineStubs(page);

    await page.goto(`/projects/${KEY}/timeline?period=all`);
    await expect(page.getByTestId('timeline-gantt')).toBeVisible();
    const lane = page.getByTestId('version-lane');
    await expect(lane).toBeVisible();
    await expect(lane.getByTestId('version-chip-1')).toContainText('1.0.0');

    await lane.getByTestId('version-chip-1').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/versions/1$`));
    await expect(page.getByTestId('version-detail-page')).toBeVisible();
  });

  // WP-1047 — 출시일이 하루 이틀 차이인 버전 칩이 겹침 피하기로 줄줄이 밀려 다른 날짜(다음 달)로 읽혔다. 가까운 버전은 대표 칩
  // 하나로 묶고, 칩 꼬리는 늘 대표 버전의 출시일 점을 가리키며, 보기(일·주·월)를 바꿔도 칩끼리 겹치지 않는다. 좌표는 jsdom 이
  // 잴 수 없어 E2E 로 본다(묶음 판정·목록 문구는 timelineData.test.ts·versionVisibility.test.tsx).
  test('출시일이 가까운 버전 칩은 보기마다 겹치지 않고 꼬리가 대표 버전의 출시일 점을 가리킨다', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z'));
    // 7/1~7/12 매일 릴리스(7/4·7/9 는 없음).
    const days = [1, 2, 3, 5, 6, 7, 8, 10, 11, 12];
    await setup(page, {
      versions: days.map((d, i) =>
        createVersion({ id: i + 1, name: `v0.9.${i + 1}`, releaseDate: `2026-07-${String(d).padStart(2, '0')}`, status: 'RELEASED' }),
      ),
      issue: { startDate: '2026-07-01', dueDate: '2026-07-14' },
    });
    await setupTimelineStubs(page);
    await page.goto(`/projects/${KEY}/timeline?period=all`);
    const lane = page.getByTestId('version-lane');
    await expect(lane).toBeVisible();

    /** 레인의 칩(왼쪽부터)과 각 칩 꼬리의 X 중심, 출시일 점의 X 중심. */
    const measure = () =>
      lane.evaluate((el) => {
        const center = (r: DOMRect) => r.left + r.width / 2;
        const chips = [...el.querySelectorAll<HTMLElement>('[data-testid^="version-chip-"]')]
          .filter((chip) => getComputedStyle(chip).visibility !== 'hidden')
          .map((chip) => {
            const r = chip.getBoundingClientRect();
            const tail = chip.querySelector('[data-lane-tail]')!.getBoundingClientRect();
            return { left: r.left, right: r.right, tail: center(tail) };
          })
          .sort((a, b) => a.left - b.left);
        const dots = [...el.querySelectorAll<HTMLElement>('[data-testid^="version-dot-"]')].map((dot) => center(dot.getBoundingClientRect()));
        return { chips, dots };
      });

    const zoom = (label: string) => page.getByRole('group', { name: '줌 전환' }).getByRole('button', { name: label, exact: true });
    const chipCounts: Record<string, number> = {};
    for (const label of ['일', '주', '월']) {
      await zoom(label).click();
      await expect(zoom(label)).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(async () => {
          const { chips, dots } = await measure();
          const apart = chips.every((chip, i) => i === 0 || chip.left >= chips[i - 1].right);
          // 꼬리는 칩 아래에 붙어 있고(칩 밖으로 밀려나지 않음) 대표 버전의 출시일 점 바로 위다.
          const pointsAtDot = chips.every(
            (chip) => chip.tail >= chip.left && chip.tail <= chip.right && dots.some((dot) => Math.abs(dot - chip.tail) <= 1.5),
          );
          return chips.length > 0 && apart && pointsAtDot;
        }, { message: `${label} 보기: 칩이 겹치지 않고 꼬리가 출시일 점을 가리킨다` })
        .toBe(true);
      chipCounts[label] = (await measure()).chips.length;
    }
    // 일 보기는 하루가 넓어 여러 칩으로 나뉘고, 주·월 보기는 열흘 남짓이 칩 하나로 모인다.
    expect(chipCounts['일']).toBeGreaterThan(1);
    expect(chipCounts['주']).toBe(1);
    expect(chipCounts['월']).toBe(1);
  });

  test('축이 차트보다 좁아 칸이 늘어난 월 보기에서는 늘어난 폭으로 버전 칩을 묶는다', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z'));
    // 넓은 화면 + 기간을 크게 넘는 막대 → 축을 「분기 앞 12개월 ~ 막대 끝」(13개월, 월 보기 1300px)으로 자르고(WP-595),
    // 차트가 그보다 넓어 SVAR 가 칸을 약 1.7배로 늘린다.
    await page.setViewportSize({ width: 3000, height: 900 });
    await setup(page, {
      versions: [
        createVersion({ id: 1, name: 'v1.0.0', releaseDate: '2026-07-02', status: 'RELEASED' }),
        createVersion({ id: 2, name: 'v1.1.0', releaseDate: '2026-07-27', status: 'UNRELEASED' }),
      ],
      issue: { startDate: '1990-01-01', dueDate: '2026-07-14' },
    });
    await setupTimelineStubs(page);
    await page.goto(`/projects/${KEY}/timeline?period=quarter`);
    const zoom = page.getByRole('group', { name: '줌 전환' }).getByRole('button', { name: '월', exact: true });
    await zoom.click();
    await expect(zoom).toHaveAttribute('aria-pressed', 'true');
    // 25일 간격은 늘리지 않은 월 칸(하루 약 3.3px)이면 82px 라 한 칩으로 묶이지만, 늘어난 칸(약 5.7px)에선 140px 남짓이라 따로 선다.
    const lane = page.getByTestId('version-lane');
    await expect(lane.getByTestId(/^version-chip-/)).toHaveCount(2);
  });
});
