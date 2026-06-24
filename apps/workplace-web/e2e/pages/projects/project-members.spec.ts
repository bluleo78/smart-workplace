// 개인 프로젝트 AI 어시스턴트 멤버 추가 E2E — #418 assignee-membership.
// 시나리오:
//  1) @smoke 개인 프로젝트 설정 → "AI 어시스턴트 추가" 버튼 + AGENT only picker → POST payload + 목록 갱신
//  2) agentOnly 모드 — kind 토글 미노출 (HUMAN 토글 숨김 검증)
//  3) 팀 프로젝트는 기존 "멤버 추가" 버튼 + kind 토글 보임 (회귀 방지)

import { expect, test } from '../../fixtures/auth.fixture';
import type { UserResponse } from '../../../src/types/auth';
import type { MemberResponse } from '../../../src/types/project';

const PROJECT_KEY = 'MY';
const SETTINGS_URL = `/projects/${PROJECT_KEY}/settings`;

// AI 어시스턴트 후보
const AGENT_USER: UserResponse = {
  id: 301,
  username: 'workplace-ai',
  name: 'Workplace AI',
  email: 'ai@workplace',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'AGENT',
};

// 사람 후보 (agentOnly 모드에선 노출 안 돼야 함)
const HUMAN_USER: UserResponse = {
  id: 302,
  username: 'coworker',
  name: 'Coworker',
  email: 'co@workplace',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'HUMAN',
};

type StubMember = Pick<MemberResponse, 'userId' | 'username' | 'name' | 'kind' | 'role' | 'createdAt'>;

/** 개인 프로젝트 설정 페이지에 필요한 기본 스텁 세팅. */
async function setupPersonalProjectStubs(
  page: import('@playwright/test').Page,
  membersRef: { current: StubMember[] },
) {
  // 프로젝트 상세 — type: 'PERSONAL'
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 10,
        key: PROJECT_KEY,
        name: '내 프로젝트',
        description: '',
        ownerId: 1,
        type: 'PERSONAL',
        isDefault: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        issueTotal: 0,
        issueDone: 0,
        memberCount: 0,
        memberNames: [],
      }),
    }),
  );

  // 멤버 목록 — membersRef.current 반환
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(membersRef.current),
      });
    }
    return route.fallback();
  });

  // 라벨/타입/필드 — 설정 페이지 마운트 시 fetch
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/types`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/fields`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 사용자 검색 — AGENT + HUMAN 혼재 결과 반환
  await page.route(/\/api\/v1\/users\?.*search=/, (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('search') ?? '';
    const all = [AGENT_USER, HUMAN_USER];
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

test.describe('개인 프로젝트 AI 어시스턴트 추가', () => {
  test(
    '@smoke 개인 프로젝트 설정 → AI 어시스턴트 추가 → POST payload + 목록 반영',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const membersRef: { current: StubMember[] } = { current: [] };
      await setupPersonalProjectStubs(page, membersRef);

      let postPayload: { userId: number; role: string } | null = null;
      // POST 핸들러 — setupPersonalProjectStubs 의 GET 핸들러보다 LIFO 우선으로 등록.
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        postPayload = route.request().postDataJSON() as { userId: number; role: string };
        membersRef.current = [
          ...membersRef.current,
          {
            userId: AGENT_USER.id,
            username: AGENT_USER.username,
            name: AGENT_USER.name,
            kind: 'AGENT',
            role: 'MEMBER',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ];
        return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      });

      await page.goto(SETTINGS_URL);

      // "AI 어시스턴트 추가" 버튼이 표시되어야 함
      const addBtn = page.getByTestId('member-add-trigger');
      await expect(addBtn).toContainText('AI 어시스턴트 추가');

      // picker 열기
      await addBtn.click();
      await expect(page.getByTestId('member-search-popover')).toBeVisible();

      // 검색어 입력
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('workplace');

      // AGENT 후보 선택
      await page.getByTestId(`member-search-row-${AGENT_USER.id}`).click();

      // POST payload 검증 — userId + role:'MEMBER'
      await expect.poll(() => postPayload).toEqual({ userId: AGENT_USER.id, role: 'MEMBER' });

      // 성공 토스트
      await expect(page.getByText(`${AGENT_USER.name} 을(를) 추가했습니다`)).toBeVisible();

      // 목록에 AI 어시스턴트 반영
      await expect(page.getByRole('row', { name: /Workplace AI/ })).toBeVisible();
    },
  );

  test('agentOnly 모드 — kind 토글(전체/사람/에이전트) 미노출', async ({ authenticatedPage: page }) => {
    const membersRef: { current: StubMember[] } = { current: [] };
    await setupPersonalProjectStubs(page, membersRef);

    await page.goto(SETTINGS_URL);
    await page.getByTestId('member-add-trigger').click();
    await expect(page.getByTestId('member-search-popover')).toBeVisible();

    // kind 토글 버튼이 없어야 함
    await expect(page.getByTestId('member-search-filter-ALL')).toHaveCount(0);
    await expect(page.getByTestId('member-search-filter-HUMAN')).toHaveCount(0);
    await expect(page.getByTestId('member-search-filter-AGENT')).toHaveCount(0);
  });

  test('agentOnly 모드 — 검색 결과에 HUMAN 미노출, AGENT만 노출', async ({ authenticatedPage: page }) => {
    const membersRef: { current: StubMember[] } = { current: [] };
    await setupPersonalProjectStubs(page, membersRef);

    await page.goto(SETTINGS_URL);
    await page.getByTestId('member-add-trigger').click();

    // 검색어 입력 — AGENT + HUMAN 혼재 응답
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('work');

    // AGENT 후보는 노출
    await expect(page.getByTestId(`member-search-row-${AGENT_USER.id}`)).toBeVisible();
    // HUMAN 후보는 필터되어 미노출
    await expect(page.getByTestId(`member-search-row-${HUMAN_USER.id}`)).toHaveCount(0);
  });

  test('개인 프로젝트 설정 — 헤딩 "AI 어시스턴트" 표시', async ({ authenticatedPage: page }) => {
    const membersRef: { current: StubMember[] } = { current: [] };
    await setupPersonalProjectStubs(page, membersRef);

    await page.goto(SETTINGS_URL);

    // agentOnly 모드 헤딩 확인
    await expect(page.getByRole('heading', { name: 'AI 어시스턴트' })).toBeVisible();
    // 일반 "멤버" 헤딩 미노출
    await expect(page.getByRole('heading', { name: '멤버' })).toHaveCount(0);
  });
});

