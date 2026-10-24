// 모바일 필터 시트 — 「＋ 필터」에 「완료일」 항목이 보이고 프리셋을 고를 수 있다 (WP-873).
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';

test.use({ timezoneId: 'Asia/Seoul' });

test('필터 시트 — 「＋ 필터」 목록에 완료일이 1건 있고 프리셋을 고르면 칩이 생긴다', async ({ authenticatedPage: page }) => {
  await stubChat(page);
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  await page.route(`**/api/v1/projects/${KEY}`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse([createIssue({ number: 7 })], null)) })
      : r.fallback(),
  );
  await page.goto(`/projects/${KEY}`);
  await page.getByTestId('mobile-chip-filter').click();
  const sheet = page.getByTestId('mobile-filter-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('add-filter-trigger').click();

  await expect(page.getByTestId('add-filter-facet-closedIn')).toHaveCount(1);
  await expect(page.getByTestId('add-filter-facet-closedIn')).toHaveText('완료일');
  await page.getByTestId('add-filter-facet-closedIn').click();
  await page.getByTestId('facet-value-closedIn-last-week').click();
  await expect(page).toHaveURL(/closedIn=last-week/);
  await expect(sheet.getByTestId('filter-chip-closedIn')).toHaveText('완료일:지난 주 (10/12–10/18)');
});

// 무엇을: 좁은 높이(iPhone 13 뷰포트 390×664)에서 「＋ 필터」 목록이 화면 아래끝에 붙지 않고(모서리가 시트 끝에 잘리지 않고)
//        마지막 항목 「완료일」 까지 목록 안 스크롤로 닿아 온전히 보이는지.
// 왜: 목록이 화면 아래끝까지 늘어나 둥근 모서리가 잘렸고, 「완료일」 이 접힌 아래에 있었다(WP-873 캡처).
test('필터 시트 — 「＋ 필터」 목록은 화면 아래끝과 떨어져 있고, 목록 안을 스크롤하면 「완료일」 이 잘리지 않고 보인다', async ({
  authenticatedPage: page,
}) => {
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse([createIssue({ number: 7 })], null)) })
      : r.fallback(),
  );
  await page.goto(`/projects/${KEY}`);
  await page.getByTestId('mobile-chip-filter').click();
  const sheet = page.getByTestId('mobile-filter-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('add-filter-trigger').click();

  const item = page.getByTestId('add-filter-facet-closedIn');
  const list = page.locator('[data-slot="popover-content"]').filter({ has: item });
  await expect(list).toBeVisible();
  const viewportH = page.viewportSize()!.height;
  // 목록 상자는 화면 아래끝에서 떨어져 있다 — 둥근 아래 모서리가 시트 끝에 걸리지 않게.
  const box = (await list.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewportH - 8);

  // 필요하면 목록 안을 스크롤해 「완료일」 에 닿는다 — 상자 안에 온전히 들고, 그 자리를 누르면 그 항목이 맞는다.
  await item.scrollIntoViewIfNeeded();
  const it = (await item.boundingBox())!;
  const after = (await list.boundingBox())!;
  expect(it.y).toBeGreaterThanOrEqual(after.y);
  expect(it.y + it.height).toBeLessThanOrEqual(after.y + after.height);
  expect(it.y + it.height).toBeLessThanOrEqual(viewportH);
  const hit = await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + 2);
    const bottom = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
    return [top, bottom].every((t) => t != null && el.contains(t));
  });
  expect(hit).toBe(true);
});

// 무엇을: 짧은 휴대폰(390×664)에서 「기간 직접 지정」 달력을 열면 「취소」·「적용」 줄과 달력 전체가 스크롤 없이 화면·목록 상자 안에 보이는지.
// 왜: 달력(약 350px)이 「＋ 필터」 아래 남은 높이(약 240px)보다 커서 「적용」 까지 목록 안을 스크롤해야 했다(WP-873).
//     「적용」 줄을 붙여 둔 뒤에도 달력이 두 주만 보이고 나머지는 안을 스크롤해야 해 시트를 높였다(WP-932).
test('필터 시트 — 「기간 직접 지정」 달력을 열면 달력 전체와 「적용」 이 스크롤 없이 보인다(390×664)', async ({ authenticatedPage: page }) => {
  await stubChat(page);
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  await page.route(`**/api/v1/projects/${KEY}`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse([createIssue({ number: 7 })], null)) })
      : r.fallback(),
  );
  await page.goto(`/projects/${KEY}`);
  expect(page.viewportSize()).toEqual({ width: 390, height: 664 });
  await page.getByTestId('mobile-chip-filter').click();
  await page.getByTestId('mobile-filter-sheet').getByTestId('add-filter-trigger').click();
  await page.getByTestId('add-filter-facet-closedIn').click();
  await page.getByTestId('closed-range-open').click();
  await expect(page.getByTestId('date-range-panel')).toBeVisible();

  // 클릭 전에 본다(클릭은 스크롤해 잘림을 가린다). 「적용」 은 화면·목록 상자 안, 「취소」 자리의 점은 실제로 「취소」 를 가리킨다.
  const apply = page.getByTestId('date-range-apply');
  const content = page.locator('[data-slot="popover-content"]').filter({ has: apply });
  const [a, c] = [(await apply.boundingBox())!, (await content.boundingBox())!];
  expect(a.y).toBeGreaterThanOrEqual(c.y);
  expect(a.y + a.height).toBeLessThanOrEqual(c.y + c.height);
  expect(a.y + a.height).toBeLessThanOrEqual(664);
  const hit = await page.getByTestId('date-range-cancel').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t != null && el.contains(t);
  });
  expect(hit).toBe(true);
  // 달력 첫 줄(월 이동)도 위에 그대로 보인다 — 적용 줄을 보이려고 달력을 밀어 올리지 않는다.
  const prev = page.getByTestId('date-range-panel').getByRole('button', { name: /이전|previous/i }).first();
  await expect(prev).toBeInViewport();

  // 달력 전체가 안쪽 스크롤 없이 들어간다(WP-932) — 가장 큰 6주짜리 달(2026년 8월)로 넘겨서도 같아야 한다.
  const noInnerScroll = () =>
    page.getByTestId('date-range-panel').evaluate((el) => {
      const box = el.closest('.overflow-y-auto');
      return box ? box.scrollHeight <= box.clientHeight : 'no-scroll-box';
    });
  expect(await noInnerScroll()).toBe(true);
  for (const month of ['2026년 9월', '2026년 8월']) {
    await prev.click();
    await expect(page.getByTestId('date-range-panel')).toContainText(month);
  }
  expect(await noInnerScroll()).toBe(true);
  await expect(apply).toBeInViewport({ ratio: 1 });
});

