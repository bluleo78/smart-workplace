// Phase 4b 의존성 도메인 E2E — WP-887 부터 차단은 「관계」 그룹의 「＋ 관계 추가」 창에서 건다(저장은 그대로 의존성 API).
// 시나리오 1 (smoke): 상세 진입 → 관계 추가 창에서 「차단 중」 + 이슈 찾기 → POST payload 검증
//   → 「차단 중」 묶음에 행 노출 → X 클릭으로 제거 → DELETE 쿼리 검증 → 행 제거 확인.
// 시나리오 2: POST 응답이 409(DEPENDENCY_CYCLE) → 토스트 노출 + 창이 열린 채 고른 이슈 유지.
//   (옛 번호 입력 칸의 번호 검사(WP-470·618·852)는 찾기 목록에서 고르는 방식이 되며 사라졌다 — 없는 번호는 목록에 나오지 않는다.)
// 시나리오 3 (#312): 의존성 행 삭제 버튼 hover-reveal 패턴 회귀 테스트.

import type { Page, Route } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { stableBox } from '../../fixtures/wait';
import type { IssueLookupItem } from '../../../src/types/issue';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
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

/** 「관계」 그룹 머리(접기 버튼) — 접혀 있으면 이름에 배지 수가 붙고, 옆 「관계 추가」 버튼과 구분되게 앵커로 고정한다. */
function relationsGroupTrigger(page: Page) {
  return page.getByTestId('property-group-relations').getByRole('button', { name: /^관계(\s*\d+)?$/ });
}

/** 관계 대상 찾기 스텁 — 받은 검색 주소를 기록하고 items 를 돌려준다. */
async function stubLookup(page: Page, items: IssueLookupItem[]) {
  const lookups = trackRequests(page, 'GET', '/api/v1/issues/lookup');
  await page.route(
    (url) => url.pathname === '/api/v1/issues/lookup',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(items) }),
  );
  return lookups;
}

/** 관계 추가 창을 열고 「이 이슈는…」 말을 고른 뒤 번호로 찾아 그 이슈를 고른다. */
async function pickBlockingTarget(page: Page, label: string, query: string, number: number) {
  await page.getByTestId('issue-relation-add').click();
  await expect(page.getByTestId('issue-relation-dialog')).toBeVisible();
  await page.getByTestId('issue-relation-type-select').click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.getByTestId('issue-relation-search').fill(query);
  await page.getByTestId(`issue-relation-result-${KEY}-${number}`).click();
}

