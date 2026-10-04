import type { DriveContentSearchResponse } from '../../../src/api/contentSearch'
import type { DriveSpace } from '../../../src/types/drive'
import { expect, test } from '../../fixtures/auth.fixture'

/**
 * 드라이브 통합 검색 E2E — 헤더 검색 입력 1개로 파일명+콘텐츠 검색을 동시 실행하고,
 * 결과를 "파일명 일치"/"내용 일치" 두 그룹으로 보여준다. 백엔드 없이 API 모킹으로 동작.
 */
test('통합 검색 — 콘텐츠 일치 결과에 스니펫과 AI Overview 버튼을 보여준다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  const SPACE_ID = 1
  const spaces: DriveSpace[] = [
    { id: SPACE_ID, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/items**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}`, (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )

  // 파일명 검색 — 빈 결과(이 테스트는 콘텐츠 일치만 검증).
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/search**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )

  // 콘텐츠 검색 — spaceId 쿼리 파라미터가 함께 전달되는지 캡처.
  let capturedSpaceId = ''
  const searchResponse: DriveContentSearchResponse = {
    hits: [
      {
        driveFileId: 1,
        fileId: 10,
        spaceId: SPACE_ID,
        spaceName: '내 드라이브',
        name: '예산안',
        mimeType: 'application/pdf',
        snippet: '내년도 <b>예산</b> 편성',
        score: 0.5,
      },
    ],
    semantic: true,
  }
  await page.route('**/api/v1/drive/search?*', (route) => {
    capturedSpaceId = new URL(route.request().url()).searchParams.get('spaceId') ?? ''
    return route.fulfill({ json: searchResponse })
  })

  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)

  // 통합 검색 입력 1개 — 파일명 검색과 동일한 aria-label.
  const searchInput = page.getByLabel('파일명 및 콘텐츠 검색')
  await expect(searchInput).toBeVisible()
  await searchInput.fill('예산')

  // 콘텐츠 일치 그룹에 결과가 표시된다.
  await expect(page.getByTestId('drive-content-results')).toBeVisible()
  await expect(page.getByText('예산안')).toBeVisible()
  await expect(page.getByText('내년도 예산 편성')).toBeVisible() // snippet(b 태그 제거 후)
  await expect(page.getByTestId('drive-content-hit').getByText('내 드라이브', { exact: true })).toBeVisible() // 스페이스 뱃지

  // spaceId 가 현재 공간으로 전달됨 — 콘텐츠 검색도 공간 스코프로 통일.
  expect(capturedSpaceId).toBe(String(SPACE_ID))

  // 풀페이지이므로 AI Overview 버튼이 노출된다.
  await expect(page.getByTestId('drive-overview-btn')).toBeVisible()
})

test('검색어 2자 미만은 검색을 실행하지 않는다', async ({ authenticatedPage: page }) => {
  const SPACE_ID = 1
  const spaces: DriveSpace[] = [
    { id: SPACE_ID, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/items**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}`, (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )

  let searchCalled = false
  await page.route('**/api/v1/drive/search?*', (route) => {
    searchCalled = true
    return route.fulfill({ json: { hits: [], semantic: false } })
  })

  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)

  await page.getByLabel('파일명 및 콘텐츠 검색').fill('a')
  // eslint-disable-next-line playwright/no-wait-for-timeout -- debounce(300ms) 가 지난 뒤에도 검색 요청이 없음(부재)을 확인
  await page.waitForTimeout(400) // debounce(300ms) 경과 대기

  expect(searchCalled).toBe(false)
  await expect(page.getByTestId('search-results')).toHaveCount(0)
})

// 콘텐츠 검색 API 실패 시에도 "검색 결과가 없습니다" 안내가 정상 노출되는지 회귀 검증
// (contentLoading 가드가 에러 경로에서 풀리지 않으면 빈 상태 메시지가 영구히 숨겨진다).
test('콘텐츠 검색 API 실패 시에도 검색 결과 없음 안내가 표시된다', async ({ authenticatedPage: page }) => {
  const SPACE_ID = 1
  const spaces: DriveSpace[] = [
    { id: SPACE_ID, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/items**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}`, (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )

  // 파일명 검색은 정상(빈 결과), 콘텐츠 검색은 500 에러로 응답.
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/search**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )
  await page.route('**/api/v1/drive/search?*', (route) =>
    route.fulfill({ status: 500, json: { status: 500, error: 'Internal Server Error', message: '검색 실패' } }),
  )

  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)

  await page.getByLabel('파일명 및 콘텐츠 검색').fill('예산')

  // contentLoading 이 에러 경로에서도 해제되어 빈 상태 안내가 뜬다(영구 숨김 방지).
  // #789: DS 4요소 빈 상태로 통일 — 검색어 포함 메시지로 노출.
  await expect(page.getByTestId('drive-search-empty')).toBeVisible()
  await expect(page.getByText("'예산'에 대한 결과가 없습니다.")).toBeVisible()
})

// 회귀 #789: 검색 결과 0건 시 DS §2.5 4요소(아이콘+검색어 포함 메시지+설명+검색 초기화 버튼)가
// 표시되고, "검색 초기화" 클릭 시 검색어가 지워져 폴더/파일 기본 목록으로 돌아간다.
test('검색 결과 0건 — 빈 상태 4요소 표시 + 검색 초기화 버튼으로 검색어 초기화', async ({
  authenticatedPage: page,
}) => {
  const SPACE_ID = 1
  const spaces: DriveSpace[] = [
    { id: SPACE_ID, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/items**`, (route) =>
    route.fulfill({ json: { folders: [], files: [{ id: 1, name: '기본목록.txt', category: 'TEXT' }] } }),
  )
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}`, (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )

  // 파일명·콘텐츠 검색 모두 빈 결과.
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/search**`, (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )
  await page.route('**/api/v1/drive/search?*', (route) => route.fulfill({ json: { hits: [], semantic: false } }))

  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)

  await expect(page.getByText('기본목록.txt')).toBeVisible()

  const searchInput = page.getByLabel('파일명 및 콘텐츠 검색')
  await searchInput.fill('존재하지않는검색어')

  const emptyState = page.getByTestId('drive-search-empty')
  await expect(emptyState).toBeVisible()
  await expect(emptyState.getByText("'존재하지않는검색어'에 대한 결과가 없습니다.")).toBeVisible()
  await expect(emptyState.getByText('다른 키워드로 검색해 보세요.')).toBeVisible()
  const resetButton = emptyState.getByTestId('drive-search-empty-reset')
  await expect(resetButton).toBeVisible()

  await resetButton.click()

  // 검색어가 비워지고 기본 목록으로 돌아온다.
  await expect(searchInput).toHaveValue('')
  await expect(page.getByTestId('drive-search-empty')).toHaveCount(0)
  await expect(page.getByText('기본목록.txt')).toBeVisible()
})
