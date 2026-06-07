// Phase 4c 커스텀 필드 도메인 E2E.
// 시나리오 (smoke): 설정 페이지에서 NUMBER 필드 추가 → 이슈 상세에서 값 입력 →
//   debounce 후 PUT /fields payload 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';

const KEY = 'WP';

test.describe('커스텀 필드', () => {
  test(
    'NUMBER 필드 추가 → 이슈 값 입력 → 갱신',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 설정 페이지에서 새 필드를 추가하면 stub state 가 누적되어 이슈 상세 화면에서도 조회된다.
      let fields: Array<{
        id: number;
        projectId: number;
        name: string;
        type: string;
        options: string[] | null;
        position: number;
        createdAt: string;
        updatedAt: string;
      }> = [];
      const taskType = makeTaskType();
      const baseIssue = {
        ...createIssue({ id: 1, number: 1, title: 't' }),
        type: taskType,
        labels: [],
        attachmentCount: 0,
        assignees: [],
        parent: null,
        childCount: 0,
        childDoneCount: 0,
        blockedBy: [],
        blocks: [],
        blocked: false,
        customFields: [] as Array<{ defId: number; name: string; type: string; value: unknown }>,
      };
      let issue = baseIssue;

      await page.route(`**/api/v1/projects/${KEY}`, (r) =>
        r.fulfill({
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
      await page.route(`**/api/v1/projects/${KEY}/members`, (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ userId: 1, username: 'me', name: 'Me', role: 'OWNER' }]),
        }),
      );
      await page.route(`**/api/v1/projects/${KEY}/types`, (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(systemTypes()),
        }),
      );
      await page.route(`**/api/v1/projects/${KEY}/labels`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(`**/api/v1/projects/${KEY}/issues/1/watchers`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(`**/api/v1/projects/${KEY}/issues/1/attachments`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      // 필드 정의 CRUD — GET 은 누적 state 반환, POST 는 id/timestamp 부여 후 state 에 push.
      await page.route(`**/api/v1/projects/${KEY}/fields`, async (route) => {
        const req = route.request();
        if (req.method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fields),
          });
        }
        if (req.method() === 'POST') {
          const body = req.postDataJSON() as {
            name: string;
            type: string;
            options: string[] | null;
          };
          const f = {
            id: fields.length + 100,
            projectId: 1,
            name: body.name,
            type: body.type,
            options: body.options,
            position: 99,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          fields = [...fields, f];
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(f),
          });
        }
        return route.continue();
      });

      await page.route(`**/api/v1/projects/${KEY}/issues/1`, (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: issue,
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        }),
      );

      // PUT /fields — payload 캡처 후 incoming 값을 stub state 에 머지하여 후속 GET 응답에 반영.
      let putPayload: unknown;
      await page.route(`**/api/v1/projects/${KEY}/issues/1/fields`, (route) => {
        putPayload = route.request().postDataJSON();
        const incoming = (putPayload as { values: Array<{ defId: number; value: unknown }> })
          .values;
        const map = new Map<
          number,
          { defId: number; name: string; type: string; value: unknown }
        >();
        for (const e of issue.customFields) map.set(e.defId, e);
        for (const v of incoming) {
          const def = fields.find((f) => f.id === v.defId);
          if (!def) continue;
          if (v.value == null) map.delete(v.defId);
          else map.set(v.defId, { defId: v.defId, name: def.name, type: def.type, value: v.value });
        }
        issue = { ...issue, customFields: Array.from(map.values()) };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: issue,
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        });
      });

      // 1) 설정 페이지에서 NUMBER 필드 추가
      await page.goto(`/projects/${KEY}/settings`);
      await page.getByTestId('custom-field-create-form').getByLabel('이름').fill('스토리포인트');
      await page.getByTestId('cf-type-select').selectOption('NUMBER');
      await page
        .getByTestId('custom-field-create-form')
        .getByRole('button', { name: '추가' })
        .click();
      await expect(page.getByText('스토리포인트')).toBeVisible();

      // 2) 이슈 상세에서 값 5 입력 → debounce(300ms) 후 PUT 발생.
      await page.goto(`/projects/${KEY}/issues/1`);
      await expect(page.getByTestId('custom-fields-section')).toBeVisible();
      const fieldId = fields.find((f) => f.name === '스토리포인트')!.id;
      await page.getByTestId(`field-input-${fieldId}`).fill('5');

      await expect.poll(() => putPayload, { timeout: 2000 }).toMatchObject({
        values: [{ defId: fieldId, value: 5 }],
      });
    },
  );

  test(
    '커스텀 필드 삭제 — AlertDialog 확인 후 DELETE 발생 (#148)',
    async ({ authenticatedPage: page }) => {
      const field = {
        id: 200,
        projectId: 1,
        name: '삭제필드',
        type: 'TEXT',
        options: null,
        position: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      let deleted = false;

      await page.route(`**/api/v1/projects/${KEY}`, (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 1, key: KEY, name: 'P', description: '', ownerId: 1, ownerName: 'T', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
        }),
      );
      await page.route(`**/api/v1/projects/${KEY}/members`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ userId: 1, username: 'me', name: 'Me', role: 'OWNER' }]) }),
      );
      await page.route(`**/api/v1/projects/${KEY}/types`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(`**/api/v1/projects/${KEY}/labels`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(`**/api/v1/projects/${KEY}/fields`, async (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deleted ? [] : [field]) });
        }
        return route.fallback();
      });
      await page.route(`**/api/v1/projects/${KEY}/fields/${field.id}`, async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        deleted = true;
        return route.fulfill({ status: 204, body: '' });
      });

      await page.goto(`/projects/${KEY}/settings`);
      await expect(page.getByText('삭제필드')).toBeVisible();

      // 삭제 버튼 → AlertDialog cascade 경고 확인 → DELETE 발생.
      await page.getByTestId(`custom-field-delete-${field.id}`).click();
      await expect(page.getByTestId('custom-field-delete-dialog')).toBeVisible();
      await expect(page.getByTestId('custom-field-delete-dialog')).toContainText('이슈 값들과 함께 삭제');
      await page.getByTestId('custom-field-delete-confirm').click();

      await expect.poll(() => deleted).toBe(true);
    },
  );
});
