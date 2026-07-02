// EPIC 계층 E2E.
// 시나리오 1 (smoke): EPIC 상세 진입 → 유형 선택 후 하위 이슈 추가
//   → POST /issues payload {title, typeId, parentNumber} 검증 → 진행률(완료/전체) 표시.
// 시나리오 2: EPIC 상세에는 부모 슬롯이 없음(EPIC 은 부모를 가질 수 없음).
// 시나리오 3: 일반 이슈 상세에서 "상위 에픽" 슬롯으로 EPIC 에 연결 → PATCH /parent 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, systemTypes } from '../../factories/issueType.factory';

const KEY = 'WP';
const ISSUES_BASE = `/api/v1/projects/${KEY}/issues`;

async function setupCommonStubs(page: Parameters<Parameters<typeof test>[2]>[0]['page']) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        key: KEY,
        name: 'P',
        description: '',
        ownerId: 1,
        ownerName: 'T',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    }),
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ userId: 1, username: 'me', name: 'Me', role: 'OWNER' }]),
    }),
  );
  // 실제 네트워크 latency 를 흉내내는 미세 지연 — 0ms 즉시 응답이면 React StrictMode(dev)의
  // 이중 effect 마운트 사이클과 경합해 Radix Select 의 숨은 native <select> 가 unmount 시
  // change("") 를 잘못 방출하는 dev-only 레이스가 있다(EPIC 하위 유형 select 기본값 리셋).
  // 실제 백엔드 호출은 항상 >0ms 이므로 프로덕션에서는 재현되지 않는다 — 테스트만 보정.
  await page.route(`**/api/v1/projects/${KEY}/types`, async (route) => {
    await new Promise((r) => setTimeout(r, 50));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(systemTypes()),
    });
  });
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

test.describe('EPIC 계층', () => {
  test(
    'EPIC 상세 → 유형 선택해 하위 이슈 추가 → POST payload + 진행률 표시',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const epicSummary = makeEpicType();
      const epicIssue = {
        ...createIssue({ id: 1, number: 1, title: '에픽 1' }),
        type: epicSummary,
      };
      let childCreated: Array<{ id: number; number: number; title: string; typeId: number }> = [];
      let postPayload: unknown;

      await setupCommonStubs(page);

      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              summary: {
                ...epicIssue,
                childCount: childCreated.length,
                childDoneCount: 0,
                parent: null,
                labels: [],
                attachmentCount: 0,
                assignees: [],
              },
              body: '',
              comments: [],
              history: [],
              attachments: [],
            }),
          }),
      );
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/watchers`,
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/attachments`,
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      await page.route(
        (url) => url.pathname === ISSUES_BASE,
        (route) => {
          const req = route.request();
          if (req.method() === 'POST') {
            postPayload = req.postDataJSON();
            const payload = postPayload as { title: string; typeId: number; parentNumber: number };
            const next = childCreated.length + 100;
            const child = { id: next, number: next, title: payload.title, typeId: payload.typeId };
            childCreated = [...childCreated, child];
            const taskSummary = { id: payload.typeId, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' };
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                ...createIssue({ id: child.id, number: child.number, title: child.title }),
                type: taskSummary,
                parent: { number: 1, title: '에픽 1', type: epicSummary },
              }),
            });
          }
          const url = new URL(req.url());
          const parentParam = url.searchParams.get('parent');
          if (parentParam === '1') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(
                createIssueSearchResponse(
                  childCreated.map((c) => ({
                    ...createIssue({ id: c.id, number: c.number, title: c.title }),
                    type: { id: c.typeId, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' },
                    parent: { number: 1, title: '에픽 1', type: epicSummary },
                  })),
                  null,
                ),
              ),
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse([], null)),
          });
        },
      );

      await page.goto(`/projects/${KEY}/issues/1`);

      // EPIC 상세 — 하위 이슈 섹션 노출, 부모 슬롯 없음(EPIC 은 부모를 가질 수 없음).
      await expect(page.getByTestId('issue-children-section')).toBeVisible();
      await expect(page.getByTestId('issue-parent-slot')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '하위 이슈', level: 3 })).toBeVisible();
      // EPIC 부모에서는 유형 선택 셀렉트가 노출된다(SUBTASK 고정이 아님).
      await expect(page.getByTestId('epic-child-type-select')).toBeVisible();

      await page.getByTestId('child-add-input').fill('첫 스토리');
      await page.getByTestId('child-add-form').getByRole('button', { name: '추가' }).click();

      await expect.poll(() => postPayload).toEqual({
        title: '첫 스토리',
        typeId: 1,
        parentNumber: 1,
      });

      await expect(page.getByTestId('child-row-100')).toBeVisible();
      await expect(page.getByTestId('child-row-100')).toContainText('첫 스토리');

      // 진행률 표시 — 하위 이슈가 하나 생겨 childCount=1, 방금 생성된 이슈는 기본 TODO 상태라 done=0.
      await expect(page.getByTestId('child-progress-text')).toBeVisible();
      await expect(page.getByTestId('child-progress-text')).toHaveText('0/1');
    },
  );

  test('일반 이슈 상세 → 상위 에픽 슬롯으로 EPIC 연결 → PATCH payload 검증', async ({
    authenticatedPage: page,
  }) => {
    const taskSummary = { id: 1, name: 'TASK', colorToken: 'BLUE' as const, icon: 'Circle' as const };
    let currentParent: { number: number; title: string; type: typeof taskSummary } | null = null;
    let patchPayload: unknown;

    await setupCommonStubs(page);

    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) => {
        if (route.request().method() === 'PATCH') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...createIssue({ id: 1, number: 1, title: '일반 이슈' }),
              type: taskSummary,
              childCount: 0,
              childDoneCount: 0,
              parent: currentParent,
              labels: [],
              attachmentCount: 0,
              assignees: [],
            },
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        });
      },
    );
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1/watchers`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1/attachments`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1/parent`,
      (route) => {
        patchPayload = route.request().postDataJSON();
        currentParent = { number: 5, title: '분기 에픽', type: makeEpicType() as unknown as typeof taskSummary };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...createIssue({ id: 1, number: 1, title: '일반 이슈' }),
              type: taskSummary,
              childCount: 0,
              childDoneCount: 0,
              parent: currentParent,
              labels: [],
              attachmentCount: 0,
              assignees: [],
            },
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        });
      },
    );
    await page.route(
      (url) => url.pathname === ISSUES_BASE,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([], null)),
        }),
    );

    await page.goto(`/projects/${KEY}/issues/1`);

    // 일반 이슈 — "상위 에픽" 슬롯 노출(부모 없음 안내 문구).
    await expect(page.getByTestId('issue-parent-slot')).toBeVisible();
    await expect(page.getByText('상위 에픽')).toBeVisible();
    await expect(page.getByTestId('epic-parent-empty')).toBeVisible();

    await page.getByTestId('issue-parent-edit').click();
    await page.getByTestId('parent-number-input').fill('5');
    await page.getByTestId('parent-save').click();

    await expect.poll(() => patchPayload).toEqual({ parentNumber: 5 });

    // 슬롯 갱신 — picker 닫히고 새 ParentBadge(EPIC) 노출.
    await expect(page.getByTestId('issue-parent-picker')).toHaveCount(0);
    await expect(page.getByTestId('parent-badge-5')).toBeVisible();
    await expect(page.getByTestId('parent-badge-5')).toContainText('분기 에픽');
  });
});
