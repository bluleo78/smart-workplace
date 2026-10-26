// 이슈 유형 E2E — 설정에서 CUSTOM 유형을 만들고 → 이슈 상세 picker 로 바꿔 PATCH·배지가 갱신되는 두 화면 흐름(@flow)만 남긴다.
// 새 이슈 다이얼로그의 유형 한국어 라벨·제목 고정·부모 번호/본문 검증·로딩 중 Select 경고, 설정의 유형 편집(PATCH·409)·삭제 이름은
// 페이지 테스트 src/pages/projects/issueTypes.test.tsx 가 지킨다(WP-980).

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue } from '../../factories/issue.factory';
import { makeIssueType, systemTypes } from '../../factories/issueType.factory';
import { expectSelectedRow } from '../../fixtures/selection';

const KEY = 'WP';

test.describe('이슈 유형', () => {
  test(
    'CUSTOM 추가 → 이슈 변경 → 배지 갱신',
    { tag: ['@flow', '@smoke'] },
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
            // OPEN 유형 도입으로 추가된 서버 capability 플래그(#OPEN). 이 스텁은 일반 프로젝트 멤버를
            // 가정하므로 셋 다 true — 없으면 IssueDetailPage 가 ?? false 로 유형 트리거를 disabled 처리해
            // 유형 변경 클릭이 타임아웃된다.
            viewerCanEditContent: true,
            viewerCanEditWorkflow: true,
            viewerCanDelete: true,
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

      // PATCH /issues/1/type — 응답에서 갱신된 type 반영.
      const typePatches = trackRequests(page, 'ANY', `/api/v1/projects/${KEY}/issues/1/type`);
      await page.route(`**/api/v1/projects/${KEY}/issues/1/type`, (route) => {
        const tid = (route.request().postDataJSON() as { typeId: number }).typeId;
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
      // 견본·아이콘은 코드값(PURPLE·Star) 대신 한국어 이름으로 찾힌다 — 스크린리더가 읽는 이름(WP-849).
      await createForm.getByRole('button', { name: '보라' }).click();
      await expect(createForm.getByRole('button', { name: '보라' })).toHaveAttribute('aria-pressed', 'true');
      await createForm.getByRole('button', { name: '별' }).click();
      await expect(createForm.getByTestId('issue-type-icon-Star')).toHaveAttribute('aria-pressed', 'true');
      await expect(createForm.getByRole('button', { name: 'PURPLE' })).toHaveCount(0);
      await page
        .getByTestId('issue-type-create-form')
        .getByRole('button', { name: '추가' })
        .click();
      await expect(page.getByText('디자인')).toBeVisible();

      // 2) 이슈 상세에서 picker 로 디자인 선택 → PATCH 검증 + 배지 갱신.
      await page.goto(`/projects/${KEY}/issues/1`);
      await page.getByTestId('issue-type-trigger').click();
      const designId = types.find((t) => t.name === '디자인')!.id;
      // WP-368 — 현재 유형(TASK)만 선택 표시(bg-selected + 막대), 고르려는 유형엔 없다.
      const currentOpt = page.getByTestId(`issue-type-option-${issue.type.id}`);
      const otherOpt = page.getByTestId(`issue-type-option-${designId}`);
      await expectSelectedRow(currentOpt, otherOpt);
      await otherOpt.click();

      await expect.poll(() => typePatches.lastBody()).toEqual({ typeId: designId });
      await expect(page.getByTestId(`issue-type-badge-${designId}`)).toBeVisible();
    },
  );
});
