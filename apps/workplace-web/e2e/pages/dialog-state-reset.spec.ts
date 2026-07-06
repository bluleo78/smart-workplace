// Dialog 닫기 후 재열기 시 이전 데이터·오류 메시지 잔류 버그 회귀 테스트 (#178).
// IssueCreateDialog / ProjectCreateDialog / 역할 추가 Dialog 가 닫힐 때 폼 상태를 초기화하는지 검증.

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi, createPageResponse } from '../fixtures/api-mock'
import { createIssueSearchResponse, createIssue } from '../factories/issue.factory'
import { createProject } from '../factories/project.factory'
import { systemTypes } from '../factories/issueType.factory'
import type { RoleResponse } from '../../src/types/role'

const PROJECT_KEY = 'WP'

// IssueCreateDialog — 프로젝트 상세 + 이슈 목록 + 이슈 유형 공통 스텁.
async function stubProjectPage(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject())
  await mockApi(
    page,
    'GET',
    `/api/v1/projects/${PROJECT_KEY}/issues`,
    createIssueSearchResponse([createIssue({ title: '기존 이슈' })]),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/types`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(systemTypes()),
      }),
  )
  // 라벨 / 스프린트 등 기타 GET 은 빈 목록으로 처리.
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/**`, (route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/issues')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fallback()
  })
}

test.describe('IssueCreateDialog — 닫기 후 재열기 시 폼 상태 초기화 (#178)', () => {
  test('Escape로 닫고 재열기 시 입력값이 초기화된다', async ({ authenticatedPage: page }) => {
    await stubProjectPage(page)
    await page.goto(`/projects/${PROJECT_KEY}`)

    // 첫 번째 열기 — 제목 입력
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible()
    await page.getByLabel('제목').fill('테스트 제목')
    await expect(page.getByLabel('제목')).toHaveValue('테스트 제목')

    // Escape로 닫기
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '새 이슈' })).not.toBeVisible()

    // 재열기 — 제목 필드가 비어있어야 한다
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible()
    await expect(page.getByLabel('제목')).toHaveValue('')
  })

  test('유효성 오류 후 Escape로 닫고 재열기 시 오류 메시지가 사라진다', async ({ authenticatedPage: page }) => {
    await stubProjectPage(page)
    await page.goto(`/projects/${PROJECT_KEY}`)

    // 빈 제목으로 생성 시도 — 오류 메시지 발생
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible()
    await page.getByRole('button', { name: '생성' }).click()
    await expect(page.getByText('제목은 필수입니다')).toBeVisible()

    // Escape로 닫기
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '새 이슈' })).not.toBeVisible()

    // 재열기 — 오류 메시지가 없어야 한다
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByRole('dialog', { name: '새 이슈' })).toBeVisible()
    await expect(page.getByText('제목은 필수입니다')).not.toBeVisible()
  })

  test('취소 버튼으로 닫고 재열기 시 입력값이 초기화된다', async ({ authenticatedPage: page }) => {
    await stubProjectPage(page)
    await page.goto(`/projects/${PROJECT_KEY}`)

    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await page.getByLabel('제목').fill('임시 제목')
    await page.getByRole('button', { name: '취소' }).click()
    await expect(page.getByRole('dialog', { name: '새 이슈' })).not.toBeVisible()

    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByLabel('제목')).toHaveValue('')
  })
})

test.describe('ProjectCreateDialog — 닫기 후 재열기 시 폼 상태 초기화 (#178)', () => {
  test('Escape로 닫고 재열기 시 입력값이 초기화된다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
    await page.goto('/projects')

    // 첫 번째 열기 — key 필드 입력
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()
    await page.getByLabel('key (예: WP)').fill('MYKEY')
    await page.getByLabel('이름').fill('내 프로젝트')
    await expect(page.getByLabel('key (예: WP)')).toHaveValue('MYKEY')

    // Escape로 닫기
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).not.toBeVisible()

    // 재열기 — key / 이름 필드가 비어있어야 한다
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click()
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()
    await expect(page.getByLabel('key (예: WP)')).toHaveValue('')
    await expect(page.getByLabel('이름')).toHaveValue('')
  })
})

test.describe('역할 추가 Dialog — 닫기 후 재열기 시 폼 상태 초기화 (#178)', () => {
  const mockRoles: RoleResponse[] = [
    { id: 1, name: 'ADMIN', description: '시스템 관리자', isSystem: true },
    { id: 2, name: 'USER', description: '일반 사용자', isSystem: true },
  ]

  test('Escape로 닫고 재열기 시 입력값이 초기화된다', async ({ adminPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/roles', mockRoles)
    await page.goto('/settings/roles')
    await expect(page.getByTestId('page-header')).toContainText('역할')

    // 역할 추가 다이얼로그 열기 — 이름 입력
    await page.getByRole('button', { name: '역할 추가' }).click()
    await expect(page.getByRole('dialog', { name: '새 역할 생성' })).toBeVisible()
    await page.getByLabel('역할 이름').fill('테스트 역할')
    await expect(page.getByLabel('역할 이름')).toHaveValue('테스트 역할')

    // Escape로 닫기
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '새 역할 생성' })).not.toBeVisible()

    // 재열기 — 역할 이름 필드가 비어있어야 한다
    await page.getByRole('button', { name: '역할 추가' }).click()
    await expect(page.getByRole('dialog', { name: '새 역할 생성' })).toBeVisible()
    await expect(page.getByLabel('역할 이름')).toHaveValue('')
  })
})

// 공용 DialogContent 닫기(X) 버튼 클릭 영역 — WCAG 2.5.8 최소 24x24px (#706).
test('Dialog 닫기 버튼 클릭 영역이 24x24px 이상이다 (#706)', async ({ authenticatedPage: page }) => {
  await stubProjectPage(page)
  await page.goto(`/projects/${PROJECT_KEY}`)

  await page.getByRole('button', { name: '+ 새 태스크' }).click()
  const dialog = page.getByRole('dialog', { name: '새 이슈' })
  await expect(dialog).toBeVisible()

  const closeBtn = dialog.locator('[data-slot="dialog-close"]')
  const box = await closeBtn.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(24)
  expect(box!.height).toBeGreaterThanOrEqual(24)
})
