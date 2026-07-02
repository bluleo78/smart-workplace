// IssueCreateDialog 폼 유효성 검사 회귀 테스트 (#163).
// 제목 200자 초과 시 Zod 영문 기본 메시지 대신 한국어 오류 메시지가 표시되는지 검증.

import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createIssueSearchResponse, createIssue } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import { systemTypes } from '../../factories/issueType.factory'

const PROJECT_KEY = 'WP'

// 프로젝트 상세 + 이슈 목록 + 이슈 유형 공통 스텁.
async function stubProject(page: import('@playwright/test').Page) {
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

test.describe('IssueCreateDialog 유효성 검사 (#163)', () => {
  test('제목 200자 초과 시 한국어 오류 메시지가 표시된다', async ({ authenticatedPage: page }) => {
    await stubProject(page)
    await page.goto(`/projects/${PROJECT_KEY}`)

    // 이슈 생성 다이얼로그 오픈
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByRole('dialog', { name: '새 태스크' })).toBeVisible()

    // 201자 입력 — 200자 한도 초과
    const longTitle = 'A'.repeat(201)
    await page.getByLabel('제목').fill(longTitle)
    await page.getByRole('button', { name: '생성' }).click()

    // 한국어 오류 메시지 표시 검증 (영문 Zod 원시 메시지 없어야 함)
    await expect(page.getByText('제목은 200자 이하여야 합니다')).toBeVisible()
    await expect(page.getByText('Too big')).not.toBeVisible()
  })

  test('제목이 공백뿐이면 서버 요청 없이 클라이언트에서 막는다 (#612)', async ({
    authenticatedPage: page,
  }) => {
    await stubProject(page)

    // 이슈 생성 POST 가 호출되면 실패시킨다 — 공백뿐인 제목은 서버 왕복이 없어야 함.
    let createRequested = false
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/issues`, (route) => {
      if (route.request().method() === 'POST') {
        createRequested = true
        return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' })
      }
      return route.fallback()
    })

    await page.goto(`/projects/${PROJECT_KEY}`)
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByRole('dialog', { name: '새 태스크' })).toBeVisible()

    // 공백 3칸만 입력
    await page.getByLabel('제목').fill('   ')
    await page.getByRole('button', { name: '생성' }).click()

    // 클라이언트 인라인 오류가 표시되고, 서버로는 요청이 가지 않아야 한다.
    await expect(page.getByText('제목은 필수입니다')).toBeVisible()
    expect(createRequested).toBe(false)

    // 다이얼로그는 여전히 열려 있어야 한다 (제출되지 않았음).
    await expect(page.getByRole('dialog', { name: '새 태스크' })).toBeVisible()
  })

  test('제목 앞뒤 공백은 trim 되어 제출된다 (#612)', async ({ authenticatedPage: page }) => {
    await stubProject(page)

    let submittedTitle: string | undefined
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/issues`, (route) => {
      if (route.request().method() === 'POST') {
        submittedTitle = route.request().postDataJSON().title
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(createIssue({ title: 'trimmed title' })),
        })
      }
      return route.fallback()
    })

    await page.goto(`/projects/${PROJECT_KEY}`)
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByRole('dialog', { name: '새 태스크' })).toBeVisible()

    await page.getByLabel('제목').fill('  trimmed title  ')
    await page.getByRole('button', { name: '생성' }).click()

    await expect.poll(() => submittedTitle).toBe('trimmed title')
  })

  test('제목 200자 이하에서는 유효성 오류가 없다', async ({ authenticatedPage: page }) => {
    await stubProject(page)

    // POST 이슈 생성 스텁
    await mockApi(
      page,
      'POST',
      `/api/v1/projects/${PROJECT_KEY}/issues`,
      createIssue({ title: 'B'.repeat(200) }),
    )

    await page.goto(`/projects/${PROJECT_KEY}`)
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await expect(page.getByRole('dialog', { name: '새 태스크' })).toBeVisible()

    // 정확히 200자 입력 — 경계값
    await page.getByLabel('제목').fill('B'.repeat(200))
    await page.getByRole('button', { name: '생성' }).click()

    // 유효성 오류 없음 — dialog 가 닫히거나 오류 메시지 없음
    await expect(page.getByText('제목은 200자 이하여야 합니다')).not.toBeVisible()
    await expect(page.getByText('Too big')).not.toBeVisible()
  })
})
