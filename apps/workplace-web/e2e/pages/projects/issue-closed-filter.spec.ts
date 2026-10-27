// 이슈 목록 「더 보기 › 완료일」 기간 필터 E2E (WP-873, WP-1020 빠른 필터 칩).
// 브라우저 기하가 있어야 판정되는 것만 남긴다(@layout) — 「기간 직접 지정」 달력이 팝오버 안에 다 들어가는지, 긴 칩을 걸어도 「필터 지우기」가 제자리인지.
// 프리셋 선택(단일)·교체·해제, 달력 적용, 칩 표기가 URL(closedIn)·검색 요청(closedFrom/closedTo)·칩 문구로 이어지는지는
// 페이지 테스트 src/pages/projects/issueClosedFilter.test.tsx 가 지킨다(WP-971).
// 현재 시각은 page.clock 으로 2026-10-23(금) 15:00 KST 에 고정 — 「지난 주」는 10/12(월)~10/18(일).

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';

const KEY = 'WP';

test.use({ timezoneId: 'Asia/Seoul' });

// 프로젝트 메타·이슈 검색 스텁 + 검색 요청 기록기를 돌려준다.
async function setup(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  const searches = trackRequests(page, 'GET', `/api/v1/projects/${KEY}/issues`);
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([createIssue({ number: 7 })], null)),
      });
    },
  );
  return searches;
}

// 「더 보기 › 완료일」 까지 열어 둔다(완료일은 빠른 필터 「더 보기」 소속, WP-1020).
async function openClosedFacet(page: import('@playwright/test').Page) {
  await page.getByTestId('quick-filter-more').click();
  await page.getByTestId('quick-filter-more-facet-closedIn').click();
}

// 「기간 직접 지정」 달력의 「취소」·「적용」이 팝오버 안에 온전히 보이는가 — 클릭 전에 본다(클릭은 스크롤해 버려 잘림을 가린다).
// boundingBox 는 overflow 잘림을 모르므로 팝오버 상자 안에 드는지와, 버튼 아래끝 바로 위 점이 실제로 그 버튼을 가리키는지를 함께 본다.
// 점 검사는 「취소」로 한다 — 날짜를 고르기 전 「적용」은 비활성(pointer-events 없음)이라 elementFromPoint 가 지나친다.
async function expectApplyFullyVisible(page: import('@playwright/test').Page) {
  const apply = page.getByTestId('date-range-apply');
  const content = page.locator('[data-slot="popover-content"]').filter({ has: apply });
  const [a, c] = [await apply.boundingBox(), await content.boundingBox()];
  expect(a && c).toBeTruthy();
  expect(a!.y).toBeGreaterThanOrEqual(c!.y);
  expect(a!.y + a!.height).toBeLessThanOrEqual(c!.y + c!.height);
  expect(a!.x + a!.width).toBeLessThanOrEqual(c!.x + c!.width);
  const hit = await page.getByTestId('date-range-cancel').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
    return target != null && el.contains(target);
  });
  expect(hit).toBe(true);
}

test.describe('이슈 목록 — 완료일 기간 필터', () => {
  test('「기간 직접 지정」 달력은 팝오버 안에 다 들어간다 — 「더 보기」와 칩 편집 모두 취소·적용이 잘리지 않는다', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await openClosedFacet(page);
    await page.getByTestId('closed-range-open').click();
    await expect(page.getByTestId('date-range-panel')).toBeVisible();
    await expectApplyFullyVisible(page);
    await expect(page.getByTestId('date-range-cancel')).toBeVisible();
    // 달력을 펼치면 프리셋 목록은 접힌다 — 팝오버가 화면 높이를 넘지 않게. 취소하면 다시 보인다.
    await expect(page.getByTestId('facet-value-closedIn-last-week')).toHaveCount(0);
    await page.getByTestId('date-range-cancel').click();
    await expect(page.getByTestId('facet-value-closedIn-last-week')).toBeVisible();
    await page.keyboard.press('Escape');

    // 칩 편집 팝오버 — 같은 목록·달력을 쓴다.
    await page.goto(`/projects/${KEY}?closedIn=2026-10-01~2026-10-10`);
    await page.getByTestId('quick-filter-closedIn-trigger').click();
    await page.getByTestId('closed-range-open').click();
    await expect(page.getByTestId('date-range-panel')).toBeVisible();
    await expectApplyFullyVisible(page);
  });

  // 무엇을: 완료일 칩처럼 긴 칩을 걸어도 「필터 지우기」 가 「더 보기」 바로 옆에 붙어 있는지 — 1280·1024, 칩 1개·2개.
  // 왜: 「초기화」 가 막대 맨 끝(뷰 전환 뒤)에 있어, 1280 폭에서 완료일 칩만 걸어도 줄이 넘쳐 그것만 아랫줄 왼쪽으로 떨어졌다(WP-931).
  //     빠른 필터 칩(WP-1020)은 기본 칩이 다섯 개라 좁은 폭에선 칩 줄이 꺾일 수 있다 — 그래도 「필터 지우기」 는 「더 보기」 와 한 덩어리다.
  test('필터 줄 — 긴 칩을 걸어도 「필터 지우기」 는 「더 보기」 바로 옆에 있다(1280·1024)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await setup(page);
    const main = page.getByTestId('issue-filter-main');
    const centerY = (b: { y: number; height: number }) => b.y + b.height / 2;
    for (const [width, query] of [
      [1280, 'closedIn=last-week'],
      [1280, 'priority=HIGH&closedIn=2026-10-01~2026-10-23'],
      [1024, 'closedIn=last-week'],
      [1024, 'priority=HIGH&closedIn=2026-10-01~2026-10-23'],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/projects/${KEY}?${query}`);
      await expect(page.getByTestId('issue-row-7')).toBeVisible();
      const [r, add] = await Promise.all([
        main.getByRole('button', { name: '필터 지우기' }).boundingBox(),
        main.getByTestId('quick-filter-more').boundingBox(),
      ]);
      // 같은 줄(세로 가운데가 같다)이고, 「더 보기」 바로 오른쪽이다.
      expect(Math.abs(centerY(r!) - centerY(add!))).toBeLessThanOrEqual(2);
      expect(r!.x).toBeGreaterThan(add!.x + add!.width);
      expect(r!.x - (add!.x + add!.width)).toBeLessThanOrEqual(16);
    }
  });
});
