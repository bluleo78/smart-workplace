import { createSpace, personalSpace } from '../factories/drive.factory'
import { wikiSpace } from '../factories/wiki.factory'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('리소스 접근 오류 제목', { tag: '@wiring' }, () => {
  test('프로젝트 오류 제목은 level-1 heading이다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/projects/RESOURCE-ERROR', (route) => route.fulfill({ status: 403, json: { message: '접근 권한이 없습니다' } }))
    await page.goto('/projects/RESOURCE-ERROR')
    await expect(page.getByRole('heading', { level: 1, name: '프로젝트를 불러올 수 없습니다' })).toBeVisible()
  })

  test('노트 공간 오류 제목은 level-1 heading이다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/wiki/spaces', (route) => route.fulfill({ json: [wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트' })] }))
    await page.route('**/api/v1/wiki/spaces/8/pages', (route) => route.fulfill({ status: 404, json: { message: '공간을 찾을 수 없습니다' } }))
    await page.goto('/wiki/spaces/8')
    await expect(page.getByRole('heading', { level: 1, name: '노트 공간을 찾을 수 없습니다' }).first()).toBeVisible()
  })

  test('드라이브 공간 오류 제목은 level-1 heading이다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: [personalSpace(), createSpace({ id: 1 })] }))
    await page.route('**/api/v1/drive/spaces/999', (route) => route.fulfill({ status: 403, json: { message: '접근 권한이 없습니다' } }))
    await page.route('**/api/v1/drive/spaces/999/items', (route) => route.fulfill({ status: 403, json: { message: '접근 권한이 없습니다' } }))
    await page.goto('/drive/spaces/999')
    await expect(page.getByRole('heading', { level: 1, name: '드라이브 공간을 불러올 수 없습니다' })).toBeVisible()
  })
})

// 모바일 전체 모듈을 열어 오류 본문과 모듈 헤더가 함께 h1이 되는 회귀를 막는다.
test.describe('모바일 리소스 접근 오류의 단일 제목', { tag: '@wiring' }, () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  for (const [label, path] of [
    ['프로젝트 상세', '/projects/RESOURCE-ERROR'],
    ['이슈 상세', '/projects/RESOURCE-ERROR/issues/1'],
    ['프로젝트 관리', '/projects/RESOURCE-ERROR/settings'],
  ]) {
    test(`${label} 오류만 h1이고 작업 모듈명은 유지된다`, async ({ authenticatedPage: page }) => {
      await page.route('**/api/v1/projects/RESOURCE-ERROR', (route) => route.fulfill({ status: 403, json: { message: '접근 권한이 없습니다' } }))
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: '프로젝트를 불러올 수 없습니다' })).toBeVisible()
      await expect(page.locator('h1')).toHaveText(['프로젝트를 불러올 수 없습니다'])
      await expect(page.getByTestId('mobile-back-title')).toHaveText('작업')
      await expect(page.getByTestId('mobile-back-title')).toBeVisible()
      await expect(page.getByTestId('mobile-back-title')).not.toHaveRole('heading')
      await page.getByRole('button', { name: '프로젝트 목록으로' }).click()
      await expect(page.getByRole('heading', { level: 1, name: '프로젝트', exact: true })).toBeVisible()
      await expect(page.locator('h1')).toHaveText(['프로젝트'])
    })
  }

  test('노트 오류만 h1이고 노트 모듈명은 유지된다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/wiki/spaces', (route) => route.fulfill({ json: [wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트' })] }))
    await page.route('**/api/v1/wiki/spaces/8/pages', (route) => route.fulfill({ status: 404, json: { message: '공간을 찾을 수 없습니다' } }))
    await page.goto('/wiki/spaces/8')
    await expect(page.getByRole('heading', { level: 1, name: '노트 공간을 찾을 수 없습니다' })).toBeVisible()
    await expect(page.locator('h1')).toHaveText(['노트 공간을 찾을 수 없습니다'])
    await expect(page.getByTestId('mobile-list-header').getByText('노트', { exact: true })).toBeVisible()
    await expect(page.getByTestId('mobile-list-header').getByText('노트', { exact: true })).not.toHaveRole('heading')
  })

  test('드라이브 오류만 h1이고 드라이브 모듈명은 유지된다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: [personalSpace(), createSpace({ id: 1 })] }))
    await page.route('**/api/v1/drive/spaces/999', (route) => route.fulfill({ status: 403, json: { message: '접근 권한이 없습니다' } }))
    await page.route('**/api/v1/drive/spaces/999/items', (route) => route.fulfill({ status: 403, json: { message: '접근 권한이 없습니다' } }))
    await page.goto('/drive/spaces/999')
    await expect(page.getByRole('heading', { level: 1, name: '드라이브 공간을 불러올 수 없습니다' })).toBeVisible()
    await expect(page.locator('h1')).toHaveText(['드라이브 공간을 불러올 수 없습니다'])
    await expect(page.getByTestId('mobile-back-title')).toHaveText('드라이브')
    await expect(page.getByTestId('mobile-back-title')).toBeVisible()
    await expect(page.getByTestId('mobile-back-title')).not.toHaveRole('heading')
  })
})
