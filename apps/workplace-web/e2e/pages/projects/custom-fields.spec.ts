// 커스텀 필드 도메인 E2E — 설정에서 필드 추가 → 이슈 상세에서 값 입력 → 디바운스 뒤 PUT 으로 이어지는 여러 화면 흐름(@flow)만 남긴다.
// 설정 목록(타입 라벨·옵션 칩·삭제 이름)·삭제·편집 409, 이슈 상세의 NUMBER 안전 범위·DATE 선택/지우기는
// 페이지 테스트 src/pages/projects/customFields.test.tsx 가 지킨다(WP-971).

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';
import type { FieldType } from '../../../src/types/customField';

const KEY = 'WP';

test.describe('커스텀 필드', () => {
  test(
    'NUMBER 필드 추가 → 이슈 값 입력 → 갱신',
    { tag: ['@flow', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      // 설정 페이지에서 새 필드를 추가하면 stub state 가 누적되어 이슈 상세 화면에서도 조회된다.
      let fields: Array<{
        id: number;
        projectId: number;
        name: string;
        type: FieldType;
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
        customFields: [] as Array<{ defId: number; name: string; type: FieldType; value: unknown }>,
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
            type: FieldType;
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
          body: JSON.stringify(createIssueDetail({
            summary: issue,
            body: '',
          })),
        }),
      );

      // PUT /fields — incoming 값을 stub state 에 머지하여 후속 GET 응답에 반영.
      const puts = trackRequests(page, 'PUT', `/api/v1/projects/${KEY}/issues/1/fields`);
      await page.route(`**/api/v1/projects/${KEY}/issues/1/fields`, (route) => {
        const incoming = (route.request().postDataJSON() as { values: Array<{ defId: number; value: unknown }> })
          .values;
        const map = new Map<
          number,
          { defId: number; name: string; type: FieldType; value: unknown }
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
          body: JSON.stringify(createIssueDetail({
            summary: issue,
            body: '',
          })),
        });
      });

      // 1) 설정 페이지에서 NUMBER 필드 추가
      // shadcn Select 교체 후 (#317): Trigger 클릭 → 항목 클릭 패턴 사용.
      await page.goto(`/projects/${KEY}/settings`);
      await page.getByTestId('custom-field-create-form').getByLabel('이름').fill('스토리포인트');
      await page.getByTestId('cf-type-select').click();
      await page.getByTestId('cf-type-option-NUMBER').click();
      await page
        .getByTestId('custom-field-create-form')
        .getByRole('button', { name: '추가' })
        .click();
      await expect(page.getByText('스토리포인트')).toBeVisible();

      // 1b) TEXT 필드도 추가 — placeholder 검증용 (#683)
      await page.getByTestId('custom-field-create-form').getByLabel('이름').fill('비고');
      await page.getByTestId('cf-type-select').click();
      await page.getByTestId('cf-type-option-TEXT').click();
      await page
        .getByTestId('custom-field-create-form')
        .getByRole('button', { name: '추가' })
        .click();
      await expect(page.getByText('비고')).toBeVisible();

      // 2) 이슈 상세에서 값 5 입력 → debounce(300ms) 후 PUT 발생.
      await page.goto(`/projects/${KEY}/issues/1`);
      // 커스텀 필드 그룹은 기본 접힘 — 펼쳐야 커스텀 필드 섹션이 DOM 에 마운트됨 (#343).
      await page.getByRole('button', { name: /커스텀 필드/ }).click();
      await expect(page.getByTestId('custom-fields-section')).toBeVisible();
      const fieldId = fields.find((f) => f.name === '스토리포인트')!.id;
      const textFieldId = fields.find((f) => f.name === '비고')!.id;
      // placeholder는 라벨(필드명)을 그대로 복제하지 않고 타입별 안내 문구여야 한다 (#683)
      await expect(page.getByTestId(`field-input-${fieldId}`)).toHaveAttribute(
        'placeholder',
        '숫자를 입력하세요',
      );
      await expect(page.getByTestId(`field-input-${textFieldId}`)).toHaveAttribute(
        'placeholder',
        '값을 입력하세요',
      );
      // WP-854 — 텍스트·숫자 칸도 선택형처럼 필드 이름으로 읽힌다(이전엔 placeholder 로만 읽혔다).
      await expect(page.getByRole('spinbutton', { name: '스토리포인트', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: '비고', exact: true })).toBeVisible();
      await page.getByTestId(`field-input-${fieldId}`).fill('5');

      await expect.poll(() => puts.lastBody(), { timeout: 2000 }).toMatchObject({
        values: [{ defId: fieldId, value: 5 }],
      });
    },
  );
});
