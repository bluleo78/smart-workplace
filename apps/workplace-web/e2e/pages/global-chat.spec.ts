import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'

test('이슈 페이지에서도 챗 런처가 상주한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 챗 런처는 AppLayout(전역 셸)에 있다. 이슈 페이지가 정상 렌더돼야(에러 바운더리 미발동)
  // 런처도 함께 상주함을 확인할 수 있으므로 프로젝트 목록을 빈 페이지로 모킹한다.
  await mockApi(page, 'GET', '/api/v1/projects', {
    content: [],
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
  })
  await page.goto('/projects')
  // 평소엔 칩(런처)만 보이고, 클릭하면 입력 패널이 펼쳐진다.
  await expect(page.getByTestId('chat-launcher')).toBeVisible()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
})