test.describe('의존성', () => {
  test(
    '관계 추가 창에서 차단 중 추가 → POST payload + 행 노출 → 제거 → DELETE + 행 사라짐',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const taskType = makeTaskType();
      // 서버 상태 mock — 현재 issue#1 의 blocks 리스트. mutation 마다 누적/제거.
      let blocks: IssueLinkSummary[] = [];
      const depPosts = trackRequests(page, 'POST', `${ISSUES_BASE}/1/dependencies`);
      const depDeletes = trackRequests(page, 'DELETE', `${ISSUES_BASE}/1/dependencies`);

      await setupCommonStubs(page);

      // 이슈 상세 — 호출될 때마다 최신 blocks/blocked 반영.
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueDetail({
              summary: {
                ...createIssue({ id: 1, number: 1, title: 'task A' }),
                type: taskType,
                blockedBy: [],
                blocks,
                blocked: false,
              },
              body: '',
            })),
          }),
      );

      // 의존성 컬렉션 — POST(추가) + DELETE(제거).
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/dependencies`,
        (route: Route) => {
          const req = route.request();
          if (req.method() === 'POST') {
            const body = req.postDataJSON() as { otherNumber: number; direction: string };
            blocks = [
              ...blocks,
              {
                number: body.otherNumber,
                title: `이슈 ${body.otherNumber}`,
                status: 'TODO',
                type: taskType,
                dueDate: null,
              },
            ];
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(createIssueDetail({
                summary: {
                  ...createIssue({ id: 1, number: 1, title: 'task A' }),
                  type: taskType,
                  blockedBy: [],
                  blocks,
                  blocked: false,
                },
                body: '',
              })),
            });
          }
          if (req.method() === 'DELETE') {
            const url = new URL(req.url());
            const on = Number(url.searchParams.get('otherNumber'));
            blocks = blocks.filter((b) => b.number !== on);
            return route.fulfill({ status: 204, body: '' });
          }
          return route.continue();
        },
      );

      // 찾기 결과 — 현재 이슈(#1)도 섞여 오지만 창이 거른다.
      const lookups = await stubLookup(page, [
        { projectKey: KEY, number: 1, title: 'task A', status: 'TODO', type: taskType },
        { projectKey: KEY, number: 42, title: '이슈 42', status: 'TODO', type: taskType },
      ]);

      await page.goto(`/projects/${KEY}/issues/1`);
      // 관계 그룹은 기본 접힘 — 펼쳐야 관계 섹션이 DOM 에 마운트됨 (#343). 비어 있으면 「없음」 한 줄.
      await relationsGroupTrigger(page).click();
      await expect(page.getByTestId('issue-relations-section')).toHaveText('없음');

      // 관계 추가 창 — 「차단 중」 + 번호로 찾아 고른 뒤 추가.
      await pickBlockingTarget(page, '차단 중', '42', 42);
      // 찾기 요청 — 번호만 쳐도 그대로 묻고 현재 프로젝트를 from 으로 싣는다(서버가 이 프로젝트의 그 번호를 20건 상한 안 맨 앞에 둔다).
      expect(lookups.lastUrl()?.searchParams.get('q')).toBe('42');
      expect(lookups.lastUrl()?.searchParams.get('from')).toBe(KEY);
      await expect(page.getByTestId(`issue-relation-result-${KEY}-1`)).toHaveCount(0);
      await page.getByTestId('issue-relation-submit').click();

      // POST payload — direction='blocks' 컨트랙트 검증(차단은 의존성 API 로 간다).
      await expect
        .poll(() => depPosts.lastBody())
        .toEqual({ otherNumber: 42, direction: 'blocks' });

      // 성공 토스트 + 「차단 중」 묶음의 행 노출 + 창 닫힘 (mutateAsync 완료 후).
      await expect(page.getByText('차단 관계를 추가했습니다')).toBeVisible();
      await expect(page.getByTestId('blocks-list').getByTestId('issue-link-row-42')).toBeVisible();
      await expect(page.getByTestId('issue-relation-dialog')).toHaveCount(0);

      // 제거 — hover 후 X 클릭 (#312: hover-reveal 패턴이므로 hover 필수) → DELETE 발생 → 행 사라짐.
      const linkRow42 = page.getByTestId('issue-link-row-42');
      await linkRow42.hover();
      await page.getByTestId('issue-link-remove-42').click();

      await depDeletes.waitFor();
      const url = depDeletes.urls()[0];
      expect(url.searchParams.get('otherNumber')).toBe('42');
      expect(url.searchParams.get('direction')).toBe('blocks');

      await expect(page.getByText('차단 관계를 제거했습니다')).toBeVisible();
      await expect(page.getByTestId('issue-link-row-42')).toHaveCount(0);
    },
  );

  test('사이클 시도 → 409 토스트 + 창 유지 + 고른 이슈 보전', async ({
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
          body: JSON.stringify(createIssueDetail({
            summary: {
              ...createIssue({ id: 1, number: 1, title: 'task A' }),
              type: taskType,
              blockedBy: [],
              blocks: [],
              blocked: false,
            },
            body: '',
          })),
        }),
    );

    // POST → 409 DEPENDENCY_CYCLE.
    let posts = 0;
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1/dependencies`,
      (route: Route) => {
        if (route.request().method() === 'POST') {
          posts += 1;
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

    await stubLookup(page, [{ projectKey: KEY, number: 7, title: '이슈 7', status: 'TODO', type: taskType }]);

    await page.goto(`/projects/${KEY}/issues/1`);
    await relationsGroupTrigger(page).click();

    // 「차단됨 (선행 필요)」 + #7 — 고르기 전엔 추가 버튼이 꺼져 있다(요청 없음).
    await page.getByTestId('issue-relation-add').click();
    await expect(page.getByTestId('issue-relation-submit')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('issue-relation-dialog')).toHaveCount(0);
    await pickBlockingTarget(page, '차단됨 (선행 필요)', '#7', 7);
    expect(posts).toBe(0);
    await page.getByTestId('issue-relation-submit').click();

    // 토스트 — 백엔드 메시지 노출.
    await expect(page.getByText('의존성 사이클이 발생합니다')).toBeVisible();
    expect(posts).toBe(1);

    // 창 유지 + 고른 이슈 보전 — 다시 누를 수 있다.
    await expect(page.getByTestId('issue-relation-dialog')).toBeVisible();
    await expect(page.getByTestId('issue-relation-selected')).toContainText('#7');
    await expect(page.getByTestId('issue-relation-submit')).toBeEnabled();

    // 행은 추가되지 않음.
    await expect(page.getByTestId('issue-link-row-7')).toHaveCount(0);
  });

  // #312 — 의존성 행 삭제 버튼 hover-reveal 패턴 회귀 테스트.
  // WP-468 — 숨김은 투명도로만 한다: 키보드(Tab)로도 닿고, 포커스를 받으면 보이며 Enter 로 제거된다.
  test('의존성 행 삭제 버튼은 hover·키보드 포커스 때만 보이고 키보드로 제거할 수 있다', async ({
    authenticatedPage: page,
  }) => {
    const taskType = makeTaskType();
    const blockingLink: IssueLinkSummary = {
      number: 99,
      title: '선행 이슈',
      status: 'TODO',
      type: taskType,
      dueDate: null,
    };

    await setupCommonStubs(page);

    // blockedBy 에 행 1개 포함한 이슈 상세.
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueDetail({
            summary: {
              ...createIssue({ id: 1, number: 1, title: 'task A' }),
              type: taskType,
              blockedBy: [blockingLink],
              blocks: [],
              blocked: true,
            },
            body: '',
          })),
        }),
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    // 관계 그룹은 기본 접힘 — 펼쳐야 의존성 행이 DOM 에 마운트됨 (#343).
    await relationsGroupTrigger(page).click();
    await expect(page.getByTestId('blocked-by-list').getByTestId('issue-link-row-99')).toBeVisible();

    const row = page.getByTestId('issue-link-row-99');
    const removeBtn = page.getByTestId('issue-link-remove-99');

    // hover 전: 삭제 버튼이 보이지 않는다(투명).
    await expect(removeBtn).toHaveCSS('opacity', '0');

    // hover 후: 삭제 버튼이 표시됨.
    await row.hover();
    await expect(removeBtn).toHaveCSS('opacity', '1');
    await page.mouse.move(0, 0);
    await expect(removeBtn).toHaveCSS('opacity', '0');

    // 키보드: 행의 이슈 링크에서 Tab 하면 제거 버튼으로 포커스가 가고 보인다.
    const removes = trackRequests(page, 'DELETE', `${ISSUES_BASE}/1/dependencies`);
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1/dependencies`,
      (route) => route.fulfill({ status: 204, body: '' }),
    );
    await row.getByRole('link', { name: '선행 이슈' }).focus();
    await page.keyboard.press('Tab');
    await expect(removeBtn).toBeFocused();
    await expect(removeBtn).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await removes.waitFor(1);
    expect(removes.lastUrl()?.searchParams.get('otherNumber')).toBe('99');
  });

  /** 실제 길이의 제목 — 좁은 오른쪽 레일에서 제목이 상태에 밀려 굶지 않는지 본다. */
  const LONG_LINK_TITLE = '결제 모듈 환불 처리 간헐적 실패 — PG사 웹훅 재시도 시 중복 환불 방지 로직 검토';

  // WP-869 — 링크 행이 범주 라벨(「진행 중」)만 보여 사용자 정의 상태(「검토 중」)를 알 수 없었다.
  // WP-991 — 관계 줄은 한 줄: [상태 아이콘][유형 아이콘] 키 제목. 상태 이름은 아이콘 툴팁·aria-label 로만.
  test('링크 행은 한 줄로, 상태 이름은 상태 아이콘 툴팁으로 보인다', { tag: ['@layout', '@input'] }, async ({ authenticatedPage: page }) => {
    const taskType = makeTaskType();
    await setupCommonStubs(page);
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueDetail({
            summary: {
              ...createIssue({ id: 1, number: 1, title: 'task A' }),
              type: taskType,
              blockedBy: [
                { number: 5, title: LONG_LINK_TITLE, status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중', statusColor: 'PURPLE', type: taskType, dueDate: null },
                // 구 서버 응답 — 상태 이름이 없으면 범주 라벨.
                { number: 6, title: '옛 응답 선행', status: 'DONE', type: taskType, dueDate: null },
              ],
              blocks: [],
              blocked: true,
            },
            body: '',
          })),
        }),
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    await relationsGroupTrigger(page).click();
    const row = page.getByTestId('issue-link-row-5');
    const status = page.getByTestId('issue-link-status-5');
    // 상태는 아이콘만 — 상태 색(PURPLE)이고 상태 이름(범주 라벨이 아니라 프로젝트 상태 이름)을 aria-label 로 알린다.
    await expect(status.getByRole('img', { name: '상태: 검토 중' })).toHaveClass(/text-purple-700/);
    await expect(row).not.toContainText('검토 중');
    await expect(row).not.toContainText('진행 중');
    // 구 서버 응답 — 상태 이름이 없으면 범주 라벨.
    await expect(page.getByTestId('issue-link-status-6').getByRole('img', { name: '상태: 완료' })).toBeVisible();
    // 마우스를 올리면 상태 이름이 툴팁으로 보인다.
    await status.hover();
    await expect(page.getByRole('tooltip')).toHaveText('검토 중');

    // 한 줄 구성 — 상태 아이콘·키·제목이 같은 줄 가운데에 있고, 행이 두 줄로 늘지 않으며, 긴 제목이 남는 폭을 대부분 쓴다.
    const title = await stableBox(row.getByRole('link', { name: LONG_LINK_TITLE }));
    // 같은 프로젝트 이슈는 키를 「#5」 로 줄여 보인다(WP-887).
    const key = await stableBox(row.getByText('#5', { exact: true }));
    const statusBox = await stableBox(status);
    const rowBox = await stableBox(row);
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    expect(Math.abs(mid(statusBox) - mid(title))).toBeLessThanOrEqual(2);
    expect(Math.abs(mid(key) - mid(title))).toBeLessThanOrEqual(2);
    expect(statusBox.x).toBeLessThan(key.x);
    expect(rowBox.height).toBeLessThan(title.height * 2);
    expect(title.x + title.width - statusBox.x).toBeGreaterThan((rowBox.width - 24) * 0.75);
  });

  // #669 — 미완료 선행(blockedBy) 이슈의 마감일보다 이른 날짜를 시작일/마감일에 선택하면
  // 인라인 경고가 뜨지만, 저장(PATCH)은 그대로 진행되어야 한다(soft 경고 정책, 결정 코멘트 참조).
  test('선행 이슈 마감일보다 이른 마감일 선택 시 인라인 경고 노출 + 저장은 성공', async ({
    authenticatedPage: page,
  }) => {
    const taskType = makeTaskType();
    // 다음 달 1일 — ISO 문자열 비교로 이번 달의 어떤 날짜보다도 항상 늦다(월경계 안전).
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
    const blockerDueDate = nextMonth.toISOString().slice(0, 10);
    const blockingLink: IssueLinkSummary = {
      number: 21,
      title: '결제 모듈 환불 처리 간헐적 실패',
      status: 'IN_PROGRESS', // 미완료 — 경고 대상.
      type: taskType,
      dueDate: blockerDueDate,
    };

    await setupCommonStubs(page);

    let currentDueDate: string | null = null;
    const patches = trackRequests(page, 'PATCH', `${ISSUES_BASE}/1`);

    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) => {
        if (route.request().method() === 'PATCH') {
          const payload = route.request().postDataJSON() as Record<string, unknown>;
          if (typeof payload.dueDate === 'string') currentDueDate = payload.dueDate;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...createIssue({ id: 1, number: 1, title: 'task A', dueDate: currentDueDate }),
              type: taskType,
            }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...createIssue({ id: 1, number: 1, title: 'task A', dueDate: currentDueDate }),
              type: taskType,
              blockedBy: [blockingLink],
              blocks: [],
              blocked: true,
            },
            body: '',
            comments: [],
            history: [],
            attachments: [],
            viewerCanEditWorkflow: true,
            viewerCanEditContent: true,
            viewerCanDelete: true,
          }),
        });
      },
    );

    await page.goto(`/projects/${KEY}/issues/1`);

    // 마감일 없음 → 경고 없음.
    await expect(page.getByTestId('due-date-warning')).toHaveCount(0);

    // 마감일 피커 — 이번 달 10일 선택(선행 이슈 마감일은 다음 달이라 항상 더 이름).
    await page.getByTestId('due-date-trigger').click();
    await expect(page.getByTestId('due-date-popover')).toBeVisible();
    const day10 = page
      .locator('[data-testid="due-date-popover"] [data-slot="calendar"] button[data-day]', { hasText: '10' })
      .first();
    await day10.click();

    // PATCH 는 그대로 나가고(차단 없음), 인라인 경고가 노출된다.
    await patches.waitFor();
    expect(typeof patches.bodies<Record<string, unknown>>()[0].dueDate).toBe('string');
    await expect(page.getByTestId('due-date-warning')).toBeVisible();
    await expect(page.getByTestId('due-date-warning')).toContainText(blockerDueDate);

    // 새로고침(서버 재조회) 후에도 저장된 값이 유지 — "저장은 성공" 이 실제로 영속됐음을 단언.
    await page.reload();
    await expect(page.getByTestId('due-date-trigger')).toContainText('10일');
    await expect(page.getByTestId('due-date-warning')).toBeVisible();
  });

  // #827 — 미완료 선행(blockedBy) 이슈가 있는 상태에서 '완료'로 전환하면 확인 다이얼로그가 뜬다.
  // 취소하면 PATCH 가 나가지 않고 상태 유지, 확인하면 그대로 PATCH (서버 차단 없음 — soft 경고 정책).
  test('미완료 선행 이슈가 있을 때 완료 전환 → 확인 다이얼로그 / 취소 시 미변경 / 확인 시 PATCH', async ({
    authenticatedPage: page,
  }) => {
    const taskType = makeTaskType();
    const activeBlocker: IssueLinkSummary = {
      number: 21,
      title: '결제 모듈 환불 처리 간헐적 실패',
      status: 'IN_PROGRESS', // 미완료 — 다이얼로그 대상.
      type: taskType,
      dueDate: null,
    };
    const doneBlocker: IssueLinkSummary = {
      number: 22,
      title: '이미 끝난 선행',
      status: 'DONE', // 완료 — 목록에서 제외돼야 함.
      type: taskType,
      dueDate: null,
    };

    await setupCommonStubs(page);

    let currentStatus: 'TODO' | 'DONE' = 'TODO';
    const patches = trackRequests(page, 'PATCH', `${ISSUES_BASE}/1`);

    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) => {
        if (route.request().method() === 'PATCH') {
          const payload = route.request().postDataJSON() as Record<string, unknown>;
          // 상태 선택은 프로젝트 상태 id 를 보낸다(WP-808) — 시드 「완료」 id 3.
          if (payload.statusId === 3) currentStatus = 'DONE';
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...createIssue({ id: 1, number: 1, title: 'task A', status: currentStatus }),
              type: taskType,
            }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...createIssue({ id: 1, number: 1, title: 'task A', status: currentStatus }),
              type: taskType,
              blockedBy: [activeBlocker, doneBlocker],
              blocks: [],
              blocked: currentStatus !== 'DONE',
            },
            body: '',
            comments: [],
            history: [],
            attachments: [],
            viewerCanEditWorkflow: true,
            viewerCanEditContent: true,
            viewerCanDelete: true,
          }),
        });
      },
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    const statusSelect = page.getByTestId('issue-status-select');
    await expect(statusSelect).toContainText('할 일');

    // 1) 완료 선택 → 다이얼로그 노출, PATCH 는 아직 안 나감. 미완료 선행 1건만 목록에 표시.
    await statusSelect.click();
    await page.getByRole('option', { name: '완료' }).click();
    const dialog = page.getByTestId('status-done-blocked-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('선행 이슈 1건이 아직 완료되지 않았습니다');
    await expect(page.getByTestId('status-done-blocked-list')).toContainText(`${KEY}-21`);
    await expect(page.getByTestId('status-done-blocked-list')).not.toContainText(`${KEY}-22`);
    expect(patches.count()).toBe(0);

    // 2) 취소 → 다이얼로그 닫힘, 상태 유지, PATCH 없음.
    await page.getByTestId('status-done-blocked-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(statusSelect).toContainText('할 일');
    expect(patches.count()).toBe(0);

    // 3) 다시 완료 선택 → 확인 → PATCH statusId=3(완료) 전송 + UI 반영.
    await statusSelect.click();
    await page.getByRole('option', { name: '완료' }).click();
    await expect(dialog).toBeVisible();
    await page.getByTestId('status-done-blocked-confirm').click();
    await expect.poll(patches.count).toBe(1);
    expect(patches.bodies<{ statusId?: number }>()[0].statusId).toBe(3);
    await expect(statusSelect).toContainText('완료');

    // 4) 진행 중 → 완료가 아닌 전환(예: 취소)은 다이얼로그 없이 즉시 PATCH.
    await statusSelect.click();
    await page.getByRole('option', { name: '취소' }).click();
    await expect.poll(patches.count).toBe(2);
    expect(patches.bodies<{ statusId?: number }>()[1].statusId).toBe(4);
    await expect(page.getByTestId('status-done-blocked-dialog')).toHaveCount(0);
  });
});
