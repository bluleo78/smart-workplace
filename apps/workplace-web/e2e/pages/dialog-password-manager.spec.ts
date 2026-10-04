// 비밀번호 관리자(1Password 등) 확장 UI 와 상호작용해도 공용 다이얼로그가 닫히지 않는지 검증 (WP-96).
// 1Password 는 자동완성 메뉴를 `<com-1password-menu>` 같은 커스텀 엘리먼트로 document.body 에
// 직접 주입한다(React 트리·다이얼로그 콘텐츠 밖). Radix DismissableLayer 는 그 메뉴 클릭(pointerdown)을
// "바깥 상호작용"으로 보고 다이얼로그를 닫아 버렸다.
// 실제 확장은 E2E 에서 설치할 수 없으므로 동일한 DOM 구조(body 직속 커스텀 엘리먼트 + shadow root)를
// 주입해 재현한다.

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi, createPageResponse } from '../fixtures/api-mock'
import { createProject } from '../factories/project.factory'
import { dismissByOutsideClick } from '../fixtures/wait'

/** 1Password 인라인 메뉴를 흉내 낸 요소를 body 에 주입한다(shadow root 안에 클릭 가능한 버튼). */
async function injectPasswordManagerMenu(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const host = document.createElement('com-1password-menu')
    // 모달이 열리면 Radix 가 body 에 pointer-events:none 을 걸므로, 실제 확장처럼 자체 스타일로 재활성화한다.
    host.setAttribute(
      'style',
      'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:auto;display:block;',
    )
    const root = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.id = 'fill'
    button.textContent = '1Password로 채우기'
    button.setAttribute('style', 'width:200px;height:40px;')
    root.appendChild(button)
    document.body.appendChild(host)
  })
}

test.describe('공용 다이얼로그 — 비밀번호 관리자 확장 상호작용', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
    await page.goto('/projects')
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()
    await injectPasswordManagerMenu(page)
  })

  test('확장 메뉴를 클릭해도 다이얼로그가 닫히지 않는다', async ({ authenticatedPage: page }) => {
    // shadow root 내부 버튼 클릭 — pointerdown 이 다이얼로그 바깥에서 발생한다.
    await page.locator('com-1password-menu').locator('#fill').click()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()
  })

  test('오버레이(진짜 바깥) 클릭은 여전히 다이얼로그를 닫는다', async ({
    authenticatedPage: page,
  }) => {
    // 열린 직후 바깥 클릭은 Radix 가 무시할 수 있어 닫힐 때까지 재시도한다 (WP-225).
    await dismissByOutsideClick(page, page.getByRole('dialog', { name: '새 프로젝트' }), { x: 5, y: 700 })
  })
})
