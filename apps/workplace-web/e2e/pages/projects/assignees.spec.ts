// 이슈 담당자 피커 E2E — 긴 이름·아이디가 한 줄로 말줄임되는 실제 배치(@layout)만 남긴다.
// 추가·해제 PUT payload·토스트·상세 반영, AGENT 배지, 비활성 구성원 처리는
// src/pages/projects/issueDetailFields.test.tsx 페이지 테스트가 지킨다(WP-971).

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { IssueDetailResponse } from '../../../src/types/issue';
import type { UserSummary } from '../../../src/types/user';

const PROJECT_KEY = 'WP';

const USER1: UserSummary = { id: 1, username: 'testuser', name: '테스트 사용자', kind: 'HUMAN' };
const USER2: UserSummary = { id: 2, username: 'second', name: '두번째 멤버', kind: 'HUMAN' };

// 공통 stub — 상세에서 동시에 떨어지는 부수 endpoint 들을 모두 막는다.
async function setupCommonStubs(
  page: import('@playwright/test').Page,
  detailRef: { current: IssueDetailResponse },
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );

  // 멤버 목록 — picker 와 isOwner 체크가 함께 호출.
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        createMember({ userId: USER1.id, username: USER1.username, name: USER1.name, role: 'OWNER' }),
        createMember({ userId: USER2.id, username: USER2.username, name: USER2.name, role: 'MEMBER' }),
      ]),
    });
  });

  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailRef.current),
      });
    },
  );

  // watcher / 라벨 / 첨부 — IssueDetailPage 가 동시에 fetch.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watchers`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    },
  );
}

test.describe('이슈 담당자(다중)', () => {
  // WP-461: 긴 이름·긴 아이디도 한 줄 — 이름이 글자 단위로 여러 줄 쪼개지지 않고, 아이디가 먼저 말줄임된다.
  test('긴 이름·아이디의 멤버도 픽커에서 한 줄로 보이고 전체 값은 title 로 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const LONG = { id: 7, username: 'kim.minsu.platform-infra@example.com', name: '김민수 선임연구원 (플랫폼개발본부 인프라팀)' };
    // 짧은 이름 + 긴 아이디 — 아이디가 남는 자리만 써서 이름은 잘리지 않아야 한다.
    const SHORT = { id: 8, username: 'admin.operations.longname@work-loop.example.com', name: 'Work Loop Admin' };
    const detailRef = {
      current: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '담당자 테스트', assignees: [] }) }),
    };
    await setupCommonStubs(page, detailRef);
    // 나중에 등록한 route 가 먼저 — 멤버 목록만 긴 이름 멤버로 바꾼다.
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
      route.request().method() !== 'GET'
        ? route.fallback()
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              createMember({ userId: USER1.id, username: USER1.username, name: USER1.name, role: 'OWNER' }),
              createMember({ userId: LONG.id, username: LONG.username, name: LONG.name, role: 'MEMBER' }),
              createMember({ userId: SHORT.id, username: SHORT.username, name: SHORT.name, role: 'MEMBER' }),
            ]),
          }),
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByTestId('assignee-picker-trigger').click();
    const option = page.getByTestId(`assignee-option-${LONG.id}`);
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute('title', `${LONG.name} @${LONG.username}`);

    // 이름·아이디 모두 한 줄 — 줄 높이를 넘지 않고, 행이 픽커 밖으로 넘치지 않는다.
    const lines = await option.evaluate((row) =>
      Array.from(row.querySelectorAll('span'))
        .filter((s) => s.textContent === row.getAttribute('title')?.split(' @')[0] || s.textContent?.startsWith('@'))
        .map((s) => Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight))),
    );
    expect(lines).toEqual([1, 1]);
    const [rowBox, pickerBox] = await Promise.all([option.boundingBox(), page.getByTestId('assignee-picker').boundingBox()]);
    expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(pickerBox!.x + pickerBox!.width);

    // 짧은 이름은 말줄임 없이 다 보인다(아이디만 줄어든다).
    const shortName = page.getByTestId(`assignee-option-${SHORT.id}`).getByText(SHORT.name, { exact: true });
    expect(await shortName.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
});
