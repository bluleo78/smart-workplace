// Phase 4a SUBTASK 도메인 E2E.
// 시나리오 1 (smoke): 비SUBTASK(TASK) 상세 진입 → 자식 SUBTASK 인라인 추가
//   → POST /issues payload {title, typeId:5, parentNumber:1} 검증 → 자식 리스트 갱신.
// 시나리오 2: SUBTASK 상세 진입 → 부모 슬롯 노출 → number 입력 → PATCH /issues/{n}/parent
//   payload {parentNumber:15} 검증 → 슬롯의 ParentBadge 갱신.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeSubtaskType, systemTypes } from '../../factories/issueType.factory';

const KEY = 'WP';
const ISSUES_BASE = `/api/v1/projects/${KEY}/issues`;

// 공통 stub — 프로젝트/멤버/유형/라벨. 이슈 상세 페이지가 fetch 하는 보조 엔드포인트들.
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
      body: JSON.stringify([
        { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
      ]),
    }),
  );
  await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(systemTypes()),
    }),
  );
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

test.describe('SUBTASK', () => {
  test(
    '비SUBTASK 진입 → 자식 SUBTASK 추가 → POST payload + 리스트 갱신',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const taskSummary = {
        id: 1,
        name: 'TASK',
        colorToken: 'BLUE' as const,
        icon: 'Circle' as const,
      };
      const parentIssue = {
        ...createIssue({ id: 1, number: 1, title: '부모 TASK' }),
        type: taskSummary,
      };
      // 자식은 mutation 후 in-memory 누적.
      let childCreated: Array<{ id: number; number: number; title: string }> = [];
      let postPayload: unknown;

      await setupCommonStubs(page);

      // 이슈 상세 — 호출될 때마다 최신 childCount 반영.
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              summary: {
                ...parentIssue,
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
        (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/attachments`,
        (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      // /issues 컬렉션 — GET (검색, parent 필터) + POST (자식 생성).
      // pathname 이 정확히 `/issues` 인 요청만 처리. detail 등은 위 route 가 먼저 잡는다.
      await page.route(
        (url) => url.pathname === ISSUES_BASE,
        (route) => {
          const req = route.request();
          if (req.method() === 'POST') {
            postPayload = req.postDataJSON();
            const next = childCreated.length + 100;
            const child = {
              id: next,
              number: next,
              title: (postPayload as { title: string }).title,
            };
            childCreated = [...childCreated, child];
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                ...createIssue({ id: child.id, number: child.number, title: child.title }),
                type: makeSubtaskType(),
                parent: { number: 1, title: '부모 TASK', type: taskSummary },
              }),
            });
          }
          // GET search — parent=1 이면 자식 리스트, 그 외는 빈 결과.
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
                    type: makeSubtaskType(),
                    parent: { number: 1, title: '부모 TASK', type: taskSummary },
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

      // 비SUBTASK 진입 — 자식 섹션 노출, 부모 슬롯 없음.
      await expect(page.getByTestId('issue-children-section')).toBeVisible();
      await expect(page.getByTestId('issue-parent-slot')).toHaveCount(0);
      // 섹션 제목이 한국어로 표시되는지 확인 (#133 회귀 방지).
      await expect(page.getByRole('heading', { name: '하위 태스크', level: 3 })).toBeVisible();
      // 초기 상태 — 빈 자식 메시지.
      await expect(page.getByText('하위 태스크가 없습니다')).toBeVisible();

      // SUBTASK 인라인 추가.
      await page.getByTestId('child-add-input').fill('첫 자식');
      await page
        .getByTestId('child-add-form')
        .getByRole('button', { name: '추가' })
        .click();

      // POST payload — 백엔드 컨트랙트 검증.
      await expect
        .poll(() => postPayload)
        .toEqual({ title: '첫 자식', typeId: 5, parentNumber: 1 });

      // 추가 후 자식 리스트 갱신 (invalidate → refetch).
      await expect(page.getByTestId('child-row-100')).toBeVisible();
      await expect(page.getByTestId('child-row-100')).toContainText('첫 자식');
    },
  );

  test('SUBTASK 진입 → 부모 슬롯 + 변경 → PATCH payload + 슬롯 갱신', async ({
    authenticatedPage: page,
  }) => {
    const taskSummary = {
      id: 1,
      name: 'TASK',
      colorToken: 'BLUE' as const,
      icon: 'Circle' as const,
    };
    // 초기 부모: TASK number=12. PATCH 후 number=15 로 변경.
    let currentParent: { number: number; title: string } = { number: 12, title: '부모 12' };
    let patchPayload: unknown;

    await setupCommonStubs(page);

    // 이슈 상세 — SUBTASK 유형. parent 는 currentParent 기준으로 동적.
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/5`,
      (route) => {
        const req = route.request();
        if (req.method() === 'PATCH') {
          // /issues/5/parent 가 아닌 본문 PATCH 는 본 테스트에선 발생하지 않음 — 안전망.
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...createIssue({ id: 5, number: 5, title: '자식 SUBTASK' }),
              type: makeSubtaskType(),
              parent: {
                number: currentParent.number,
                title: currentParent.title,
                type: taskSummary,
              },
              childCount: 0,
              childDoneCount: 0,
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
      (url) => url.pathname === `${ISSUES_BASE}/5/watchers`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/5/attachments`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    // PATCH /issues/5/parent — payload 캡처 + currentParent 갱신 + IssueDetailResponse 반환.
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/5/parent`,
      (route) => {
        const req = route.request();
        patchPayload = req.postDataJSON();
        const newNumber = (patchPayload as { parentNumber: number }).parentNumber;
        currentParent = { number: newNumber, title: `부모 ${newNumber}` };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...createIssue({ id: 5, number: 5, title: '자식 SUBTASK' }),
              type: makeSubtaskType(),
              parent: {
                number: currentParent.number,
                title: currentParent.title,
                type: taskSummary,
              },
              childCount: 0,
              childDoneCount: 0,
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

    await page.goto(`/projects/${KEY}/issues/5`);

    // SUBTASK 진입 — 부모 슬롯 노출 + 변경 버튼 (parent 있음).
    await expect(page.getByTestId('issue-parent-slot')).toBeVisible();
    await expect(page.getByTestId('parent-badge-12')).toBeVisible();
    await expect(page.getByTestId('issue-parent-edit')).toHaveText('변경');

    // 편집 진입 → number 15 입력 → 저장.
    await page.getByTestId('issue-parent-edit').click();
    await expect(page.getByTestId('issue-parent-picker')).toBeVisible();
    await page.getByTestId('parent-number-input').fill('15');
    await page.getByTestId('parent-save').click();

    // PATCH payload — 백엔드 컨트랙트 검증.
    await expect.poll(() => patchPayload).toEqual({ parentNumber: 15 });

    // 슬롯 갱신 — picker 닫히고 새 ParentBadge 노출.
    await expect(page.getByTestId('issue-parent-picker')).toHaveCount(0);
    await expect(page.getByTestId('parent-badge-15')).toBeVisible();
  });
});
