// OPEN(공개) 프로젝트 생성 다이얼로그 E2E — ProjectType 확장 + key 입력 노출 검증.

import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi, createPageResponse } from '../../fixtures/api-mock'
import { createProject } from '../../factories/project.factory'

test.describe('OPEN 프로젝트 생성', () => {
  test(
    'OPEN(공개) 유형 토글이 다이얼로그에 표시된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))

      await page.goto('/projects')
      await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
      await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()

      // OPEN 토글 버튼 존재 확인
      await expect(page.getByRole('button', { name: '공개' })).toBeVisible()
    },
  )

  test('OPEN 유형 선택 시 key 입력 필드가 표시된다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))

    await page.goto('/projects')
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()

    // 공개 선택 — WP-855: 패널 없는 탭이 아니라 「프로젝트 유형」 묶음의 눌림 토글로 알린다.
    const typeGroup = page.getByRole('group', { name: '프로젝트 유형' })
    await expect(typeGroup.getByRole('button', { name: '팀' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await typeGroup.getByRole('button', { name: '공개' }).click()
    await expect(typeGroup.getByRole('button', { name: '공개' })).toHaveAttribute('aria-pressed', 'true')
    await expect(typeGroup.getByRole('button', { name: '팀' })).toHaveAttribute('aria-pressed', 'false')

    // OPEN 선택 시 key 입력 필드가 노출되어야 함
    await expect(page.getByLabel('key (예: WP)')).toBeVisible()
  })

  test('PERSONAL 선택 시 key 입력 필드가 숨겨진다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))

    await page.goto('/projects')
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()

    // 개인 탭 클릭
    await page.getByRole('button', { name: '개인' }).click()

    // PERSONAL 선택 시 key 입력 필드가 숨겨져야 함
    await expect(page.getByLabel('key (예: WP)')).not.toBeVisible()
  })

  test(
    'OPEN 프로젝트를 생성하면 type=OPEN + key 가 payload 에 포함된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
      const createCapture = await mockApi(
        page,
        'POST',
        '/api/v1/projects',
        // 응답: 생성된 OPEN 프로젝트
        createProject({ key: 'OPNQA', name: '공개 접수함', type: 'OPEN' }),
        { capture: true },
      )

      await page.goto('/projects')
      await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
      await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()

      // 공개 탭 선택
      await page.getByRole('button', { name: '공개' }).click()

      // key 와 이름 입력
      await page.getByLabel('key (예: WP)').fill('OPNQA')
      await page.getByLabel('이름').fill('공개 접수함')

      await page.getByRole('button', { name: '생성' }).click()

      // API payload 에 type=OPEN + key 포함 여부 검증
      const created = await createCapture.waitForRequest()
      expect(created.payload).toMatchObject({ type: 'OPEN', key: 'OPNQA', name: '공개 접수함' })
    },
  )
})
