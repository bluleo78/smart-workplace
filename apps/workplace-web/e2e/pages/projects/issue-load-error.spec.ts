// 이슈 불러오기 실패 상태 E2E(WP-858) — 키보드로 「다시 시도」를 누르는 동안·다시 실패해도 초점을 지키고,
// 성공하면 불러온 목록으로 초점이 옮겨 가는지(WP-893, @input)만 남긴다.
// 실패 안내·다시 시도(목록·보드·사이클 그룹)·필터 초기화·정수 아닌 id 미전송은
// 페이지 테스트 src/pages/projects/issueLoadError.test.tsx 가 지킨다(WP-980). 판정 경우의 수는 issueFilters 단위 테스트가 맡는다.
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;

// 프로젝트 메타 + 이슈 검색 — failing() 이 true 인 동안 검색 GET 은 500, 그 뒤로는 이슈 1건.
// gate 를 주면 검색 응답이 그 약속을 기다린다 — 「다시 부르는 중」 상태를 붙잡아 두고 확인할 때.
async function mockSearch(page: import('@playwright/test').Page, failing: () => boolean, gate?: () => Promise<void>) {
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject());
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, []);
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      if (gate) await gate();
      if (failing()) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '서버 오류' }) });
      }
      // 목록은 범주(status)로, 보드 컬럼은 프로젝트 상태 id(statusId — 시드 할 일 = 1)로 좁혀 온다(WP-808).
      const params = new URL(route.request().url()).searchParams;
      const statusId = params.get('statusId');
      const todo = statusId != null ? statusId === '1' : (params.get('status') ?? 'TODO').includes('TODO');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueSearchResponse(todo ? [createIssue({ number: 7, title: '살아 있는 이슈', status: 'TODO' })] : [], null),
        ),
      });
    },
  );
}

// WP-893: 키보드로 「다시 시도」를 누르면 다시 부르는 동안 안내가 사라졌다가(로딩·스켈레톤) 다시 실패하면 새로 그려져 초점이 body 로 빠졌다.
// 다시 부르는 동안에도 안내와 버튼이 남아(aria-disabled) 초점을 지키고, 성공하면 불러온 목록으로 초점이 옮겨 가는지 본다.
test.describe('이슈 불러오기 실패 — 다시 시도 초점 (WP-893)', { tag: '@input' }, () => {
  // 검색 응답을 손으로 풀어 주는 문 — open() 전까지 응답을 붙잡는다.
  function makeGate() {
    let release: () => void = () => {};
    let held = new Promise<void>((r) => (release = r));
    return {
      wait: () => held,
      hold: () => { held = new Promise<void>((r) => (release = r)); },
      open: () => release(),
    };
  }

  test('목록: 다시 부르는 동안·다시 실패해도 초점이 「다시 시도」에 남고, 성공하면 불러온 목록으로 옮긴다', async ({ authenticatedPage: page }) => {
    let failing = true;
    const gate = makeGate();
    gate.open();
    await mockSearch(page, () => failing, () => gate.wait());

    await page.goto(`/projects/${KEY}`);
    const retry = page.getByTestId('issue-load-error-retry');
    await retry.focus();

    // 다시 부르는 중 — 안내와 버튼이 그대로, 버튼은 잠김 표시만(aria-disabled).
    gate.hold();
    await page.keyboard.press('Enter');
    await expect(retry).toHaveAttribute('aria-disabled', 'true');
    await expect(retry).toBeFocused();

    // 다시 실패 — 초점은 여전히 다시 시도.
    gate.open();
    await expect(retry).not.toHaveAttribute('aria-disabled');
    await expect(retry).toBeFocused();

    failing = false;
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('issue-load-error')).toHaveCount(0);
    // 안내가 있던 자리의 첫 조작 요소 — 불러온 표의 「전체선택」.
    await expect(page.getByTestId('issue-list-scroll').getByTestId('issue-select-all')).toBeFocused();
  });

  test('사이클 구간: 구간 안 실패 안내도 다시 부르는 동안 초점을 지키고, 성공하면 구간의 이슈로 옮긴다', async ({ authenticatedPage: page }) => {
    let failing = true;
    const gate = makeGate();
    gate.open();
    await mockSearch(page, () => failing, () => gate.wait());
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, []);
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles/progress`, []);

    await page.goto(`/projects/${KEY}?group=cycle`);
    const retry = page.locator('[data-testid^="list-cycle-error-"][data-testid$="-retry"]').first();
    await retry.focus();

    gate.hold();
    await page.keyboard.press('Enter');
    await expect(retry).toHaveAttribute('aria-disabled', 'true');
    await expect(retry).toBeFocused();

    failing = false;
    gate.open();
    await expect(page.locator('[data-testid^="list-cycle-error-"]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="issue-row-7"]')))
      .toBe(true);
  });
});
