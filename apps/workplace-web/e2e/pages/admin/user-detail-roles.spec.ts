// /settings/users/:id — 역할 할당 섹션 E2E. 구성원 상세 화면의 대표 배선(@wiring): 역할 선택 → PUT → 재조회·토스트.
// 역할 0개 저장 가드(#150)·활성 상태 끄기(WP-417)·내 계정 잠금(WP-909)·대상 종류별 역할 숨김(WP-728)은
// src/pages/admin/userDetail.test.tsx 가 지킨다(WP-966).

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { createUserDetail, createRole } from '../../factories/auth.factory';

const USER_ID = 4;

/** 초기 사용자: USER 역할만 보유 */
const INITIAL_USER = createUserDetail({
  id: USER_ID,
  name: '테스트 사용자',
  username: `user${USER_ID}`,
  email: `user${USER_ID}@example.com`,
  roles: [createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true })],
});

/** 수정 후 사용자: USER + ADMIN 역할 보유 */
const UPDATED_USER = createUserDetail({
  id: USER_ID,
  name: '테스트 사용자',
  username: `user${USER_ID}`,
  email: `user${USER_ID}@example.com`,
  roles: [
    createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
    createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }),
  ],
});

const ROLES_LIST = [
  createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
  createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }),
];

test.describe('/settings/users/:id — 역할 할당', () => {
  test(
    '역할 1개 이상 선택 후 저장 → API payload 에 roleIds 포함 + 성공 토스트',
    { tag: ['@wiring', '@smoke'] },
    async ({ adminPage: page }) => {
      // ADMIN 체크박스 클릭 후 저장하면 PUT payload 에 [1, 2] 포함 검증
      const roleSaves = trackRequests(page, 'PUT', /^\/api\/v1\/users\/\d+\/roles$/);
      // PUT 이후 GET 재조회에서 업데이트된 사용자를 반환하도록 플래그 사용
      // (React StrictMode 로 인해 GET 이 여러 번 호출되므로 카운터 대신 플래그 사용)
      let savedAlready = false;

      await setupAdminAuth(page);

      await page.route(/\/api\/v1\/users\/4$/, (route) => {
        if (route.request().method() === 'GET') {
          // PUT 저장 이후 재조회 시점에만 UPDATED_USER 반환
          const body = savedAlready ? UPDATED_USER : INITIAL_USER;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
        }
        return route.fallback();
      });
      await page.route(/\/api\/v1\/roles$/, (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(ROLES_LIST),
          });
        }
        return route.fallback();
      });
      await page.route(/\/api\/v1\/users\/\d+\/roles$/, (route) => {
        if (route.request().method() === 'PUT') {
          savedAlready = true;
          return route.fulfill({ status: 204, body: '' });
        }
        return route.fallback();
      });

      await page.goto(`/settings/users/${USER_ID}`);
      await expect(page.getByRole('heading', { name: '사용자 상세' })).toBeVisible();

      // 초기 상태: USER 체크됨, ADMIN 미체크
      const adminCheckbox = page.getByRole('checkbox', { name: /ADMIN/ });
      await expect(adminCheckbox).not.toBeChecked();

      // ADMIN 역할 추가 선택
      await adminCheckbox.click();
      await expect(adminCheckbox).toBeChecked();

      // 역할 저장
      await page.getByRole('button', { name: '역할 저장' }).click();

      // 성공 토스트 표시
      await expect(page.getByText('역할이 저장되었습니다.')).toBeVisible();

      // API payload 검증 — USER(1) + ADMIN(2) 모두 포함
      const roleIds = roleSaves.lastBody<{ roleIds: number[] }>()?.roleIds;
      expect(roleIds).toContain(1);
      expect(roleIds).toContain(2);
    },
  );
});
