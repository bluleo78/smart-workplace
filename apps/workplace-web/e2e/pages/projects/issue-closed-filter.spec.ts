// 이슈 목록 「＋ 필터 › 완료일」 기간 필터 E2E (WP-873).
// 무엇을: 완료일 facet 의 프리셋 선택(단일)·교체·해제, 「기간 직접 지정」 달력 적용이 URL(closedIn)·검색 요청(closedFrom/closedTo)·칩 문구로 이어지는지.
// 왜: 프리셋은 URL 에 토큰만 담고 조회 시점에 날짜로 풀리므로, 화면·URL·서버 요청 세 곳이 어긋나지 않는지 한 번에 확인해야 한다.
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

// 「＋ 필터 › 완료일」 까지 열어 둔다.
async function openClosedFacet(page: import('@playwright/test').Page) {
  await page.getByTestId('add-filter-trigger').click();
  await page.getByTestId('add-filter-facet-closedIn').click();
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
  test('「지난 주」 선택 → URL·요청·칩에 반영, 다른 프리셋은 대체, ✕ 로 해제', async ({ authenticatedPage: page }) => {
    const searches = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await openClosedFacet(page);
    // 프리셋 라벨에 날짜 범위가 함께 보인다.
    await expect(page.getByTestId('facet-value-closedIn-last-week')).toContainText('지난 주 (10/12–10/18)');
    await page.getByTestId('facet-value-closedIn-last-week').click();

    await expect(page).toHaveURL(/closedIn=last-week/);
    await expect(page.getByTestId('filter-chip-closedIn')).toHaveText('완료일:지난 주 (10/12–10/18)');
    await expect.poll(() => searches.lastUrl()?.searchParams.get('closedFrom')).toBe('2026-10-12');
    expect(searches.lastUrl()!.searchParams.get('closedTo')).toBe('2026-10-18');
    // 완료일 범위를 걸면 종료 이슈 숨김은 풀린다.
    expect(searches.lastUrl()!.searchParams.has('hideInactiveClosed')).toBe(false);

    // 단일 선택 — 다른 프리셋을 고르면 대체된다(값은 1개, 이전 체크 해제).
    await page.getByTestId('facet-value-closedIn-this-month').click();
    await expect(page).toHaveURL(/closedIn=this-month/);
    await expect(page).not.toHaveURL(/last-week/);
    await expect(page.getByTestId('filter-chip-closedIn')).toHaveText('완료일:이번 달 (10/1–10/23)');
    await expect(page.getByTestId('facet-value-closedIn-last-week').getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByTestId('facet-value-closedIn-this-month').getByRole('checkbox')).toBeChecked();
    await expect.poll(() => searches.lastUrl()?.searchParams.get('closedFrom')).toBe('2026-10-01');

    // 같은 프리셋을 다시 누르면 해제.
    await page.getByTestId('facet-value-closedIn-this-month').click();
    await expect(page.getByTestId('filter-chip-closedIn')).toHaveCount(0);
    await expect(page).not.toHaveURL(/closedIn=/);

    // 칩 ✕ 로 해제 → 요청에서 closedFrom 이 사라진다. 캐시된 「필터 없음」 응답을 쓰지 않도록 필터가 걸린 채 새로 연다.
    await page.goto(`/projects/${KEY}?closedIn=today`);
    await expect.poll(() => searches.lastUrl()?.searchParams.get('closedFrom')).toBe('2026-10-23');
    await expect(page.getByTestId('filter-chip-closedIn')).toHaveText('완료일:오늘 (10/23)');
    await page.getByTestId('filter-chip-closedIn-remove').click();
    await expect(page.getByTestId('filter-chip-closedIn')).toHaveCount(0);
    await expect(page).not.toHaveURL(/closedIn=/);
    await expect.poll(() => searches.lastUrl()?.searchParams.has('closedFrom')).toBe(false);
    expect(searches.lastUrl()!.searchParams.has('closedTo')).toBe(false);
  });

  test('「기간 직접 지정」 — 달력에서 10/1~10/10 을 골라 적용', async ({ authenticatedPage: page }) => {
    const searches = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await openClosedFacet(page);
    await page.getByTestId('closed-range-open').click();
    // 달력으로 바뀌고 아직 고른 날이 없으면 「적용」은 잠겨 있다(같은 팝오버 안 — 중첩 팝오버 아님).
    const panel = page.getByTestId('date-range-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('date-range-apply')).toBeDisabled();

    await panel.getByRole('button', { name: /2026년 10월 1일/ }).click();
    await panel.getByRole('button', { name: /2026년 10월 10일/ }).click();
    await expect(page.getByTestId('date-range-summary')).toHaveText('10/1–10/10');
    await page.getByTestId('date-range-apply').click();

    // URLSearchParams 가 ~ 를 %7E 로 인코딩하므로 디코딩한 값으로 비교한다.
    await expect.poll(() => new URL(page.url()).searchParams.get('closedIn')).toBe('2026-10-01~2026-10-10');
    await expect(page.getByTestId('filter-chip-closedIn')).toHaveText('완료일:10/1–10/10');
    await expect.poll(() => searches.lastUrl()?.searchParams.get('closedFrom')).toBe('2026-10-01');
    expect(searches.lastUrl()!.searchParams.get('closedTo')).toBe('2026-10-10');
    expect(searches.lastUrl()!.searchParams.has('hideInactiveClosed')).toBe(false);
  });

  test('「기간 직접 지정」 — 하루만 고르면 요약·칩에 날짜가 한 번만 보인다', async ({ authenticatedPage: page }) => {
    const searches = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await openClosedFacet(page);
    await page.getByTestId('closed-range-open').click();
    const panel = page.getByTestId('date-range-panel');
    await panel.getByRole('button', { name: /2026년 10월 5일/ }).click();
    // 끝 날짜를 안 고르면 하루짜리 범위 — 「10/5–10/5」 가 아니라 「10/5」.
    await expect(page.getByTestId('date-range-summary')).toHaveText('10/5');
    await page.getByTestId('date-range-apply').click();

    await expect.poll(() => new URL(page.url()).searchParams.get('closedIn')).toBe('2026-10-05~2026-10-05');
    await expect(page.getByTestId('filter-chip-closedIn')).toHaveText('완료일:10/5');
    await expect.poll(() => searches.lastUrl()?.searchParams.get('closedTo')).toBe('2026-10-05');
  });

  test('「기간 직접 지정」 패널 요약이 칩과 같은 표기(연도 포함)를 쓴다', async ({ authenticatedPage: page }) => {
    await setup(page);
    // 지난해에 걸친 범위 — 칩은 「2025/12/29–1/4」. 같은 범위로 패널을 열면 요약도 같아야 한다.
    await page.goto(`/projects/${KEY}?closedIn=2025-12-29~2026-01-04`);
    const chip = page.getByTestId('filter-chip-closedIn');
    await expect(chip).toHaveText('완료일:2025/12/29–1/4');
    await chip.getByRole('button').first().click();
    await page.getByTestId('closed-range-open').click();
    await expect(page.getByTestId('date-range-summary')).toHaveText('2025/12/29–1/4');
  });

  test('직접 지정으로 만든 칩을 열어 프리셋으로 바꾸면 대체된다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}?closedIn=2026-10-01~2026-10-10`);
    const chip = page.getByTestId('filter-chip-closedIn');
    await expect(chip).toHaveText('완료일:10/1–10/10');
    await chip.getByRole('button').first().click();
    await page.getByTestId('facet-value-closedIn-last-month').click();
    await expect(page).toHaveURL(/closedIn=last-month/);
    await expect(chip).toHaveText('완료일:지난 달 (9/1–9/30)');
  });
  test('「기간 직접 지정」 달력은 팝오버 안에 다 들어간다 — 「＋ 필터」와 칩 편집 모두 취소·적용이 잘리지 않는다', async ({
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
    await page.getByTestId('filter-chip-closedIn').getByRole('button').first().click();
    await page.getByTestId('closed-range-open').click();
    await expect(page.getByTestId('date-range-panel')).toBeVisible();
    await expectApplyFullyVisible(page);
  });
});

