// 이슈 목록 에픽 그룹 E2E (WP-194) — 실제 레이아웃이 필요한 것만 남긴다(@layout).
// 남는 것: 그룹을 모두 접어 sentinel 이 화면에 들어와도 다음 페이지를 연쇄 로드하지 않음(뷰포트 교차), 긴 제목·에픽명에서 칩·제목 폭.
// 그룹 셀렉트 → URL group=epic, 헤더 접기/펼치기, 에픽 칩 숨김(hideEpic)은 페이지 테스트
// src/pages/projects/issueListEpicGroup.test.tsx 가 지킨다(WP-980).

import type { Page } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { expectStays, measureBox } from '../../fixtures/wait';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;

const epic = (number: number, title: string) => ({ number, title, type: makeEpicType() });

test.describe('이슈 목록 그룹 접기 + 무한 스크롤', { tag: '@layout' }, () => {
  test('모든 그룹을 접어도 다음 페이지를 연쇄 로드하지 않고, 펼치면 다시 로드한다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject());
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, []);
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/saved-views`, []);
    // 1페이지: 에픽 2개 × 40건 — 뷰포트를 충분히 채워 초기에는 sentinel 이 보이지 않는다. nextCursor 있음.
    const page1 = Array.from({ length: 80 }, (_, i) =>
      createIssue({ id: i + 1, number: i + 1, title: `이슈 ${i + 1}`, parent: i < 40 ? epic(30, '에픽 A') : epic(12, '에픽 B') }),
    );
    const page2 = [createIssue({ id: 200, number: 200, title: '2페이지 이슈', parent: epic(30, '에픽 A') })];
    const page2Requests = trackRequests(page, 'GET', (u) => u.pathname === ISSUES_PATH && u.searchParams.has('cursor'));
    await page.route(
      (url) => url.pathname === ISSUES_PATH,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const hasCursor = new URL(route.request().url()).searchParams.has('cursor');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(hasCursor ? createIssueSearchResponse(page2, null) : createIssueSearchResponse(page1, 'c1')),
        });
      },
    );
    await page.goto(`/projects/${KEY}?group=epic`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    // 양성 대조 — 행이 화면을 채운 동안엔 2페이지를 로드하지 않는다.
    // 창은 sentinel 이 마운트되고 IntersectionObserver 판정(화면 밖)이 한 번 돈 뒤에 연다.
    const sentinel = page.getByTestId('issue-list-more');
    await expect(sentinel).toBeAttached();
    await expect(sentinel).not.toBeInViewport();
    await expectStays(page, page2Requests.count, 0);

    await page.getByTestId('list-group-toggle-epic-12').click();
    await page.getByTestId('list-group-toggle-epic-30').click();
    await expect(page.getByTestId('issue-row-1')).toHaveCount(0);
    // 전부 접힘 → sentinel 이 보여도 2페이지를 로드하지 않는다
    await expect(sentinel).toBeInViewport();
    await expectStays(page, page2Requests.count, 0);

    await page.getByTestId('list-group-toggle-epic-30').click();
    // 펼친 행이 화면을 채우므로 목록 끝까지 스크롤해 sentinel 을 노출 → 정상 재개
    await page.getByTestId('issue-list-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page2Requests.waitFor();
  });
});

test.describe('이슈 목록 데스크톱 에픽 칩', { tag: '@layout' }, () => {
  test('긴 제목·긴 에픽명에도 가로 오버플로 없이 칩이 보이고 제목이 최소 폭을 지킨다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject());
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, []);
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/saved-views`, []);
    const issue = createIssue({
      id: 21,
      number: 21,
      title: '결제 모듈에서 환불 처리 시 간헐적으로 실패하는 문제의 원인을 분석하고 재시도 로직을 보강한다 — 운영 로그 기준 재현',
      parent: epic(30, '결제 안정화 및 운영 모니터링 체계 정비 (2026 하반기 핵심 과제) — 매우 긴 에픽 이름'),
      childCount: 3,
      childDoneCount: 1,
      dueDate: '2026-10-10',
      assignees: [1, 2, 3, 4].map((id) => ({ id, username: `u${id}`, name: `사용자${id}`, kind: 'HUMAN' as const })),
    });
    await page.route(
      (url) => url.pathname === ISSUES_PATH,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([issue])),
        });
      },
    );
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/projects/${KEY}?group=none`);
      const row = page.getByTestId('issue-row-21');
      const chip = row.getByTestId('issue-row-21-parent');
      await expect(chip).toBeVisible();
      // 첫 렌더 직후 표 배치가 자리 잡기 전 값을 잴 수 있어 측정·단언 묶음을 재시도한다(WP-225).
      await expect(async () => {
        // (a) 가로 스크롤 없음 — 긴 제목이 표를 밀어내지 않는다.
        const scroll = page.getByTestId('issue-list-scroll');
        const { sw, cw } = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect(sw, `${width}px 목록 가로 오버플로`).toBeLessThanOrEqual(cw);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        // (b) 제목은 최소 8rem 보장
        const link = row.getByRole('link', { name: /결제 모듈/ });
        expect((await measureBox(link)).width).toBeGreaterThanOrEqual(128);
        // (c) 칩이 스크롤 영역 오른쪽 끝 안에 있다.
        const sb = await measureBox(scroll);
        const cb = await measureBox(chip);
        expect(cb.x + cb.width).toBeLessThanOrEqual(sb.x + sb.width + 1);
        // (d) 제목 칸이 폭을 가져가도 마감 날짜는 한 줄로(글자 단위로 꺾이지 않는다).
        // 텍스트 줄 수 = 날짜 글자 노드 Range 의 클라이언트 사각형 수(한 줄이면 1). 마감이 지나면 붙는
        // 스크린리더 전용 「마감 지남」(sr-only, WP-649)은 화면에 안 보이므로 재지 않는다.
        const dueLines = await row.getByTestId('issue-row-21-due').evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el.firstChild!);
          return r.getClientRects().length;
        });
        expect(dueLines, `${width}px 마감 칸 줄바꿈`).toBe(1);
        // (e) ID 칸이 최소 내용폭으로 쪼그라들어 「WP-21」 이 제목에 붙지 않는다 — 한 줄 + 제목과 8px 이상 간격.
        const idText = row.getByText(`${KEY}-21`, { exact: true });
        const ib = await measureBox(idText);
        expect(ib.height, `${width}px ID 줄바꿈`).toBeLessThan(24);
        const lb = await measureBox(link);
        expect(lb.x - (ib.x + ib.width), `${width}px ID-제목 간격`).toBeGreaterThanOrEqual(8);
      }).toPass();
    }
  });
});
