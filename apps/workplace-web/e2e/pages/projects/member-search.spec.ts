// 프로젝트 멤버 추가 검색 picker E2E — #31, #734.
// 시나리오:
//  1) @smoke 검색 → 후보 클릭 → POST /members + 테이블 갱신
//  2) AGENT 필터 → 백엔드 kind=AGENT 조회 + AGENT 만 노출
//  3) 이미 멤버인 후보 → disabled + 클릭 무반응 (POST 미발생)
//  4) (#734) 검색어 없이 popover 를 열면 kind=ALL 기본 후보 목록 노출 + 이미 멤버는 뒤로
//  5) (#734) 에이전트를 이름으로 검색해도 노출 / 비활성 사용자는 후보에서 제외

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
  aiAvailable: false,
};
const HUMAN2: UserResponse = {
  id: 102,
  username: 'bob',
  name: 'Bob',
  email: 'b@x',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'HUMAN',
  aiAvailable: false,
};
const AGENT1: UserResponse = {
  id: 201,
  username: 'ai-bot',
  name: 'AI Bot',
  email: 'ai@x',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'AGENT',
  aiAvailable: false,
};

// 비활성 사용자 — 후보 목록에서 제외되어야 한다(#734).
const INACTIVE: UserResponse = {
  id: 103,
  username: 'ghost',
  name: 'Ghost',
  email: 'g@x',
  isActive: false,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'HUMAN',
  aiAvailable: false,
};

type StubMember = {
  userId: number;
  username: string;
  name: string;
  role: string;
};

// 공통 stub — 설정 페이지가 동시 요청하는 부수 endpoint 까지 모두 막는다.
// 검색 요청에서 관측한 query string 기록 — kind 파라미터가 탭 선택을 따라가는지 검증에 사용(#734).
type SearchProbe = { queries: { search: string; kind: string }[] };

