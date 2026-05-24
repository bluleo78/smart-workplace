// 이슈 유형 도메인 E2E.
// 시나리오: OWNER 가 설정 페이지에서 CUSTOM 유형(디자인)을 추가 → 이슈 상세에서 picker 로 변경 →
// PATCH payload {typeId} 검증 + 배지 갱신 확인.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue } from '../../factories/issue.factory';
import { makeIssueType, systemTypes } from '../../factories/issueType.factory';

const KEY = 'WP';

test.describe('이슈 유형', () => {
  test(
    'CUSTOM 추가 → 이슈 변경 → 배지 갱신',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 시스템 4종 시드 + 초기 이슈(TASK 유형) 상태.
      let types = systemTypes();
      const issue = { ...createIssue({ id: 1, number: 1, title: 't' }), type: types[0] };

      // 프로젝트/멤버 stub — 현재 사용자(id=1) OWNER 로 설정해야 관리 UI 가 렌더된다.
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

      // 유형 GET/POST stub — POST 시 in-memory 배열에 누적.
      await page.route(`**/api/v1/projects/${KEY}/types`, async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(types),
          });
        }
        if (method === 'POST') {
          const body = route.request().postDataJSON() as {
            name: string;
            colorToken: string;
            icon: string;
          };
          const t = makeIssueType({
            name: body.name,
            colorToken: body.colorToken,
            icon: body.icon as never,
          });
          types = [...types, t];
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(t),
          });
        }
        return route.fallback();
      });

      // 이슈 상세 fetch 가 의존하는 보조 엔드포인트들 stub.
      await page.route(`**/api/v1/projects/${KEY}/issues/1`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: { ...issue, type: issue.type, assignees: [], labels: [], attachmentCount: 0 },
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        }),
      );
      await page.route(`**/api/v1/projects/${KEY}/issues/1/watchers`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(`**/api/v1/projects/${KEY}/issues/1/attachments`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      // PATCH /issues/1/type — payload 캡처 + 응답에서 갱신된 type 반영.
      let patchPayload: unknown;
      await page.route(`**/api/v1/projects/${KEY}/issues/1/type`, (route) => {
        patchPayload = route.request().postDataJSON();
        const tid = (patchPayload as { typeId: number }).typeId;
        const newType = types.find((t) => t.id === tid);
        if (newType) {
          issue.type = {
            id: newType.id,
            name: newType.name,
            colorToken: newType.colorToken,
            icon: newType.icon,
          };
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: { ...issue, assignees: [], labels: [], attachmentCount: 0 },
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        });
      });

      // 1) 설정 페이지에서 CUSTOM '디자인'(PURPLE+Star) 추가.
      await page.goto(`/projects/${KEY}/settings`);
      const createForm = page.getByTestId('issue-type-create-form');
      await createForm.getByLabel('이름').fill('디자인');
      // 라벨 관리 섹션에도 동일 라벨의 색상 버튼이 존재 — form 으로 범위 한정.
      await createForm.getByRole('button', { name: 'PURPLE' }).click();
      await createForm.getByTestId('issue-type-icon-Star').click();
      await page
        .getByTestId('issue-type-create-form')
        .getByRole('button', { name: '추가' })
        .click();
      await expect(page.getByText('디자인')).toBeVisible();

      // 2) 이슈 상세에서 picker 로 디자인 선택 → PATCH 검증 + 배지 갱신.
      await page.goto(`/projects/${KEY}/issues/1`);
      await page.getByTestId('issue-type-trigger').click();
      const designId = types.find((t) => t.name === '디자인')!.id;
      await page.getByTestId(`issue-type-option-${designId}`).click();

      await expect.poll(() => patchPayload).toEqual({ typeId: designId });
      await expect(page.getByTestId(`issue-type-badge-${designId}`)).toBeVisible();
    },
  );
});
