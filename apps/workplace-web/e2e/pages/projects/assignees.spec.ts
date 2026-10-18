// 이슈 담당자(다중) 도메인 E2E — Phase 3c.
// 시나리오:
//  1) 빈 상태에서 user1+user2 추가 → PUT { userIds:[u1,u2] } 검증 + 상세 아바타 2개/이름 노출 (@smoke)
//  2) 기존 [user1] 상태에서 모두 해제 → PUT { userIds: [] } + 미지정 표시

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createAgentMember, createMember, createProject } from '../../factories/project.factory';
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
  test(
    '빈 상태에서 user1+user2 추가 → PUT {userIds:[1,2]} + 상세 아바타 노출',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 가변 상세 — PUT 응답 후 재조회되면 새 assignees 가 반영되도록.
      const detailRef = {
        current: createIssueDetail({
          summary: createIssue({ id: 1, number: 1, title: '담당자 미지정', assignees: [] }),
        }),
      };

      await setupCommonStubs(page, detailRef);

      const puts = trackRequests(page, 'PUT', `/api/v1/projects/${PROJECT_KEY}/issues/1/assignees`);
      await page.route(
        (url) =>
          url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/assignees`,
        (route) => {
          if (route.request().method() !== 'PUT') return route.fallback();
          const { userIds } = route.request().postDataJSON() as { userIds: number[] };
          // 응답: 변경된 UserSummary[] — 다음 detail GET 에도 반영.
          const updated = [USER1, USER2].filter((u) => userIds.includes(u.id));
          detailRef.current = {
            ...detailRef.current,
            summary: { ...detailRef.current.summary, assignees: updated },
          };
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(updated),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      // 초기: 미지정.
      await expect(page.getByTestId('issue-assignees')).toContainText('미지정');

      // Picker 열기 → 두 멤버 체크 → 외부로 포커스/Escape 로 닫기.
      await page.getByTestId('assignee-picker-trigger').click();
      await expect(page.getByTestId('assignee-picker')).toBeVisible();

      await page.getByTestId(`assignee-option-${USER1.id}`).click();
      await page.getByTestId(`assignee-option-${USER2.id}`).click();

      // 팝오버 외부로 닫기 — Escape 키.
      await page.keyboard.press('Escape');

      // PUT 발생 + 페이로드 정확.
      await puts.waitFor();
      expect(puts.lastBody()).toEqual({ userIds: [USER1.id, USER2.id] });
      expect(puts.count()).toBe(1);

      // 토스트.
      await expect(page.getByText('담당자를 저장했습니다')).toBeVisible();

      // 상세 사이드바에 아바타/이름 2개 노출.
      await expect(page.getByTestId(`issue-assignee-${USER1.id}`)).toBeVisible();
      await expect(page.getByTestId(`issue-assignee-${USER2.id}`)).toBeVisible();
      await expect(page.getByTestId(`issue-assignee-${USER1.id}`)).toContainText(USER1.name);
      await expect(page.getByTestId(`issue-assignee-${USER2.id}`)).toContainText(USER2.name);
      await expect(page.getByTestId(`user-avatar-${USER1.id}`).first()).toBeVisible();
      await expect(page.getByTestId(`user-avatar-${USER2.id}`).first()).toBeVisible();
    },
  );

  test('기존 [user1] → 모두 해제 → PUT {userIds:[]} + 미지정 표시', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({
          id: 1,
          number: 1,
          title: '담당자 보유',
          assignees: [USER1],
        }),
      }),
    };

    await setupCommonStubs(page, detailRef);

    const puts = trackRequests(page, 'PUT', `/api/v1/projects/${PROJECT_KEY}/issues/1/assignees`);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/assignees`,
      (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        detailRef.current = {
          ...detailRef.current,
          summary: { ...detailRef.current.summary, assignees: [] },
        };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    // 초기: user1 노출.
    await expect(page.getByTestId(`issue-assignee-${USER1.id}`)).toBeVisible();

    // Picker 열기 → user1 체크 해제 → Escape 로 닫기.
    await page.getByTestId('assignee-picker-trigger').click();
    await expect(page.getByTestId('assignee-picker')).toBeVisible();
    await page.getByTestId(`assignee-option-${USER1.id}`).click();
    await page.keyboard.press('Escape');

    await puts.waitFor();
    expect(puts.lastBody()).toEqual({ userIds: [] });
    await expect(page.getByText('담당자를 저장했습니다')).toBeVisible();
    await expect(page.getByTestId('issue-assignees')).toContainText('미지정');
  });

  // Phase 5 (#20): AGENT 멤버는 픽커 항목에서 AgentBadge 로 HUMAN 과 구분된다.
  test('AGENT 멤버는 픽커에서 시각적으로 구분된다', async ({ authenticatedPage: page }) => {
    const AGENT_ID = 99;
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: 1, title: '담당자 테스트', assignees: [] }),
      }),
    };

    // setupCommonStubs 는 USER1/USER2 만 멤버로 등록하므로 멤버 라우트를 직접 덮어쓴다.
    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject()),
      }),
    );
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          createMember({ userId: USER1.id, username: USER1.username, name: USER1.name, role: 'OWNER' }),
          createAgentMember({ userId: AGENT_ID, username: 'ai-agent', name: 'AI Agent' }),
        ]),
      });
    });
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detailRef.current),
        }),
    );
    // 부수 endpoint 들 — 빈 응답.
    for (const sub of ['watchers', 'labels', 'attachments']) {
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/${sub}`,
        (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
    }
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByTestId('assignee-picker-trigger').click();
    await expect(page.getByTestId('assignee-picker')).toBeVisible();

    // HUMAN 옵션: data-agent 속성 없음 + AGENT 배지 없음
    const humanOption = page.getByTestId(`assignee-option-${USER1.id}`);
    await expect(humanOption).toBeVisible();
    await expect(humanOption).not.toHaveAttribute('data-agent', 'true');
    await expect(humanOption.getByTestId('agent-badge')).toHaveCount(0);

    // AGENT 옵션: data-agent="true" + AgentBadge 노출
    const agentOption = page.getByTestId(`assignee-option-${AGENT_ID}`);
    await expect(agentOption).toBeVisible();
    await expect(agentOption).toHaveAttribute('data-agent', 'true');
    await expect(agentOption.getByTestId('agent-badge')).toBeVisible();
  });

  // WP-461: 긴 이름·긴 아이디도 한 줄 — 이름이 글자 단위로 여러 줄 쪼개지지 않고, 아이디가 먼저 말줄임된다.
  test('긴 이름·아이디의 멤버도 픽커에서 한 줄로 보이고 전체 값은 title 로 남는다', async ({ authenticatedPage: page }) => {
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
