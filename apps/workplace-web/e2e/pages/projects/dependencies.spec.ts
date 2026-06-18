// Phase 4b 의존성 도메인 E2E.
// 시나리오 1 (smoke): 상세 진입 → '차단 중' 슬롯에 의존성 추가 → POST payload 검증
//   → 슬롯에 행 노출 → X 클릭으로 제거 → DELETE 쿼리 검증 → 행 제거 확인.
// 시나리오 2: POST 응답이 409(DEPENDENCY_CYCLE) → 토스트 노출 + picker 가 열린 상태로 유지.
// 시나리오 3 (#312): 의존성 행 삭제 버튼 hover-reveal 패턴 회귀 테스트.

import type { Page, Route } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';
import type { IssueLinkSummary } from '../../../src/types/issue';

const KEY = 'WP';
const ISSUES_BASE = `/api/v1/projects/${KEY}/issues`;

// 상세 페이지 진입에 필요한 공통 stub 묶음 — project / members / types / labels.
async function setupCommonStubs(page: Page) {
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
}

test.describe('의존성', () => {
  test(
    '차단 중 추가 → POST payload + 행 노출 → 제거 → DELETE + 행 사라짐',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const taskType = makeTaskType();
      // 서버 상태 mock — 현재 issue#1 의 blocks 리스트. mutation 마다 누적/제거.
      let blocks: IssueLinkSummary[] = [];
      let postPayload: unknown;
      let deleteUrl: string | undefined;

      await setupCommonStubs(page);

      // 이슈 상세 — 호출될 때마다 최신 blocks/blocked 반영.
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              summary: {
                ...createIssue({ id: 1, number: 1, title: 'task A' }),
                type: taskType,
                blockedBy: [],
                blocks,
                blocked: false,
              },
              body: '',
              comments: [],
              history: [],
              attachments: [],
            }),
          }),
      );

      // 의존성 컬렉션 — POST(추가) + DELETE(제거).
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/dependencies`,
        (route: Route) => {
          const req = route.request();
          if (req.method() === 'POST') {
            postPayload = req.postDataJSON();
            const body = postPayload as { otherNumber: number; direction: string };
            blocks = [
              ...blocks,
              {
                number: body.otherNumber,
                title: `이슈 ${body.otherNumber}`,
                status: 'TODO',
                type: taskType,
              },
            ];
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                summary: {
                  ...createIssue({ id: 1, number: 1, title: 'task A' }),
                  type: taskType,
                  blockedBy: [],
                  blocks,
                  blocked: false,
                },
                body: '',
                comments: [],
                history: [],
                attachments: [],
              }),
            });
          }
          if (req.method() === 'DELETE') {
            deleteUrl = req.url();
            const url = new URL(req.url());
            const on = Number(url.searchParams.get('otherNumber'));
            blocks = blocks.filter((b) => b.number !== on);
            return route.fulfill({ status: 204, body: '' });
          }
          return route.continue();
        },
      );

      await page.goto(`/projects/${KEY}/issues/1`);
      // 분류·관계 그룹은 기본 접힘 — 펼쳐야 의존성 섹션이 DOM 에 마운트됨 (#343).
      await page.getByRole('button', { name: /분류·관계/ }).click();
      await expect(page.getByTestId('issue-dependencies-section')).toBeVisible();

      // 차단 중 슬롯 — picker 열고 number 입력 후 저장.
      await page.getByTestId('issue-link-picker-trigger-blocks').click();
      await expect(page.getByTestId('issue-link-picker-blocks')).toBeVisible();
      await page.getByTestId('issue-link-picker-input-blocks').fill('42');
      await page.getByTestId('issue-link-picker-save-blocks').click();

      // POST payload — direction='blocks' 컨트랙트 검증.
      await expect
        .poll(() => postPayload)
        .toEqual({ otherNumber: 42, direction: 'blocks' });

      // 성공 토스트 + 슬롯의 행 노출 + picker close (mutateAsync 완료 후).
      await expect(page.getByText('의존성을 추가했습니다')).toBeVisible();
      await expect(page.getByTestId('issue-link-row-42')).toBeVisible();
      await expect(page.getByTestId('issue-link-picker-blocks')).toHaveCount(0);

      // 제거 — hover 후 X 클릭 (#312: hover-reveal 패턴이므로 hover 필수) → DELETE 발생 → 행 사라짐.
      const linkRow42 = page.getByTestId('issue-link-row-42');
      await linkRow42.hover();
      await page.getByTestId('issue-link-remove-42').click();

      await expect.poll(() => deleteUrl).toBeDefined();
      const url = new URL(deleteUrl!);
      expect(url.searchParams.get('otherNumber')).toBe('42');
      expect(url.searchParams.get('direction')).toBe('blocks');

      await expect(page.getByText('의존성을 제거했습니다')).toBeVisible();
      await expect(page.getByTestId('issue-link-row-42')).toHaveCount(0);
    },
  );

  test('사이클 시도 → 409 토스트 + picker 유지 + 입력 보전', async ({
    authenticatedPage: page,
  }) => {
    const taskType = makeTaskType();

    await setupCommonStubs(page);

    // 이슈 상세 — 정적 응답 (blocks 비어있음).
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...createIssue({ id: 1, number: 1, title: 'task A' }),
              type: taskType,
              blockedBy: [],
              blocks: [],
              blocked: false,
            },
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        }),
    );

    // POST → 409 DEPENDENCY_CYCLE.
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1/dependencies`,
      (route: Route) => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'DEPENDENCY_CYCLE',
              message: '의존성 사이클이 발생합니다',
            }),
          });
        }
        return route.continue();
      },
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    // 분류·관계 그룹은 기본 접힘 — 펼쳐야 의존성 섹션이 DOM 에 마운트됨 (#343).
    await page.getByRole('button', { name: /분류·관계/ }).click();
    await expect(page.getByTestId('issue-dependencies-section')).toBeVisible();

    // 차단 중 picker — 번호 입력 후 저장 시도.
    await page.getByTestId('issue-link-picker-trigger-blocks').click();
    await page.getByTestId('issue-link-picker-input-blocks').fill('7');
    await page.getByTestId('issue-link-picker-save-blocks').click();

    // 토스트 — 백엔드 메시지 노출.
    await expect(page.getByText('의존성 사이클이 발생합니다')).toBeVisible();

    // picker 유지 + 입력 보전.
    await expect(page.getByTestId('issue-link-picker-blocks')).toBeVisible();
    await expect(page.getByTestId('issue-link-picker-input-blocks')).toHaveValue('7');

    // 행은 추가되지 않음.
    await expect(page.getByTestId('issue-link-row-7')).toHaveCount(0);
  });

  // #312 — 의존성 행 삭제 버튼 hover-reveal 패턴 회귀 테스트.
  test('의존성 행 삭제 버튼은 hover 전 숨겨지고 hover 후 표시된다', async ({
    authenticatedPage: page,
  }) => {
    const taskType = makeTaskType();
    const blockingLink: IssueLinkSummary = {
      number: 99,
      title: '선행 이슈',
      status: 'TODO',
      type: taskType,
    };

    await setupCommonStubs(page);

    // blockedBy 에 행 1개 포함한 이슈 상세.
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...createIssue({ id: 1, number: 1, title: 'task A' }),
              type: taskType,
              blockedBy: [blockingLink],
              blocks: [],
              blocked: true,
            },
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        }),
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    // 분류·관계 그룹은 기본 접힘 — 펼쳐야 의존성 행이 DOM 에 마운트됨 (#343).
    await page.getByRole('button', { name: /분류·관계/ }).click();
    await expect(page.getByTestId('issue-link-row-99')).toBeVisible();

    const row = page.getByTestId('issue-link-row-99');
    const removeBtn = page.getByTestId('issue-link-remove-99');

    // hover 전: 삭제 버튼이 DOM에 있지만 숨겨진 상태.
    await expect(removeBtn).toBeHidden();

    // hover 후: 삭제 버튼이 표시됨.
    await row.hover();
    await expect(removeBtn).toBeVisible();
  });
});
