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

  test('이름 120자 이하에서는 유효성 오류가 없다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
    const createCapture = await mockApi(
      page,
      'POST',
      '/api/v1/projects',
      createProject({ name: '가'.repeat(120) }),
      { capture: true },
    )

    await page.goto('/projects')
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()

    // 정확히 120자 입력 — 경계값
    await page.getByLabel('key (예: WP)').fill('TEST')
    await page.getByLabel('이름').fill('가'.repeat(120))
    await page.getByRole('button', { name: '생성' }).click()

    // 유효성 오류 없음 — API 요청이 발송되어야 함
    const created = await createCapture.waitForRequest()
    expect(created.payload).toMatchObject({ name: '가'.repeat(120) })
    await expect(page.getByText('이름은 120자 이하여야 합니다')).not.toBeVisible()
    await expect(page.getByText('Too big')).not.toBeVisible()
  })
})
