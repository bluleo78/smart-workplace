// 프로젝트 생성/수정 폼 유효성 검사 회귀 테스트 (#177).
// 이름 120자 초과 시 Zod 영문 기본 메시지 대신 한국어 오류 메시지가 표시되는지 검증.

import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi, createPageResponse } from '../../fixtures/api-mock'
import { createProject } from '../../factories/project.factory'

test.describe('프로젝트 생성 폼 유효성 검사 (#177)', () => {
  test('이름 120자 초과 시 한국어 오류 메시지가 표시된다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))

    await page.goto('/projects')
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()

    // key 필드 입력
    await page.getByLabel('key (예: WP)').fill('TESTKEY')

    // 121자 이름 입력 — 120자 한도 초과
    const longName = '가'.repeat(121)
    await page.getByLabel('이름').fill(longName)
    await page.getByRole('button', { name: '생성' }).click()

    // 한국어 오류 메시지 표시 검증 (영문 Zod 원시 메시지 없어야 함)
    await expect(page.getByText('이름은 120자 이하여야 합니다')).toBeVisible()
    await expect(page.getByText('Too big')).not.toBeVisible()
  })

  // WP-465: 이름에 공백만 넣으면 서버로 보내지 않고 이름 필드 아래 「필수」 오류를 보인다.
  test('이름이 공백뿐이면 서버 요청 없이 이름 필드에 필수 오류를 보인다(WP-465)', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
    let posted = 0
    await page.route('**/api/v1/projects', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      posted += 1
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '공백일 수 없습니다' }) })
    })

    await page.goto('/projects')
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await page.getByLabel('key (예: WP)').fill('SPACE')
    await page.getByLabel('이름').fill('   ')
    await page.getByRole('button', { name: '생성' }).click()

    await expect(page.getByText('이름은 필수입니다')).toBeVisible()
    await expect(page.getByText('공백일 수 없습니다')).toHaveCount(0)
    expect(posted).toBe(0)
  })

  // WP-466: 검증 오류가 입력과 이어져 스크린리더가 알린다 — aria-invalid·aria-describedby → role=alert 오류.
  test('빈 값으로 생성하면 key·이름 입력이 오류와 접근성으로 이어진다(WP-466)', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
    await page.goto('/projects')
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await page.getByRole('button', { name: '생성' }).click()

    for (const [id, message] of [
      ['project-key', '대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다'],
      ['project-name', '이름은 필수입니다'],
    ] as const) {
      const input = page.locator(`#${id}`)
      await expect(input).toHaveAttribute('aria-invalid', 'true')
      const describedBy = await input.getAttribute('aria-describedby')
      const error = page.locator(`#${describedBy}`)
      await expect(error).toHaveText(message)
      await expect(error).toHaveAttribute('role', 'alert')
    }
  })

  // WP-692: key 충돌(409) 문구는 토스트가 아니라 key 칸 아래에 보인다 — 열린 창 배경 뒤로 토스트가 가려 이유를 못 읽었다.
  test('삭제된 프로젝트의 key 로 만들면 서버 문구가 key 칸 오류로 보이고 창은 열려 있다(WP-692)', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
    const message = '삭제된 프로젝트가 쓰던 key 라 다시 쓸 수 없습니다: GONE — 다른 key 를 써 주세요'
    let body: unknown
    await page.route('**/api/v1/projects', (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      body = route.request().postDataJSON()
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ status: 409, message }) })
    })

    await page.goto('/projects')
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await page.getByLabel('key (예: WP)').fill('GONE')
    await page.getByLabel('이름').fill('새 프로젝트')
    await page.getByRole('button', { name: '생성' }).click()

    const input = page.locator('#project-key')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator(`#${await input.getAttribute('aria-describedby')}`)).toHaveText(message)
    await expect(input).toBeFocused()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: message })).toHaveCount(0)
    expect(body).toMatchObject({ key: 'GONE', name: '새 프로젝트', type: 'TEAM' })

    // key 를 고치면 서버 오류가 사라진다(다시 검증).
    await input.fill('NEWKEY')
    await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  })
})
