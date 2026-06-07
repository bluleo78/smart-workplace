// 이슈 유형 도메인 E2E.
// 시나리오:
//   1) OWNER 가 설정 페이지에서 CUSTOM 유형(디자인)을 추가 → 이슈 상세에서 picker 로 변경 →
//      PATCH payload {typeId} 검증 + 배지 갱신 확인.
//   2) 이슈 생성 다이얼로그 유형 드롭다운이 한국어 라벨로 표시되는지 회귀 검증.

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeIssueType, systemTypes } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';

const KEY = 'WP';

test.describe('이슈 유형', () => {
  test(
    'CUSTOM 추가 → 이슈 변경 → 배지 갱신',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 시스템 4종 시드 + 초기 이슈(TASK 유형) 상태.
      let types = systemTypes();
      // type 은 IssueTypeSummary 모양으로 좁혀서 — IssueResponse.type 이 Summary 만 허용.
      const toSummary = (t: (typeof types)[number]) => ({
        id: t.id, name: t.name, colorToken: t.colorToken, icon: t.icon,
      });
      const issue = { ...createIssue({ id: 1, number: 1, title: 't' }), type: toSummary(types[0]) };

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
          issue.type = toSummary(newType);
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

  test(
    '이슈 생성 다이얼로그 유형 드롭다운이 한국어 라벨로 표시된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const types = systemTypes();

      // 프로젝트 상세 + 이슈 목록 + 유형 목록 stub.
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP' }));
      await mockApi(
        page,
        'GET',
        '/api/v1/projects/WP/issues',
        createIssueSearchResponse([]),
      );
      await page.route('**/api/v1/projects/WP/types', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(types),
        }),
      );

      await page.goto('/projects/WP');

      // 새 태스크 다이얼로그 열기.
      await page.getByRole('button', { name: '+ 새 태스크' }).click();

      // 유형 드롭다운 옵션이 한국어로 표시되어야 한다 (영문 enum 원문 노출 회귀 #126).
      const select = page.getByTestId('create-type-select');
      await expect(select).toBeVisible();
      // 시스템 5종 한국어 라벨 검증 (정확 일치 — hasText 는 부분 문자열이므로 정규식으로 앵커).
      await expect(select.locator('option').filter({ hasText: /^태스크$/ })).toHaveCount(1);
      await expect(select.locator('option').filter({ hasText: /^버그$/ })).toHaveCount(1);
      await expect(select.locator('option').filter({ hasText: /^스토리$/ })).toHaveCount(1);
      await expect(select.locator('option').filter({ hasText: /^기타$/ })).toHaveCount(1);
      await expect(select.locator('option').filter({ hasText: /^하위 태스크$/ })).toHaveCount(1);
      // 영문 enum 원문은 보여선 안 된다.
      await expect(select.locator('option').filter({ hasText: /^TASK$/ })).toHaveCount(0);
      await expect(select.locator('option').filter({ hasText: /^BUG$/ })).toHaveCount(0);
    },
  );

  test(
    '하위 태스크 선택 후 부모 번호 빈값 제출 시 한국어 오류 메시지가 표시된다',
    async ({ authenticatedPage: page }) => {
      const types = systemTypes();

      // 프로젝트 상세 + 이슈 목록 + 유형 목록 stub.
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP' }));
      await mockApi(
        page,
        'GET',
        '/api/v1/projects/WP/issues',
        createIssueSearchResponse([]),
      );
      await page.route('**/api/v1/projects/WP/types', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(types),
        }),
      );

      await page.goto('/projects/WP');

      // 새 태스크 다이얼로그 열기.
      await page.getByRole('button', { name: '+ 새 태스크' }).click();

      // 제목 입력 + 유형을 하위 태스크로 선택 → 부모 이슈 번호 필드 노출.
      await page.locator('#issue-title').fill('테스트 하위태스크');
      await page.getByTestId('create-type-select').selectOption('하위 태스크');
      await expect(page.getByTestId('create-parent-number')).toBeVisible();

      // 부모 번호를 비워둔 채 생성 클릭 → 한국어 오류 메시지가 나타나야 한다 (#159).
      await page.getByRole('button', { name: '생성' }).click();

      // 영문 원시 Zod 오류가 아닌 한국어 메시지여야 한다.
      const errorMsg = page.locator('p.text-destructive');
      await expect(errorMsg).toBeVisible();
      await expect(errorMsg).toContainText('부모 이슈 번호');
      // 영문 원시 Zod 메시지는 노출되면 안 된다 (회귀 방지).
      await expect(errorMsg).not.toContainText('Invalid input');
      await expect(errorMsg).not.toContainText('NaN');
    },
  );

  test(
    '이슈 유형 이름 변경 — shadcn Dialog 로 PATCH 발생, window.prompt 없음 (#160)',
    async ({ authenticatedPage: page }) => {
      // CUSTOM 유형 1개 (isSystem:false 여야 이름 변경 버튼이 렌더됨)
      const customType = makeIssueType({ id: 99, name: '원래유형', colorToken: 'GREEN', icon: 'Circle', isSystem: false });
      let patchBody: unknown;

      await page.route(`**/api/v1/projects/${KEY}`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: KEY })) }),
      );
      await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([createMember({ userId: 1, username: 'me', name: 'Me', role: 'OWNER' })]),
        }),
      );
      await page.route(`**/api/v1/projects/${KEY}/types`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([customType]),
        });
      });
      await page.route(`**/api/v1/projects/${KEY}/types/${customType.id}`, (route) => {
        const method = route.request().method();
        if (method !== 'PUT' && method !== 'PATCH') return route.fallback();
        patchBody = route.request().postDataJSON();
        customType.name = (patchBody as { name: string }).name;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(customType),
        });
      });

      await page.goto(`/projects/${KEY}/settings`);
      const row = page.getByTestId(`issue-type-row-${customType.id}`);
      await expect(row).toBeVisible();

      // 이름 변경 버튼 클릭 → native prompt 가 아닌 shadcn Dialog 가 떠야 함.
      await row.getByRole('button', { name: '원래유형 이름 변경' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('이슈 유형 이름 변경');

      // 새 이름 입력 후 확인 — PATCH payload 검증.
      const input = page.getByTestId('rename-dialog-input');
      await input.clear();
      await input.fill('새유형이름');
      await page.getByTestId('rename-dialog-confirm').click();

      await expect.poll(() => (patchBody as { name?: string } | undefined)?.name).toBe('새유형이름');
      // Dialog 가 닫혀야 함.
      await expect(dialog).toBeHidden();
    },
  );
});