async function setupStubs(
  page: import('@playwright/test').Page,
  membersRef: { current: StubMember[] },
  probe?: SearchProbe,
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

  // 검색 — query string 에 따른 결과 분기. 백엔드처럼 kind 로 먼저 좁히고(ALL 이면 전체),
  // search 가 blank 면 검색 조건 없이 전체를 반환한다(#734 — 실제 UserRepository.tenantSearchCondition 동작).
  await page.route(/\/api\/v1\/users\?/, (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('search') ?? '';
    const kind = url.searchParams.get('kind') ?? 'HUMAN';
    probe?.queries.push({ search: q, kind });
    const all = [HUMAN1, HUMAN2, INACTIVE, AGENT1];
    const matched = all
      .filter((u) => kind === 'ALL' || u.kind === kind)
      .filter(
        (u) =>
          q.trim().length < 1 ||
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

test.describe('멤버 테이블 컬럼 헤더', () => {
  test(
    '멤버 테이블 헤더가 한국어로 표시된다 (이름·이메일·역할)',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const membersRef = {
        current: [
          { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
        ] as StubMember[],
      };
      await setupStubs(page, membersRef);

      await page.goto(SETTINGS_URL);

      // 테이블 헤더가 한국어로 표시되는지 검증 (#140 회귀 방지)
      const thead = page.locator('table thead tr');
      await expect(thead).toContainText('이름');
      await expect(thead).toContainText('이메일');
      await expect(thead).toContainText('역할');
      // "username" 영문 헤더가 더 이상 노출되지 않아야 함
      await expect(thead).not.toContainText('username');
    },
  );
});

test.describe('역할 선택 드롭다운 한국어 표시', () => {
  // 역할 옵션이 영문 enum(MEMBER/OWNER) 대신 한국어(멤버/소유자)로 표시되어야 함 (#158 회귀 방지)
  test(
    '멤버 추가 역할 드롭다운이 한국어로 표시된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const membersRef = {
        current: [
          { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
        ] as StubMember[],
      };
      await setupStubs(page, membersRef);

      await page.goto(SETTINGS_URL);

      // 멤버 추가 역할 선택 드롭다운: 한국어 옵션 표시 검증
      // shadcn Select 로 교체(#270) — 트리거 클릭 후 listbox 스코프로 항목 검증.
      // (Radix는 hidden native <option>도 유지하므로 role=listbox 로 범위 한정)
      const addRoleSelect = page.locator('#new-member-role');
      await expect(addRoleSelect).toBeVisible();
      // 드롭다운 열기.
      await addRoleSelect.click();
      const addRoleListbox = page.getByRole('listbox');
      await expect(addRoleListbox.getByRole('option', { name: '멤버' })).toBeVisible();
      await expect(addRoleListbox.getByRole('option', { name: '소유자' })).toBeVisible();
      // 영문 enum 원시값이 노출되지 않아야 함
      await expect(addRoleListbox.getByRole('option', { name: 'MEMBER' })).toHaveCount(0);
      await expect(addRoleListbox.getByRole('option', { name: 'OWNER' })).toHaveCount(0);
      // 드롭다운 닫기.
      await page.keyboard.press('Escape');
    },
  );

  test(
    '멤버 목록 역할 변경 select가 한국어로 표시된다',
    async ({ authenticatedPage: page }) => {
      const membersRef = {
        current: [
          { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
          { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' },
        ] as StubMember[],
      };
      await setupStubs(page, membersRef);

      await page.goto(SETTINGS_URL);

      // 멤버 목록 각 행의 역할 변경 select: 한국어 옵션 표시 검증
      // shadcn Select 로 교체(#270) — 트리거 클릭 후 listbox 스코프로 항목 검증.
      // (Radix는 hidden native <option>도 유지하므로 role=listbox 로 범위 한정)
      const rows = page.locator('table tbody tr');
      await expect(rows).toHaveCount(2);

      // 첫 번째 행의 SelectTrigger 클릭하여 드롭다운 열기.
      const firstRowTrigger = rows.first().getByRole('combobox');
      await firstRowTrigger.click();
      const rowListbox = page.getByRole('listbox');
      await expect(rowListbox.getByRole('option', { name: '멤버' })).toBeVisible();
      await expect(rowListbox.getByRole('option', { name: '소유자' })).toBeVisible();
      // 영문 enum 원시값이 노출되지 않아야 함
      await expect(rowListbox.getByRole('option', { name: 'MEMBER' })).toHaveCount(0);
      await expect(rowListbox.getByRole('option', { name: 'OWNER' })).toHaveCount(0);
      // 드롭다운 닫기.
      await page.keyboard.press('Escape');
    },
  );
});

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

  test('AGENT 필터 → 백엔드 kind=AGENT 조회 + AGENT 만 노출', async ({
    authenticatedPage: page,
  }) => {
    const membersRef = { current: [] as StubMember[] };
    const probe: SearchProbe = { queries: [] };
    await setupStubs(page, membersRef, probe);

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

    // AGENT 필터 — 라벨은 사용자 노출 표준 용어 "에이전트" (refs #210)
    const agentFilter = page.getByTestId('member-search-filter-AGENT');
    await expect(agentFilter).toHaveText('에이전트');
    await agentFilter.click();
    await expect(
      page.getByTestId(`member-search-row-${HUMAN1.id}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`member-search-row-${AGENT1.id}`),
    ).toBeVisible();

    // 탭 선택이 클라이언트 필터가 아니라 백엔드 kind 파라미터를 구동해야 한다(#734) —
    // page 1 에 AGENT 가 안 들어오면 클라이언트 필터만으로는 계속 빈 목록이 되기 때문.
    await expect
      .poll(() => probe.queries.some((q) => q.kind === 'AGENT' && q.search === 'a'))
      .toBe(true);
  });

  test('검색어 없이 popover 를 열면 kind=ALL 기본 후보 목록이 보인다 (#734)', async ({
    authenticatedPage: page,
  }) => {
    // 이미 멤버인 HUMAN1 은 노출되지만 목록 뒤로 밀려야 한다.
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
    const probe: SearchProbe = { queries: [] };
    await setupStubs(page, membersRef, probe);

    await page.goto(SETTINGS_URL);
    await page.getByTestId('member-add-trigger').click();
    await expect(page.getByTestId('member-search-popover')).toBeVisible();

    // 검색어를 입력하지 않아도 사람 + 에이전트 후보가 노출된다.
    await expect(page.getByTestId(`member-search-row-${HUMAN2.id}`)).toBeVisible();
    await expect(page.getByTestId(`member-search-row-${AGENT1.id}`)).toBeVisible();
    // 비활성 사용자는 후보에서 제외.
    await expect(page.getByTestId(`member-search-row-${INACTIVE.id}`)).toHaveCount(0);

    // 빈 search + kind=ALL 로 조회했는지 검증.
    await expect
      .poll(() => probe.queries.some((q) => q.search === '' && q.kind === 'ALL'))
      .toBe(true);

    // 이미 멤버(HUMAN1)는 disabled 로 남되 선택 가능한 후보들보다 뒤에 위치.
    const rows = page.getByTestId(/^member-search-row-/);
    const ids = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid')),
    );
    expect(ids[ids.length - 1]).toBe(`member-search-row-${HUMAN1.id}`);
  });

  test('에이전트를 이름으로 검색하면 후보로 노출된다 (#734)', async ({
    authenticatedPage: page,
  }) => {
    const membersRef = { current: [] as StubMember[] };
    await setupStubs(page, membersRef);

    await page.goto(SETTINGS_URL);
    await page.getByTestId('member-add-trigger').click();
    // 전체(ALL) 탭 기본 상태에서 에이전트 이름으로 검색.
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('AI Bot');

    await expect(page.getByTestId(`member-search-row-${AGENT1.id}`)).toBeVisible();
    await expect(page.getByTestId(`member-search-row-${HUMAN1.id}`)).toHaveCount(0);
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

test.describe('멤버 제거 AlertDialog (#139)', () => {
  // 제거 버튼 클릭 시 window.confirm() 대신 shadcn AlertDialog가 열리고 취소/확인이 올바르게 동작.
  test(
    '제거 버튼 클릭 시 AlertDialog가 열리고 취소 시 DELETE 미호출',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const membersRef = {
        current: [
          { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
          { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' },
        ] as StubMember[],
      };
      await setupStubs(page, membersRef);

      let deleteCalled = false;
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/members/2`, (route) => {
        if (route.request().method() === 'DELETE') {
          deleteCalled = true;
          return route.fulfill({ status: 204 });
        }
        return route.fallback();
      });

      await page.goto(SETTINGS_URL);

      // 제거 버튼 클릭 — window.confirm() 이 아닌 AlertDialog가 열려야 함.
      await page.getByTestId('member-remove-2').click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expect(page.getByText('멤버 제거')).toBeVisible();

      // 취소 → 다이얼로그 닫힘 + DELETE 미호출.
      await page.getByRole('button', { name: '취소' }).click();
      await expect(page.getByRole('alertdialog')).not.toBeVisible();
      expect(deleteCalled).toBe(false);
    },
  );

  test('제거 확인 클릭 시 DELETE API 호출', async ({ authenticatedPage: page }) => {
    const membersRef = {
      current: [
        { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
        { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' },
      ] as StubMember[],
    };
    await setupStubs(page, membersRef);

    let deleteCalled = false;
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/members/2`, (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        membersRef.current = membersRef.current.filter((m) => m.userId !== 2);
        return route.fulfill({ status: 204 });
      }
      return route.fallback();
    });

    await page.goto(SETTINGS_URL);
    await page.getByTestId('member-remove-2').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();

    // 제거 확인 → DELETE API 호출.
    await page.getByRole('button', { name: '제거' }).click();
    expect(deleteCalled).toBe(true);
    await expect(page.getByText('멤버를 제거했습니다')).toBeVisible();
  });
});

test.describe('멤버 행 hover 상태 (#308 회귀)', () => {
  // 멤버 테이블 tbody tr 행에 hover:bg-accent/50 클래스가 있는지 검증 — 클릭 가능 행 시각 피드백 회귀 방지.
  test('멤버 테이블 행에 hover 스타일 클래스가 적용된다', async ({ authenticatedPage: page }) => {
    const membersRef = {
      current: [
        { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
        { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' },
      ] as StubMember[],
    };
    await setupStubs(page, membersRef);

    await page.goto(SETTINGS_URL);

    // tbody 첫 번째 행에 hover:bg-accent/50 + transition-colors 클래스가 있어야 함 (#308 회귀 방지).
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow).toHaveClass(/hover:bg-accent\/50/);
    await expect(firstRow).toHaveClass(/transition-colors/);
  });
});
