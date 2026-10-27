// 모바일 빠른 필터 시트(WP-1020) — 「더 보기」 목록·「기간 직접 지정」 달력이 짧은 휴대폰에서 잘리지 않는다 (WP-873, WP-932).
// 실제 기하(상자 끝·안쪽 스크롤·elementFromPoint)를 재므로 모두 @layout 이다. 완료일 항목·프리셋 → URL·칩 라벨은
// 페이지 테스트 src/pages/mobile/issueClosedFilter.test.tsx 가 지킨다(WP-981).
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';

test.use({ timezoneId: 'Asia/Seoul' });

// 무엇을: 좁은 높이(iPhone 13 뷰포트 390×664)에서 「더 보기」 시트 목록의 「완료일」 까지 시트 안 스크롤로 닿아 온전히 보이고 눌리는지.
// 왜: 예전 「＋ 필터」 목록이 화면 아래끝까지 늘어나 「완료일」 이 접힌 아래에 있었다(WP-873 캡처). 시트로 바뀐 뒤에도 같은 자리를 지킨다.
test('더 보기 시트 — 「완료일」 항목이 화면 안에 잘리지 않고 보이고 눌린다(390×664)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
  await page.getByTestId('mobile-quick-filter-more').click();
  const sheet = page.getByTestId('mobile-quick-filter-sheet');
  await expect(sheet).toBeVisible();
  const item = sheet.getByTestId('mobile-quick-filter-more-facet-closedIn');
  await item.scrollIntoViewIfNeeded();
  const it = (await item.boundingBox())!;
  const viewportH = page.viewportSize()!.height;
  expect(it.y).toBeGreaterThanOrEqual(0);
  expect(it.y + it.height).toBeLessThanOrEqual(viewportH);
  // 행 높이 48px 이상(터치 영역).
  expect(it.height).toBeGreaterThanOrEqual(48);
  const hit = await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + 2);
    const bottom = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
    return [top, bottom].every((t) => t != null && el.contains(t));
  });
  expect(hit).toBe(true);
});

// 무엇을: 다른 칩이 걸린 채(우선순위) 걸린 완료일 칩을 눌러 「기간 직접 지정」 달력을 열면, 6주짜리 달(2026년 8월)로 넘겨도
//        달력 전체와 「취소」·「적용」 이 시트 안 스크롤 없이 화면 안에 보이는지(390×664).
// 왜: 달력이 남은 높이보다 커서 「적용」 까지 안을 스크롤해야 했다(WP-873·WP-932). 빠른 필터 시트에서도 같은 기준을 지킨다.
test('값 시트 — 「기간 직접 지정」 달력과 「적용」 이 스크롤 없이 보인다(390×664, 6주 달)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
  expect(page.viewportSize()).toEqual({ width: 390, height: 664 });
  // 걸린 칩은 줄 맨 앞 — 본문을 누르면 값 시트가 열린다.
  await page.getByTestId('mobile-quick-filter-closedIn').getByRole('button').first().click();
  await page.getByTestId('closed-range-open').click();
  const panel = page.getByTestId('date-range-panel');
  await expect(panel).toBeVisible();
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
  await expect(prev).toBeInViewport();
  await expect(page.getByTestId('date-range-apply')).toBeInViewport({ ratio: 1 });
  const hit = await page.getByTestId('date-range-cancel').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t != null && el.contains(t);
  });
  expect(hit).toBe(true);
});
