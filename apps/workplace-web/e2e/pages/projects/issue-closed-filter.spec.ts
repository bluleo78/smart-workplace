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

  // 무엇을: 완료일 칩처럼 긴 칩을 걸어도 「필터 지우기」 가 줄 안에 보이는지 — 1440·1280·1024, 칩 1개·2개, 키워드 입력 포함.
  // 왜: 「초기화」 가 막대 맨 끝(뷰 전환 뒤)에 있어, 1280 폭에서 완료일 칩만 걸어도 줄이 넘쳐 그것만 아랫줄 왼쪽으로 떨어졌다(WP-931).
  //     빠른 필터 칩(WP-1020)은 기본 칩이 다섯 개라 좁은 폭에선 넘친다 — 꺾지 않고 칩 묶음만 가로 스크롤하며(WP-1355),
  //     「필터 지우기」 는 칩 스크롤 밖(clear 슬롯)에 고정돼 늘 보이고, 넘친 칩은 오른쪽 페이드가 알린다.
  test('필터 줄 — 긴 칩·키워드를 걸어도 「필터 지우기」 는 줄 안에 보이고 칩 묶음은 한 줄이다(1440·1280·1024)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await setup(page);
    const main = page.getByTestId('issue-filter-main');
    for (const [width, query] of [
      [1440, 'closedIn=last-week&q=abc'],
      [1280, 'closedIn=last-week'],
      [1280, 'priority=HIGH&closedIn=2026-10-01~2026-10-23&q=abc'],
      [1024, 'closedIn=last-week'],
      [1024, 'priority=HIGH&closedIn=2026-10-01~2026-10-23&q=abc'],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/projects/${KEY}?${query}`);
      await expect(page.getByTestId('issue-row-7')).toBeVisible();
      const r = await main.getByRole('button', { name: '필터 지우기' }).boundingBox();
      const line = await main.boundingBox();
      // 「필터 지우기」 는 줄 폭 안에 완전히 들어온다(스크롤에 잘리지 않는다)
      expect(r!.x).toBeGreaterThanOrEqual(line!.x);
      expect(r!.x + r!.width).toBeLessThanOrEqual(line!.x + line!.width + 1);
      // 칩 묶음은 줄바꿈하지 않는다 — 넘치면 칩 묶음만 가로 스크롤(필터 줄 규칙 5, WP-1355). 칩 높이(h-8) 한 줄 높이다.
      const bar = await main.getByTestId('quick-filter-bar').boundingBox();
      expect(bar!.height).toBeLessThanOrEqual(36);
      // 칩이 넘치면 가려진 쪽을 알리는 페이드가 떠 있다(안 넘치면 페이드 없음)
      const overflow = await main.getByTestId('quick-filter-bar').evaluate((el) => {
        const sc = el.parentElement!;
        return sc.scrollWidth > sc.clientWidth + 1;
      });
      await expect(main.getByTestId('filter-line-chips-fade')).toHaveCount(overflow ? 1 : 0);
    }
  });
  // 무엇을: 줄이 모자라도 칩은 늘 다 보이고, 끝 묶음만 둘째 줄 오른쪽으로 내려가는지 — 1440·1024 는 내려가고 1920 은 한 줄(WP-1355 결정).
  // 왜: 끝 묶음(완료 모두 보기·그룹·정렬·열·보기)이 넓어 칩 스크롤 영역이 짓눌려 「우선순위」·「더 보기」가 흐림 뒤로 숨었다.
  test('필터 줄 — 칩은 늘 다 보이고 줄이 모자라면 끝 묶음만 둘째 줄 오른쪽으로 내려간다(1440·1024·1920)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await setup(page);
    const main = page.getByTestId('issue-filter-main');
    for (const width of [1440, 1024, 1920] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/projects/${KEY}?q=abc`);
      await expect(page.getByTestId('issue-row-7')).toBeVisible();
      // 칩 묶음의 모든 칩(「더 보기」 포함)이 칩 스크롤 영역의 보이는 사각형 안에 있다
      const bar = main.getByTestId('quick-filter-bar');
      await expect(main.getByTestId('quick-filter-more')).toBeVisible();
      const hidden = await bar.evaluate((el) => {
        const sc = el.parentElement!.getBoundingClientRect();
        return Array.from(el.querySelectorAll('button')).filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && (r.left < sc.left - 1 || r.right > sc.right + 1);
        }).length;
      });
      expect(hidden).toBe(0);
      await expect(main.getByTestId('filter-line-chips-fade')).toHaveCount(0);
      // 「더 보기」 가 실제로 그 자리의 맨 위 요소다(흐림·다른 요소에 덮이지 않는다)
      const covered = await main.getByTestId('quick-filter-more').evaluate((el) => {
        const r = el.getBoundingClientRect();
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(t && el.contains(t));
      });
      expect(covered).toBe(false);
      // 끝 묶음(= 필터 지우기 앞의 마지막 칸)은 같은 줄이거나 아래이며, 아래로 내려가면 오른쪽 끝에 붙는다
      const clear = await main.getByTestId('filter-line-clear').boundingBox();
      const more = await main.getByTestId('quick-filter-more').boundingBox();
      const line = await main.boundingBox();
      const wrapped = clear!.y > more!.y + more!.height / 2;
      if (width === 1920) expect(wrapped).toBe(false);
      else expect(clear!.x + clear!.width).toBeGreaterThan(line!.x + line!.width - 40);
      if (wrapped) expect(clear!.x + clear!.width).toBeGreaterThan(line!.x + line!.width - 40);
    }
  });
});
