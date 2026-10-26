import { expect, test } from '@playwright/test'

import { mockApi } from '../fixtures/api-mock'

// 이슈 #495 — 부트스트랩 첫 사용자 이후 웹 회원가입을 막는다.
// GET /auth/signup-available 가용성에 따라 가입 폼/링크 노출을 제어.
// 백엔드 없이 page.route 로 가용성 엔드포인트를 모킹한다.
// 가용=false 안내·가입 403 payload·로그인 화면 가입 링크 노출은 화면 컴포넌트 테스트 src/pages/authPages.test.tsx 가 지킨다(WP-971).
// 여기에는 가입 화면 배선(라우트 → 가용성 API → 폼, @wiring) 1건만 남긴다.

test.describe('회원가입 가용성 게이트 (#495)', () => {
  // available=true → 기존 가입 폼(입력 필드들)이 그대로 보인다.
  test('가용=true 이면 가입 폼이 보인다', { tag: '@wiring' }, async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })

    await page.goto('/signup')

    // 폼 입력 필드들이 모두 렌더된다(요소 존재가 아닌 실제 폼 노출 검증).
    await expect(page.getByLabel('아이디 (이메일)')).toBeVisible()
    await expect(page.getByLabel('비밀번호', { exact: true })).toBeVisible()
    await expect(page.getByLabel('비밀번호 확인', { exact: true })).toBeVisible()
    await expect(page.getByLabel('이름')).toBeVisible()
    await expect(page.getByRole('button', { name: '회원가입' })).toBeVisible()
    // 잠김 안내는 보이지 않아야 한다.
    await expect(page.getByText('회원가입이 비활성화되어 있습니다.')).toBeHidden()
  })
})
