// 프로젝트 멤버 추가 검색 picker E2E — #31.
// 시나리오:
//  1) @smoke 검색 → 후보 클릭 → POST /members + 테이블 갱신
//  2) AGENT 필터 → AGENT 만 노출 + 배지
//  3) 이미 멤버인 후보 → disabled + 클릭 무반응 (POST 미발생)

import { expect, test } from '../../fixtures/auth.fixture';
import type { UserResponse } from '../../../src/types/auth';

const PROJECT_KEY = 'WP';
const SETTINGS_URL = `/projects/${PROJECT_KEY}/settings`;

const HUMAN1: UserResponse = {
  id: 101,
  username: 'alice',
  name: 'Alice',
  email: 'a@x',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'HUMAN',
};
const HUMAN2: UserResponse = {
  id: 102,
  username: 'bob',
  name: 'Bob',
  email: 'b@x',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'HUMAN',
};
const AGENT1: UserResponse = {
  id: 201,
  username: 'ai-bot',
  name: 'AI Bot',
  email: 'ai@x',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'AGENT',
};

type StubMember = {
  userId: number;
  username: string;
  name: string;
  role: string;
};

// 공통 stub — 설정 페이지가 동시 요청하는 부수 endpoint 까지 모두 막는다.
async function setupStubs(
  page: import('@playwright/test').Page,
  membersRef: { current: StubMember[] },
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        projectKey: PROJECT_KEY,
        name: 'WP',
        description: '',
        ownerId: 1,
        createdAt: '2026-01-01T00:00:00Z',
      }),
    }),
  );

  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
    const m = route.request().method();
    if (m === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(membersRef.current),
      });
    }
    return route.fallback();
  });

  // 라벨/타입/필드 — 설정 페이지가 마운트 시 fetch.
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/types`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/fields`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 검색 — query string 에 따른 결과 분기.
  await page.route(/\/api\/v1\/users\?.*search=/, (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('search') ?? '';
    const all = [HUMAN1, HUMAN2, AGENT1];
    const matched = all.filter(
      (u) =>
        u.username.includes(q) ||
        u.name.toLowerCase().includes(q.toLowerCase()) ||
        (u.email ?? '').includes(q),
    );
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: matched,
        page: 0,
        size: 20,
        totalElements: matched.length,
        totalPages: 1,
      }),
    });
  });
}

test.describe('멤버 추가 검색 picker', () => {
  test(
    '검색 → 후보 클릭 → POST /members + 테이블 갱신',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const membersRef = {
        current: [
          { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
        ] as StubMember[],
      };
      await setupStubs(page, membersRef);

      let postPayload: { userId: number; role: string } | null = null;
      // POST 라우트는 setupStubs 의 GET 핸들러보다 먼저 매칭되어야 하므로 setupStubs 후에 등록.
      await page.route(
        `**/api/v1/projects/${PROJECT_KEY}/members`,
        async (route) => {
          if (route.request().method() !== 'POST') return route.fallback();
          postPayload = route.request().postDataJSON() as {
            userId: number;
            role: string;
          };
          membersRef.current = [
            ...membersRef.current,
            {
              userId: postPayload.userId,
              username: 'alice',
              name: 'Alice',
              role: postPayload.role,
            },
          ];
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: '{}',
          });
        },
      );

      await page.goto(SETTINGS_URL);

      await page.getByTestId('member-add-trigger').click();
      await expect(page.getByTestId('member-search-popover')).toBeVisible();

      await page
        .getByPlaceholder('이름·아이디·이메일로 검색')
        .fill('ali');

      await page.getByTestId(`member-search-row-${HUMAN1.id}`).click();

      await expect
        .poll(() => postPayload)
        .toEqual({ userId: HUMAN1.id, role: 'MEMBER' });
      await expect(page.getByText('Alice 을(를) 추가했습니다')).toBeVisible();
      await expect(page.getByRole('row', { name: /Alice/ })).toBeVisible();
    },
  );

  test('AGENT 필터 → AGENT 만 노출', async ({ authenticatedPage: page }) => {
    const membersRef = { current: [] as StubMember[] };
    await setupStubs(page, membersRef);

    await page.goto(SETTINGS_URL);
    await page.getByTestId('member-add-trigger').click();
    await page
      .getByPlaceholder('이름·아이디·이메일로 검색')
      .fill('a'); // alice + ai-bot 매치

    // ALL 상태 — 두 명 노출
    await expect(
      page.getByTestId(`member-search-row-${HUMAN1.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`member-search-row-${AGENT1.id}`),
    ).toBeVisible();

    // AGENT 필터
    await page.getByTestId('member-search-filter-AGENT').click();
    await expect(
      page.getByTestId(`member-search-row-${HUMAN1.id}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`member-search-row-${AGENT1.id}`),
    ).toBeVisible();
  });

  test('이미 멤버인 후보 → disabled + 클릭 무반응', async ({
    authenticatedPage: page,
  }) => {
    const membersRef = {
      current: [
        {
          userId: HUMAN1.id,
          username: HUMAN1.username,
          name: HUMAN1.name,
          role: 'MEMBER',
        },
      ] as StubMember[],
    };
    await setupStubs(page, membersRef);

    let postCount = 0;
    await page.route(
      `**/api/v1/projects/${PROJECT_KEY}/members`,
      (route) => {
        if (route.request().method() === 'POST') {
          postCount += 1;
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: '{}',
          });
        }
        return route.fallback();
      },
    );

    await page.goto(SETTINGS_URL);
    await page.getByTestId('member-add-trigger').click();
    await page
      .getByPlaceholder('이름·아이디·이메일로 검색')
      .fill('alice');

    const row = page.getByTestId(`member-search-row-${HUMAN1.id}`);
    await expect(row).toContainText('(이미 멤버)');
    // cmdk CommandItem 은 disabled 상태에서 data-disabled="true" 를 렌더한다.
    await expect(row).toHaveAttribute('data-disabled', 'true');

    await row.click({ force: true }).catch(() => {
      // pointer-events: none 으로 인해 click 이 무시될 수 있음 — 의도된 동작.
    });
    await page.waitForTimeout(200);
    expect(postCount).toBe(0);
  });
});
