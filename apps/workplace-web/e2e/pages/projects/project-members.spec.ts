// 개인 프로젝트 AI 어시스턴트 멤버 추가 E2E — #418 assignee-membership.
// 시나리오: @smoke 개인 프로젝트 설정 → "AI 어시스턴트 추가" 버튼 + AGENT only picker → POST payload + 목록 갱신.
// 모드 분기(agentOnly 헤딩·버튼 라벨·kind 탭 숨김·kind=AGENT 조회, 팀 프로젝트 탭 노출)는 컴포넌트 테스트
// MemberManagement.test.tsx·MemberSearchPopover.test.tsx 가 맡는다(WP-413). 팀 프로젝트 picker 배선은 member-search.spec.ts.

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import type { MemberSummary } from '../../../src/types/member';
import type { MemberResponse } from '../../../src/types/project';

const PROJECT_KEY = 'MY';
const SETTINGS_URL = `/projects/${PROJECT_KEY}/settings`;

// AI 어시스턴트 후보
const AGENT_USER: MemberSummary = {
  userId: 301,
  username: 'workplace-ai',
  name: 'Workplace AI',
  email: 'ai@workplace',
  title: null,
  kind: 'AGENT',
  active: true,
  membershipRole: 'MEMBER',
  membershipStatus: 'ACTIVE',
};

// 사람 후보 (agentOnly 모드에선 노출 안 돼야 함)
const HUMAN_USER: MemberSummary = {
  userId: 302,
  username: 'coworker',
  name: 'Coworker',
  email: 'co@workplace',
  title: null,
  kind: 'HUMAN',
  active: true,
  membershipRole: 'MEMBER',
  membershipStatus: 'ACTIVE',
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

  // 사용자 검색 — AGENT + HUMAN 혼재 소스. 실제 백엔드처럼 kind 로 먼저 좁히고(ALL 이면 전체),
  // search 가 blank 면 검색 조건 없이 전체를 반환한다(#734).
  await page.route(/\/api\/v1\/members\?/, (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('search') ?? '';
    const kind = url.searchParams.get('kind') ?? 'HUMAN';
    const all = [AGENT_USER, HUMAN_USER];
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

test.describe('개인 프로젝트 AI 어시스턴트 추가', () => {
  test(
    '@smoke 개인 프로젝트 설정 → AI 어시스턴트 추가 → POST payload + 목록 반영',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const membersRef: { current: StubMember[] } = { current: [] };
      await setupPersonalProjectStubs(page, membersRef);

      const posts = trackRequests(page, 'POST', `/api/v1/projects/${PROJECT_KEY}/members`);
      // POST 핸들러 — setupPersonalProjectStubs 의 GET 핸들러보다 LIFO 우선으로 등록.
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        membersRef.current = [
          ...membersRef.current,
          {
            userId: AGENT_USER.userId,
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
      await page.getByTestId(`member-search-row-${AGENT_USER.userId}`).click();

      // POST payload 검증 — userId + role:'MEMBER'
      await expect.poll(() => posts.lastBody()).toEqual({ userId: AGENT_USER.userId, role: 'MEMBER' });

      // 성공 토스트
      await expect(page.getByText(`${AGENT_USER.name} 을(를) 추가했습니다`)).toBeVisible();

      // 목록에 AI 어시스턴트 반영
      await expect(page.getByRole('row', { name: /Workplace AI/ })).toBeVisible();
    },
  );
});
