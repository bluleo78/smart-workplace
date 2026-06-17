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
    '필드 타입 드롭다운 shadcn Select + 목록 한국어 레이블 표시 (#317)',
    async ({ authenticatedPage: page }) => {
      // TEXT 타입 필드가 목록에서 "텍스트"로 표시되는지, 드롭다운이 shadcn Select인지 검증.
      const field = {
        id: 300,
        projectId: 1,
        name: '텍스트필드',
        type: 'TEXT',
        options: null,
        position: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await page.route(`**/api/v1/projects/${KEY}`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, key: KEY, name: 'P', description: '', ownerId: 1, ownerName: 'T', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) }),
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
      await page.route(`**/api/v1/projects/${KEY}/fields`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([field]) }),
      );

      await page.goto(`/projects/${KEY}/settings`);

      // 목록에서 "텍스트"로 표시되고, 영문 "TEXT"는 표시되지 않아야 함.
      await expect(page.getByTestId(`custom-field-row-${field.id}`)).toContainText('텍스트');
      await expect(page.getByTestId(`custom-field-row-${field.id}`)).not.toContainText('TEXT');

      // 드롭다운 트리거가 shadcn Select (role=combobox) 로 렌더됨을 검증.
      const trigger = page.getByTestId('cf-type-select');
      await expect(trigger).toBeVisible();
      // shadcn SelectTrigger는 button role로 렌더됨 — native select(combobox)가 아님.
      await expect(trigger).toHaveRole('combobox');

      // 드롭다운 열어서 한국어 옵션 확인.
      await trigger.click();
      await expect(page.getByTestId('cf-type-option-TEXT')).toContainText('텍스트');
      await expect(page.getByTestId('cf-type-option-NUMBER')).toContainText('숫자');
      await expect(page.getByTestId('cf-type-option-DATE')).toContainText('날짜');
      await expect(page.getByTestId('cf-type-option-SELECT')).toContainText('선택');
      await expect(page.getByTestId('cf-type-option-MULTI_SELECT')).toContainText('복수 선택');

      // 옵션 선택 → 폼 상태 반영.
      await page.getByTestId('cf-type-option-DATE').click();
      await expect(trigger).toContainText('날짜');
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

  test(
    'DATE 필드 Popover Calendar 선택 → PUT payload 검증 + 지우기 (#318)',
    async ({ authenticatedPage: page }) => {
      // DATE 타입 커스텀 필드가 shadcn Popover+Calendar로 렌더되고,
      // 날짜 선택 → ISO PUT + 지우기 → null PUT 파이프라인 전체를 검증한다.
      const dateDef = {
        id: 400,
        projectId: 1,
        name: '마감목표일',
        type: 'DATE',
        options: null,
        position: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
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
          body: JSON.stringify({ id: 1, key: KEY, name: 'P', description: '', ownerId: 1, ownerName: 'T', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
        }),
      );
      await page.route(`**/api/v1/projects/${KEY}/members`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ userId: 1, username: 'me', name: 'Me', role: 'OWNER' }]) }),
      );
      await page.route(`**/api/v1/projects/${KEY}/types`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(systemTypes()) }),
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
      await page.route(`**/api/v1/projects/${KEY}/fields`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([dateDef]) }),
      );
      await page.route(`**/api/v1/projects/${KEY}/issues/1`, (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: issue, body: '', comments: [], history: [], attachments: [] }),
        }),
      );

      let putPayload: unknown;
      await page.route(`**/api/v1/projects/${KEY}/issues/1/fields`, (route) => {
        putPayload = route.request().postDataJSON();
        const incoming = (putPayload as { values: Array<{ defId: number; value: unknown }> }).values;
        const map = new Map<number, { defId: number; name: string; type: string; value: unknown }>();
        for (const e of issue.customFields) map.set(e.defId, e);
        for (const v of incoming) {
          if (v.value == null) map.delete(v.defId);
          else map.set(v.defId, { defId: v.defId, name: dateDef.name, type: dateDef.type, value: v.value });
        }
        issue = { ...issue, customFields: Array.from(map.values()) };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: issue, body: '', comments: [], history: [], attachments: [] }),
        });
      });

      await page.goto(`/projects/${KEY}/issues/1`);
      await expect(page.getByTestId('custom-fields-section')).toBeVisible();

      // 트리거가 native textbox가 아닌 버튼(shadcn PopoverTrigger)으로 렌더됨을 확인
      const trigger = page.getByTestId(`field-input-${dateDef.id}`);
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveRole('button');
      await expect(trigger).toContainText('날짜 선택');

      // Popover 열어서 날짜 선택 (달력에서 15일 클릭)
      await trigger.click();
      // Popover 내 Calendar가 표시됨을 확인
      await expect(page.locator('[role="dialog"]').or(page.locator('.rdp'))).toBeVisible();

      // 달력에서 15일 버튼 클릭 (실제 존재하는 날짜)
      const dayBtn = page.getByRole('button', { name: '15' }).first();
      await expect(dayBtn).toBeVisible();
      await dayBtn.click();

      // 날짜 선택 후 PUT payload에 ISO 문자열이 포함되어야 함
      await expect.poll(() => {
        const p = putPayload as { values?: Array<{ defId: number; value: unknown }> } | undefined;
        return p?.values?.find((v) => v.defId === dateDef.id)?.value;
      }, { timeout: 2000 }).toMatch(/^\d{4}-\d{2}-15$/);

      // 날짜 선택 후 트리거에 텍스트 표시됨 (더 이상 "날짜 선택" placeholder 없음)
      await expect(trigger).not.toContainText('날짜 선택');

      // 지우기 버튼이 나타남
      const clearBtn = page.getByTestId(`field-input-${dateDef.id}-clear`);
      await expect(clearBtn).toBeVisible();

      // 지우기 클릭 → PUT payload value가 null
      putPayload = undefined;
      await clearBtn.click();
      await expect.poll(() => {
        const p = putPayload as { values?: Array<{ defId: number; value: unknown }> } | undefined;
        return p?.values?.find((v) => v.defId === dateDef.id)?.value;
      }, { timeout: 2000 }).toBeNull();

      // 지운 후 트리거에 다시 "날짜 선택" placeholder 표시
      await expect(trigger).toContainText('날짜 선택');
    },
  );
});