// 무엇을: 필터 칩이 쌓여 「＋ 필터」 가 아래로 밀려도(우선순위·완료일 칩 2개) 6주짜리 달력이 안쪽 스크롤 없이 들어가는지(390×664).
// 왜: 시트 전체 최소 높이만 올리면 칩만큼 「＋ 필터」 아래 공간이 줄어 달력 안을 다시 스크롤해야 했다(WP-932).
test('필터 시트 — 칩이 쌓여도 「기간 직접 지정」 달력이 안쪽 스크롤 없이 들어간다(390×664)', async ({ authenticatedPage: page }) => {
  await stubChat(page);
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  await page.route(`**/api/v1/projects/${KEY}`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse([createIssue({ number: 7 })], null)) })
      : r.fallback(),
  );
  await page.goto(`/projects/${KEY}?priority=HIGH&closedIn=last-week`);
  await page.getByTestId('mobile-chip-filter').click();
  const sheet = page.getByTestId('mobile-filter-sheet');
  await expect(sheet.getByTestId('filter-chip-priority')).toBeVisible();
  await sheet.getByTestId('add-filter-trigger').click();
  await page.getByTestId('add-filter-facet-closedIn').click();
  await page.getByTestId('closed-range-open').click();
  const panel = page.getByTestId('date-range-panel');
  const prev = panel.getByRole('button', { name: /이전|previous/i }).first();
  for (const month of ['2026년 9월', '2026년 8월']) {
    await prev.click();
    await expect(panel).toContainText(month);
  }
  const fits = await panel.evaluate((el) => {
    const box = el.closest('.overflow-y-auto');
    return box ? box.scrollHeight <= box.clientHeight : 'no-scroll-box';
  });
  expect(fits).toBe(true);
  await expect(page.getByTestId('date-range-apply')).toBeInViewport({ ratio: 1 });
});

// 무엇을: 필터 시트에서 이미 걸린 완료일 칩을 눌러 「기간 직접 지정」 을 열어도 짧은 휴대폰(390×664)에서 「적용」 이 화면 안에 보이는지.
// 왜: 칩 편집 팝오버는 「＋ 필터」 와 달리 높이 상한·안쪽 스크롤이 없어, 달력이 남은 높이보다 크면 「적용」 이 화면 밖으로 나갔다.
test('필터 시트 — 완료일 칩 편집에서 「기간 직접 지정」 을 열어도 「적용」 이 화면 안에 보인다(390×664)', async ({ authenticatedPage: page }) => {
  await stubChat(page);
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  await page.route(`**/api/v1/projects/${KEY}`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse([createIssue({ number: 7 })], null)) })
      : r.fallback(),
  );
  await page.goto(`/projects/${KEY}?closedIn=last-week`);
  expect(page.viewportSize()).toEqual({ width: 390, height: 664 });
  await page.getByTestId('mobile-chip-filter').click();
  const sheet = page.getByTestId('mobile-filter-sheet');
  await sheet.getByTestId('filter-chip-closedIn').getByRole('button').first().click();
  await page.getByTestId('closed-range-open').click();
  await expect(page.getByTestId('date-range-panel')).toBeVisible();

  const apply = page.getByTestId('date-range-apply');
  const content = page.locator('[data-slot="popover-content"]').filter({ has: apply });
  const [a, c] = [(await apply.boundingBox())!, (await content.boundingBox())!];
  expect(a.y).toBeGreaterThanOrEqual(c.y);
  expect(a.y + a.height).toBeLessThanOrEqual(c.y + c.height);
  expect(a.y).toBeGreaterThanOrEqual(0);
  expect(a.y + a.height).toBeLessThanOrEqual(664);
  const hit = await page.getByTestId('date-range-cancel').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t != null && el.contains(t);
  });
  expect(hit).toBe(true);
});
