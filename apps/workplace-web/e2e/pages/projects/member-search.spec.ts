// 프로젝트 설정 멤버 관리 E2E — 설정 화면 배선(@wiring)과 키보드로 제거한 뒤 초점 이동(WP-891, @input)만 남긴다.
// 역할 드롭다운 한국어, 추가 검색 picker(검색·kind 필터·기본 후보·이미 멤버), 제거 확인창·DELETE, 행 hover 클래스,
// MEMBER 읽기 전용(WP-479)은 페이지 테스트 src/pages/projects/memberSearch.test.tsx 가 지킨다(WP-980).

import { expect, test } from '../../fixtures/auth.fixture';
import type { MemberSummary } from '../../../src/types/member';

const PROJECT_KEY = 'WP';
const SETTINGS_URL = `/projects/${PROJECT_KEY}/settings`;

const HUMAN1: MemberSummary = {
  userId: 101,
  username: 'alice',
  name: 'Alice',
  email: 'a@x',
  title: null,
  kind: 'HUMAN',
  active: true,
  membershipRole: 'MEMBER',
  membershipStatus: 'ACTIVE',
};
const HUMAN2: MemberSummary = {
  userId: 102,
  username: 'bob',
  name: 'Bob',
  email: 'b@x',
  title: null,
  kind: 'HUMAN',
  active: true,
  membershipRole: 'MEMBER',
  membershipStatus: 'ACTIVE',
};
const AGENT1: MemberSummary = {
  userId: 201,
  username: 'ai-bot',
  name: 'AI Bot',
  email: 'ai@x',
  title: null,
  kind: 'AGENT',
  active: true,
  membershipRole: 'MEMBER',
  membershipStatus: 'ACTIVE',
};

// 비활성 사용자 — 후보 목록에서 제외되어야 한다(#734).
const INACTIVE: MemberSummary = {
  userId: 103,
  username: 'ghost',
  name: 'Ghost',
  email: 'g@x',
  title: null,
  kind: 'HUMAN',
  active: false,
  membershipRole: 'MEMBER',
  membershipStatus: 'ACTIVE',
};

type StubMember = {
  userId: number;
  username: string;
  name: string;
  role: string;
};

// 공통 stub — 설정 페이지가 동시 요청하는 부수 endpoint 까지 모두 막는다.

/** 로그인한 사람(auth.fixture id 1)이 OWNER 인 멤버 목록 — 이미 있으면 그대로(WP-479: 관리 조작은 OWNER 에게만 보인다). */
function withMeAsOwner(members: StubMember[]): StubMember[] {
  return members.some((m) => m.userId === 1) ? members : [{ userId: 1, username: 'me', name: 'Me', role: 'OWNER' }, ...members]
}
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
        // 설정 화면은 로그인한 사람(id 1)이 OWNER 일 때 관리 조작을 보인다(WP-479) — 시드에 없으면 OWNER 로 넣는다.
        body: JSON.stringify(withMeAsOwner(membersRef.current)),
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
  await page.route(/\/api\/v1\/members\?/, (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('search') ?? '';
    const kind = url.searchParams.get('kind') ?? 'HUMAN';
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
    { tag: ['@wiring', '@smoke'] },
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

// WP-891: 키보드로 멤버를 제거하면 확인창이 지운 행의 「제거」로 초점을 돌려주려다 그 버튼이 사라져 초점이 body 로 빠졌다.
test.describe('멤버 제거 뒤 초점 (WP-891)', { tag: '@input' }, () => {
  // personal: 개인 프로젝트(나=주인, 「제거」 없음) — 제거할 수 있는 멤버가 바닥나는 경우를 만든다.
  async function setup(page: import('@playwright/test').Page, members: StubMember[], personal = false) {
    const membersRef = { current: members };
    await setupStubs(page, membersRef);
    if (personal) {
      await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 1, projectKey: PROJECT_KEY, name: 'WP', description: '', ownerId: 1, type: 'PERSONAL', createdAt: '2026-01-01T00:00:00Z' }),
        }),
      );
    }
    await page.route(/\/api\/v1\/projects\/[^/]+\/members\/\d+$/, (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      const id = Number(new URL(route.request().url()).pathname.split('/').pop());
      membersRef.current = membersRef.current.filter((m) => m.userId !== id);
      return route.fulfill({ status: 204 });
    });
    await page.route(/\/members\/\d+\/assigned-issue-count$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) }),
    );
    await page.goto(SETTINGS_URL);
  }

  async function removeByKeyboard(page: import('@playwright/test').Page, userId: number) {
    await page.getByTestId(`member-remove-${userId}`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: '제거', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`member-remove-${userId}`)).toHaveCount(0);
  }

  test('지운 자리에 온 다음 멤버의 「제거」로, 마지막 멤버였으면 앞 멤버의 「제거」로 옮긴다', async ({ authenticatedPage: page }) => {
    await setup(page, [
      { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
      { userId: 2, username: 'alice', name: 'Alice', role: 'MEMBER' },
      { userId: 3, username: 'bob', name: 'Bob', role: 'MEMBER' },
    ]);
    await removeByKeyboard(page, 2);
    await expect(page.getByTestId('member-remove-3')).toBeFocused();

    await removeByKeyboard(page, 3);
    await expect(page.getByTestId('member-remove-1')).toBeFocused();
  });

  test('제거할 수 있는 멤버가 더 없으면 「AI 어시스턴트 추가」로 옮기고, 취소하면 연 버튼으로 돌아간다', async ({ authenticatedPage: page }) => {
    await setup(page, [{ userId: 2, username: 'helper', name: 'Helper', role: 'MEMBER' }], true);
    // 취소(Esc)는 기본 복원 — 연 「제거」 버튼으로.
    await page.getByTestId('member-remove-2').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('member-remove-2')).toBeFocused();

    await removeByKeyboard(page, 2);
    await expect(page.getByTestId('member-add-trigger')).toBeFocused();
  });
});
