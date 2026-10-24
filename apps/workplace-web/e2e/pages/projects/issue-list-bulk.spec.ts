// 팀 리스트 뷰 벌크 작업 E2E (#606) — Drive drive-bulk.spec.ts 와 동일 패턴.
// 체크박스 다중 선택 + 벌크 툴바(상태 일괄 변경/담당자 일괄 지정/일괄 삭제).
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { inServerOrder, withCustomStatuses } from '../../factories/projectStatus.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { bodyOf, type RequestTracker, trackRequests } from '../../fixtures/requests';

const KEY = 'WP';

/** tracker 가 기록한 요청을 경로의 이슈 번호 + 본문으로 펼친다. */
function withIssueNumber(tracker: RequestTracker) {
  return tracker.requests().map((r) => ({
    number: Number(new URL(r.url()).pathname.match(/issues\/(\d+)/)?.[1]),
    body: bodyOf(r),
  }));
}

async function mock(page: Page, issues: ReturnType<typeof createIssue>[]) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues, null)),
      });
    },
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([createMember({ userId: 2, name: '김개발', username: 'kim' })]),
    }),
  );
}

test.describe('팀 리스트 뷰 — 벌크 작업 (#606)', () => {
  test('체크박스 선택 시 벌크 툴바에 선택 개수가 표시된다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    // 초기 상태: 벌크 툴바 없음
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);

    await page.getByTestId('select-issue-7').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 1개');

    await page.getByTestId('select-issue-8').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 2개');

    // 체크박스 클릭이 행 네비게이션(상세 이동)을 트리거하지 않아야 한다.
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));

    await page.getByTestId('bulk-clear').click();
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
  });

  test('전체선택 — 체크 시 모든 행이 선택되고, 해제 시 모두 풀린다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await page.getByTestId('issue-select-all').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 2개');
    await expect(page.getByTestId('select-issue-7')).toBeChecked();
    await expect(page.getByTestId('select-issue-8')).toBeChecked();

    await page.getByTestId('issue-select-all').uncheck();
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
  });

  test('벌크 상태 변경 — 선택 항목 각각에 PATCH .../status 요청을 보낸다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A', status: 'TODO' }),
      createIssue({ id: 2, number: 8, title: '이슈B', status: 'TODO' }),
    ]);

    const statusPatches = trackRequests(page, 'PATCH', /\/api\/v1\/projects\/WP\/issues\/(7|8)\/status$/);
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)\/status$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const number = Number(route.request().url().match(/issues\/(\d+)\/status/)?.[1]);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssue({ number, status: 'DONE' })),
        });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();
    await page.getByTestId('bulk-status-trigger').click();
    // 옵션은 프로젝트 상태(auth.fixture 기본 4상태) — 「완료」(id 3)를 고르면 statusId 로 보낸다(WP-869).
    await page.getByTestId('bulk-status-option-3').click();

    await expect.poll(statusPatches.count).toBe(2);
    const statusBodies = withIssueNumber(statusPatches);
    expect(statusBodies).toContainEqual({ number: 7, body: { statusId: 3 } });
    expect(statusBodies).toContainEqual({ number: 8, body: { statusId: 3 } });

    // 처리 후 선택 해제(벌크 툴바 사라짐)
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
    // 결과 토스트 — 부분 실패 시 백엔드 차단 사유 노출(#710) 등 문구 규칙은 bulkResult 단위 테스트(WP-412).
    await expect(page.getByText('2개 상태를 변경했습니다')).toBeVisible();
  });

  // WP-869 — 일괄 바가 범주 4개만 보여 사용자 정의 상태(「검토 중」)로는 일괄 변경할 수 없었다.
  test('일괄 상태 변경은 프로젝트 상태 목록을 범주별로 보이고 statusId 로 보낸다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A', status: 'TODO' }),
      createIssue({ id: 2, number: 8, title: '이슈B', status: 'TODO' }),
    ]);
    // 진행 중 범주에 「설계」(11)·「검토 중」(12)을 더한 6상태.
    await page.route('**/api/v1/projects/WP/statuses', (route) =>
      route.fulfill({ json: inServerOrder(withCustomStatuses('설계', '검토 중')) }),
    );
    const statusPatches = trackRequests(page, 'PATCH', /\/api\/v1\/projects\/WP\/issues\/(7|8)\/status$/);
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)\/status$/.test(url.pathname),
      (route) => route.fulfill({ json: createIssue({ status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' }) }),
    );

    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();
    await page.getByTestId('bulk-status-trigger').click();

    // 범주 제목 아래 그 범주 상태가 표시 순서대로 — 진행 중 묶음은 진행 중·설계·검토 중.
    const group = page.getByTestId('bulk-status-group-IN_PROGRESS');
    await expect(group).toContainText('진행 중');
    await expect(group.getByRole('menuitem')).toHaveText(['진행 중', '설계', '검토 중']);
    await expect(page.getByTestId('bulk-status-group-DONE').getByRole('menuitem')).toHaveText(['완료']);
    await page.getByTestId('bulk-status-option-12').click();

    await expect.poll(statusPatches.count).toBe(2);
    expect(withIssueNumber(statusPatches)).toEqual(
      expect.arrayContaining([
        { number: 7, body: { statusId: 12 } },
        { number: 8, body: { statusId: 12 } },
      ]),
    );
  });

  // WP-851 — 부분 실패여도 선택이 모두 풀려 어느 이슈가 실패했는지 알 수 없었다. 실패한 이슈만 선택에 남기고 토스트에 키를 싣는다.
  test('벌크 상태 변경 부분 실패 — 실패한 이슈만 선택에 남고 토스트에 그 키가 나온다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A', status: 'TODO' }),
      createIssue({ id: 2, number: 8, title: '이슈B', status: 'TODO' }),
    ]);
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)\/status$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const number = Number(route.request().url().match(/issues\/(\d+)\/status/)?.[1]);
        if (number === 8) {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ status: 409, message: '다른 사람이 먼저 바꿨습니다' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssue({ number, status: 'IN_PROGRESS' })),
        });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();
    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();
    await page.getByTestId('bulk-status-trigger').click();
    await page.getByTestId('bulk-status-option-2').click();

    await expect(
      page.getByText('1개 상태를 변경했습니다. 1건(WP-8)은 상태를 변경하지 못했습니다: 다른 사람이 먼저 바꿨습니다'),
    ).toBeVisible();
    // 실패한 WP-8 만 선택된 채 일괄 바가 남아 바로 다시 시도할 수 있다.
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 1개');
    await expect(page.getByTestId('select-issue-8')).toBeChecked();
    await expect(page.getByTestId('select-issue-7')).not.toBeChecked();
  });

  // WP-606 — 기본 목록은 활성 사이클 밖 종료 이슈를 숨겨, 일괄 완료한 행이 이유 없이 사라졌다.
  test('일괄 완료로 숨겨지는 이슈가 있으면 토스트에 이유와 「모두 보기」를 붙인다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)\/status$/.test(url.pathname),
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssue({ status: 'DONE' })) }),
    );
    const cycleLookups = trackRequests(page, 'GET', /\/issues\/(7|8)\/cycles$/);
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)\/cycles$/.test(url.pathname),
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();
    await page.getByTestId('bulk-status-trigger').click();
    await page.getByTestId('bulk-status-option-3').click();

    const toast = page.locator('[data-sonner-toast]', { hasText: '2개 상태를 변경했습니다 — 활성 사이클 밖에서 끝난 이슈는 이 화면에서 숨겨집니다' });
    await expect(toast).toBeVisible();
    await expect.poll(cycleLookups.count).toBe(2);
    await toast.getByRole('button', { name: '모두 보기' }).click();
    await expect(page).toHaveURL(/closed=all/);
  });

  test('벌크 담당자 지정 — 선택 항목 각각에 PUT .../assignees 요청을 보낸다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);

    const assigneePuts = trackRequests(page, 'PUT', /\/api\/v1\/projects\/WP\/issues\/(7|8)\/assignees$/);
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)\/assignees$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();
    await page.getByTestId('bulk-assignee-trigger').click();
    await page.getByTestId('bulk-assignee-option-2').click();

    await expect.poll(assigneePuts.count).toBe(2);
    const assigneeBodies = withIssueNumber(assigneePuts);
    expect(assigneeBodies).toContainEqual({ number: 7, body: { userIds: [2] } });
    expect(assigneeBodies).toContainEqual({ number: 8, body: { userIds: [2] } });
  });

  test('벌크 삭제 — 확인 다이얼로그 후 선택 항목 각각에 DELETE 요청을 보낸다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      // WP-482: 하위 태스크가 있는 부모 — 확인창이 함께 지워질 하위 수를 알려야 한다.
      createIssue({ id: 1, number: 7, title: '이슈A', childCount: 2 }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);

    const deletes = trackRequests(page, 'DELETE', /\/api\/v1\/projects\/WP\/issues\/(7|8)$/);
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        return route.fulfill({ status: 204, body: '' });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();

    await page.getByTestId('bulk-delete').click();
    await expect(page.getByTestId('issue-bulk-delete-dialog')).toBeVisible();
    await expect(page.getByTestId('issue-bulk-delete-dialog')).toContainText(
      '선택한 2개 태스크를 삭제할까요? 하위 태스크 2개도 함께 삭제됩니다.',
    );
    await page.getByTestId('issue-bulk-delete-confirm').click();

    await expect.poll(() => withIssueNumber(deletes).map((d) => d.number).sort()).toEqual([7, 8]);
  });

  // #716 — 체크박스 토글 1회에 클릭 대상 외 행까지 전부 리렌더(React.memo 부재)되던 회귀 방지.
  test('체크박스 토글 시 클릭 대상 외 행은 DOM 변경 없이 그대로 유지된다 (#716)', async ({
    authenticatedPage: page,
  }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
      createIssue({ id: 3, number: 9, title: '이슈C' }),
    ]);

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    // 체크박스 8(대상 외 행)에 MutationObserver 설치 후, 체크박스 7만 토글.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="select-issue-8"]')
      ;(window as unknown as { __mutations: number }).__mutations = 0
      const observer = new MutationObserver((mutations) => {
        (window as unknown as { __mutations: number }).__mutations += mutations.length
      })
      observer.observe(el!, { attributes: true })
    })

    await page.getByTestId('select-issue-7').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 1개');

    const mutations = await page.evaluate(() => (window as unknown as { __mutations: number }).__mutations)
    expect(mutations).toBe(0)
  });
});