test.describe('팀 프로젝트 멤버 관리 (회귀 방지)', () => {
  const TEAM_KEY = 'WP';
  const TEAM_SETTINGS_URL = `/projects/${TEAM_KEY}/settings`;

  async function setupTeamProjectStubs(page: import('@playwright/test').Page) {
    await page.route(`**/api/v1/projects/${TEAM_KEY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          key: TEAM_KEY,
          name: 'Workplace',
          description: '',
          ownerId: 1,
          type: 'TEAM',
          isDefault: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          issueTotal: 0,
          issueDone: 0,
          memberCount: 1,
          memberNames: ['Tester'],
        }),
      }),
    );
    await page.route(`**/api/v1/projects/${TEAM_KEY}/members`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { userId: 1, username: 'tester', name: 'Tester', kind: 'HUMAN', role: 'OWNER', createdAt: '2026-01-01T00:00:00Z' },
        ]),
      }),
    );
    await page.route(`**/api/v1/projects/${TEAM_KEY}/labels`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(`**/api/v1/projects/${TEAM_KEY}/types`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(`**/api/v1/projects/${TEAM_KEY}/fields`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }

  test('팀 프로젝트 — "멤버 추가" 버튼 + kind 토글 표시 (agentOnly 아님)', async ({ authenticatedPage: page }) => {
    await setupTeamProjectStubs(page);

    await page.goto(TEAM_SETTINGS_URL);

    // "멤버 추가" 버튼 (agentOnly 가 아닌 기본 라벨)
    await expect(page.getByTestId('member-add-trigger')).toContainText('멤버 추가');

    // picker 열기
    await page.getByTestId('member-add-trigger').click();
    await expect(page.getByTestId('member-search-popover')).toBeVisible();

    // kind 토글이 표시되어야 함 (회귀 방지)
    await expect(page.getByTestId('member-search-filter-ALL')).toBeVisible();
    await expect(page.getByTestId('member-search-filter-HUMAN')).toBeVisible();
    await expect(page.getByTestId('member-search-filter-AGENT')).toBeVisible();
  });
});
