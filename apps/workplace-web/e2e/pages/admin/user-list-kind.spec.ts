// /settings/users — 구성원 목록 화면의 대표 배선(@wiring). WP-1075 부터 사람만 보인다(AI 는 설정 › 에이전트가 관리) —
// 목록 요청이 kind=HUMAN 이고, 모두 사람이라 「구분」 열이 없다. 예전 '구분' 배지 일관성 회귀(#287)는 열과 함께 없어졌다.
// 구성원 추가 대화상자·보조 줄·다음 페이지 다시 시도는 src/pages/admin/userList.test.tsx 가 지킨다(WP-966).

import { createMember } from '../../factories/auth.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { createPageResponse, mockApi } from '../../fixtures/api-mock';

const HUMAN_USER = createMember({
  userId: 11,
  name: '사람 사용자',
  username: 'human_user',
  email: 'human@example.com',
  kind: 'HUMAN',
});

test.describe('UserListPage 사람만 보기 (WP-1075)', () => {
  test('구성원 목록은 사람만 요청하고 「구분」 열 없이 행을 보인다', { tag: '@wiring' }, async ({ adminPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/members', createPageResponse([HUMAN_USER]));
    const listRequest = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/v1/members');
    await page.goto('/settings/users');

    expect(new URL((await listRequest).url()).searchParams.get('kind')).toBe('HUMAN');
    await expect(page.getByRole('button', { name: '사용자 사람 사용자 상세 보기' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '구분' })).toHaveCount(0);
  });
});
