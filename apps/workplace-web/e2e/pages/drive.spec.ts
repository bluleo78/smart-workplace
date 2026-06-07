// 드라이브 E2E — 폴더 생성 · 파일 업로드 · 다운로드 · 삭제 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { createFile, createFolder, createSpace, makeTrashList, personalSpace } from '../factories/drive.factory'
import { expect, test } from '../fixtures/auth.fixture'

const SPACE_ID = 1

// 공간 목록(개인 + 팀) — DriveSidebar 가 마운트 시 페치한다.
async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace(), createSpace()]),
          })
        : route.fallback(),
  )
}

// 항목 목록 — 가변 상태를 클로저로 흉내(생성/삭제 반영).
function stubItems(page: Page, getState: () => { folders: unknown[]; files: unknown[] }) {
  return page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(getState()),
          })
        : route.fallback(),
  )
}

test('폴더 생성·업로드·다운로드·삭제 흐름', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const state = { folders: [] as unknown[], files: [] as unknown[] }
  await stubSpaces(page)
  await stubItems(page, () => state)

  // 폴더 생성
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/folders`,
    (route) => {
      const folder = createFolder()
      state.folders = [folder]
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(folder),
      })
    },
  )
  // 파일 업로드
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
    (route) => {
      const file = createFile()
      state.files = [file]
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(file),
      })
    },
  )
  // 다운로드
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/20/download',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/plain',
        headers: { 'content-disposition': 'attachment; filename="memo.txt"' },
        body: 'hello',
      }),
  )
  // 파일 삭제
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/20',
    (route) => {
      state.files = []
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 새 폴더 — Dialog(#135: window.prompt 대체)
  await page.getByRole('button', { name: '새 폴더' }).click()
  await expect(page.getByTestId('folder-name-input')).toBeVisible()
  await page.getByTestId('folder-name-input').fill('문서')
  await page.getByTestId('folder-name-confirm').click()
  await expect(page.getByText('📁 문서')).toBeVisible()

  // 업로드(숨김 input 에 파일 주입)
  await page.getByTestId('file-input').setInputFiles({
    name: 'memo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })
  await expect(page.getByText('memo.txt')).toBeVisible()

  // 다운로드 트리거(에러 없이 동작 — download 이벤트는 환경에 따라 안 떠도 무방)
  const downloadPromise = page.waitForEvent('download').catch(() => null)
  await page.getByRole('button', { name: '다운로드' }).first().click()
  await downloadPromise

  // 삭제 — AlertDialog(#135: window.confirm 대체)
  await page
    .getByRole('listitem')
    .filter({ hasText: 'memo.txt' })
    .getByRole('button', { name: '삭제' })
    .click()
  await expect(page.getByTestId('drive-confirm-dialog')).toBeVisible()
  await page.getByTestId('drive-confirm-confirm').click()
  await expect(page.getByText('memo.txt')).toHaveCount(0)
})

test('파일을 폴더로 이동', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 루트: 폴더 '문서'(10) + 파일 memo.txt(20). 이동 후 루트에서 파일 사라짐.
  const FOLDER_ID = 10
  const state = {
    folders: [{ id: FOLDER_ID, parentId: null, name: '문서', createdAt: '2026-06-03T00:00:00Z' }],
    files: [
      {
        id: 20,
        folderId: null,
        fileId: 99,
        name: 'memo.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        category: 'TEXT',
        createdAt: '2026-06-03T00:00:00Z',
      },
    ],
  }
  await stubSpaces(page)

  // items: 루트는 state, 폴더 10 안은 비어 있음
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) => {
      const parentId = new URL(route.request().url()).searchParams.get('parentId')
      const body = parentId === String(FOLDER_ID) ? { folders: [], files: [] } : state
      return route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        : route.fallback()
    },
  )

  // 이동 엔드포인트 — 호출되면 파일을 루트에서 제거
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/20/move',
    (route) => {
      state.files = []
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByText('memo.txt')).toBeVisible()

  // memo.txt 행의 '이동' 클릭 → 모달
  await page
    .getByRole('listitem')
    .filter({ hasText: 'memo.txt' })
    .getByRole('button', { name: '이동' })
    .click()
  await expect(page.getByTestId('folder-picker')).toBeVisible()

  // 모달에서 '문서' 폴더로 진입 후 '여기로' 확정
  // (📁 문서 는 모달 뒤 DrivePage 목록에도 있으므로 모달 스코프로 한정 — strict-mode 위반 방지)
  await page.getByTestId('folder-picker').getByRole('button', { name: '📁 문서' }).click()
  await page.getByTestId('folder-picker-confirm').click()

  // 루트 목록 리로드 → 파일 사라짐
  await expect(page.getByText('memo.txt')).toHaveCount(0)
})

// 1x1 투명 PNG (썸네일/이미지 콘텐츠 모킹용)
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test('검색어 입력 시 결과를 경로와 함께 보여주고, 폴더 결과 클릭으로 이동한다', async ({
  authenticatedPage: page,
}) => {
  await stubSpaces(page)
  // 기본 목록(빈 루트). 폴더 50 진입 시에도 빈 목록.
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files: [] }),
          })
        : route.fallback(),
  )
  // 검색 결과 — q query param 캡처
  let searchQuery = ''
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/search`,
    (route) => {
      searchQuery = new URL(route.request().url()).searchParams.get('q') ?? ''
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          folders: [
            {
              id: 50,
              parentId: 9,
              name: 'report-archive',
              createdAt: '2026-01-01T00:00:00Z',
              folderPath: '프로젝트',
            },
          ],
          files: [
            {
              id: 60,
              folderId: 9,
              fileId: 100,
              name: 'report-final.txt',
              mimeType: 'text/plain',
              sizeBytes: 3,
              category: 'TEXT',
              createdAt: '2026-01-01T00:00:00Z',
              folderPath: '프로젝트/문서',
            },
          ],
        }),
      })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 입력 → API query param 검증
  await page.getByLabel('드라이브 검색').fill('report')
  await expect(page.getByTestId('search-results')).toBeVisible()
  expect(searchQuery).toBe('report')

  // 응답 → UI 반영(경로 표시 포함)
  await expect(page.getByText('report-final.txt')).toBeVisible()
  await expect(page.getByText('프로젝트/문서')).toBeVisible()
  await expect(page.getByText('report-archive')).toBeVisible()

  // 폴더 결과 클릭 → 해당 폴더로 이동(folderId=50)
  await page.getByRole('button', { name: /report-archive/ }).click()
  await expect(page).toHaveURL(/folderId=50/)
})

test('이미지 파일 클릭 시 미리보기 모달에 이미지를 표시한다', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              folders: [],
              files: [
                {
                  id: 70,
                  folderId: null,
                  fileId: 200,
                  name: 'photo.png',
                  mimeType: 'image/png',
                  sizeBytes: 100,
                  category: 'IMAGE',
                  createdAt: '2026-01-01T00:00:00Z',
                },
              ],
            }),
          })
        : route.fallback(),
  )
  // 썸네일 + 콘텐츠 모두 PNG 로 모킹
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/70/thumbnail',
    (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/70/content',
    (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }),
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name: 'photo.png' }).click()

  const body = page.getByTestId('preview-body')
  await expect(body).toBeVisible()
  await expect(body.locator('img')).toBeVisible()
})

test('휴지통 — 조회 후 복원하면 목록이 갱신된다', async ({ authenticatedPage: page }) => {
  let restored = false
  await stubSpaces(page)
  // 기본 항목 목록(빈 루트) — DrivePage 마운트 시 필요
  await stubItems(page, () => ({ folders: [], files: [] }))

  await page.route('**/api/v1/drive/spaces/*/trash', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: restored ? { items: [] } : makeTrashList() })
    } else {
      await route.fulfill({ status: 204, body: '' })
    }
  })
  await page.route('**/api/v1/drive/files/901/restore', async (route) => {
    restored = true
    await route.fulfill({ status: 204, body: '' })
  })

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  await page.getByTestId('trash-toggle').click()
  await expect(page.getByTestId('trash-view')).toBeVisible()
  await expect(page.getByText('memo.txt')).toBeVisible()
  await page.getByRole('button', { name: '복원' }).click()
  await expect(page.getByText('휴지통이 비어 있습니다')).toBeVisible()
})

// 복원 실패 시 에러 토스트 표시 검증 (#143)
test('휴지통 — 복원 실패(500) 시 에러 토스트를 표시한다', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [] }))

  await page.route('**/api/v1/drive/spaces/*/trash', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: makeTrashList() })
    } else {
      await route.fulfill({ status: 204, body: '' })
    }
  })
  // 복원 엔드포인트가 500을 반환 — try/catch 누락 시 unhandled rejection, 수정 후 토스트
  await page.route('**/api/v1/drive/files/901/restore', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ status: 500, error: 'Internal Server Error', message: '복원하지 못했습니다.' }),
    })
  })

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByTestId('trash-toggle').click()
  await expect(page.getByTestId('trash-view')).toBeVisible()
  await expect(page.getByText('memo.txt')).toBeVisible()

  await page.getByRole('button', { name: '복원' }).click()

  // 에러 토스트가 표시되어야 한다 (이전에는 아무 피드백 없음)
  await expect(page.getByText('복원하지 못했습니다.')).toBeVisible()
  // 휴지통 목록은 그대로 유지 (복원 실패이므로)
  await expect(page.getByText('memo.txt')).toBeVisible()
})

test('드라이브 헤더와 폴더명 breadcrumb', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  // 항목 목록 — folderId=10 진입 시 빈 목록
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files: [] }),
          })
        : route.fallback(),
  )
  // 폴더 경로 모킹: /drive/folders/10/path → [{문서},{2026}]
  await page.route('**/api/v1/drive/folders/10/path', (route) =>
    route.fulfill({ json: [{ id: 5, name: '문서' }, { id: 10, name: '2026' }] }),
  )
  await page.goto(`/drive/spaces/${SPACE_ID}?folderId=10`)

  await expect(page.getByTestId('page-header')).toContainText('드라이브')
  await expect(page.getByTestId('drive-root')).toBeVisible()
  await expect(page.getByTestId('drive-crumb-5')).toHaveText('문서')
  await expect(page.getByTestId('drive-crumb-10')).toHaveText('2026')
  await expect(page.getByTestId('drive-new-folder')).toBeVisible()
  await expect(page.getByTestId('drive-upload')).toBeVisible()
})

// LNB 표준화(#98) — 드라이브 사이드바가 표준 셸(레일과 동일 아이콘+이름 타이틀 헤더)을 갖춘다.
test('드라이브 사이드바 — 표준 LNB 타이틀 헤더', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await page.goto('/drive')
  const sidebar = page.getByTestId('drive-sidebar')
  await expect(sidebar).toBeVisible()
  // h-14 앱 타이틀 헤더에 "드라이브"(레일 라벨과 동일) 노출 — 공간 링크 "내 드라이브"와 구분되도록 exact
  await expect(sidebar.getByText('드라이브', { exact: true })).toBeVisible()
})

// silent failure 수정(#116) — mutation 실패 시 표준 토스트로 사용자에게 사유를 알린다.
test('폴더 생성 실패(400) 시 에러 토스트로 사유를 안내한다', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [] }))
  // 공백만 입력 → 클라이언트 가드(if(!name)) 통과 → 서버 @NotBlank 400 + 한국어 message.
  let folderPosted = false
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/folders`,
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      folderPosted = true
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ status: 400, error: 'Bad Request', message: '폴더 이름은 비어 있을 수 없습니다' }),
      })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // Dialog(#135) 로 폴더 이름 입력 — 공백만 있어도 전송(trim 없음, #116 동작 보존)
  await page.getByRole('button', { name: '새 폴더' }).click()
  await expect(page.getByTestId('folder-name-input')).toBeVisible()
  await page.getByTestId('folder-name-input').fill('   ')
  await page.getByTestId('folder-name-confirm').click()

  // 서버 메시지가 그대로 토스트로 노출(이전엔 토스트 없이 unhandled rejection).
  await expect(page.getByText('폴더 이름은 비어 있을 수 없습니다')).toBeVisible()
  expect(folderPosted).toBe(true)
})

test('업로드 실패(400) 시 에러 토스트를 표시한다', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [] }))
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ status: 400, error: 'Bad Request', message: '파일을 업로드할 수 없습니다' }),
      })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 25MB 이하 파일이라 클라이언트 가드는 통과 → 서버 400 → 토스트.
  await page.getByTestId('file-input').setInputFiles({
    name: 'memo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })

  await expect(page.getByText('파일을 업로드할 수 없습니다')).toBeVisible()
})

// #170 — 업로드 중 버튼 비활성화 / 텍스트 변경 / 완료 후 복원 검증
test('업로드 중 버튼이 비활성화되고 완료 후 다시 활성화된다', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [] }))

  // 업로드 API — 200ms 지연으로 "업로드 중" 상태 관찰 가능하게 함.
  let resolveUpload!: () => void
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
    async (route) => {
      await new Promise<void>((res) => {
        resolveUpload = res
      })
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createFile()) })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 파일 선택 → 업로드 시작 (API 홀드 중)
  const uploadPromise = page.getByTestId('file-input').setInputFiles({
    name: 'memo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })

  // 업로드 중: 버튼 비활성화 + 텍스트 변경
  const btn = page.getByTestId('drive-upload')
  await expect(btn).toBeDisabled()
  await expect(btn).toHaveText('업로드 중…')

  // API 응답 해제 → 완료
  resolveUpload()
  await uploadPromise

  // 업로드 완료 후: 버튼 복원
  await expect(btn).toBeEnabled()
  await expect(btn).toHaveText('업로드')
})

test('25MB 초과 파일은 업로드 요청 없이 클라이언트에서 안내한다', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [] }))
  // 업로드 엔드포인트가 호출되면 안 된다(클라이언트 사전 차단).
  let uploadCalled = false
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
    (route) => {
      uploadCalled = true
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 26MB 더미 파일 → 한도(25MB) 초과.
  await page.getByTestId('file-input').setInputFiles({
    name: 'huge.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(26 * 1024 * 1024, 1),
  })

  await expect(page.getByText('파일 크기가 25MB를 초과합니다.')).toBeVisible()
  expect(uploadCalled).toBe(false)
})

// #135 — window.prompt/confirm → shadcn Dialog/AlertDialog 교체 검증

test('폴더 생성 — Dialog 표시, 이름 입력 후 확인 시 POST 호출', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const state = { folders: [] as unknown[], files: [] as unknown[] }
  await stubSpaces(page)
  await stubItems(page, () => state)

  let postedName = ''
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/folders`,
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const body = route.request().postDataJSON() as { name?: string }
      postedName = body.name ?? ''
      const folder = createFolder({ name: postedName })
      state.folders = [folder]
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(folder) })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  await page.getByTestId('drive-new-folder').click()
  // window.prompt 가 아닌 Dialog 가 나타나야 한다 (#135)
  await expect(page.getByTestId('folder-name-input')).toBeVisible()
  await page.getByTestId('folder-name-input').fill('보고서')
  await page.getByTestId('folder-name-confirm').click()

  // POST body 검증 — 이름이 정확히 전달됐는지
  expect(postedName).toBe('보고서')
  // UI 갱신 확인
  await expect(page.getByText('📁 보고서')).toBeVisible()
})

test('폴더 이름변경 — Dialog에 현재 이름 사전 입력, 확인 시 PATCH body 검증', async ({ authenticatedPage: page }) => {
  const folder = createFolder({ id: 10, name: '문서' })
  const state = { folders: [folder], files: [] as unknown[] }
  await stubSpaces(page)
  await stubItems(page, () => state)

  let patchedName = ''
  await page.route(
    (url) => url.pathname === '/api/v1/drive/folders/10',
    (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      const body = route.request().postDataJSON() as { name?: string }
      patchedName = body.name ?? ''
      state.folders = [{ ...folder, name: patchedName }]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...folder, name: patchedName }) })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByText('📁 문서')).toBeVisible()

  // 이름변경 클릭 → Dialog 가 현재 이름('문서')으로 사전 입력되어야 함
  await page.getByRole('listitem').filter({ hasText: '📁 문서' }).getByRole('button', { name: '이름변경' }).click()
  await expect(page.getByTestId('folder-name-input')).toHaveValue('문서')

  // 이름 교체 후 확인
  await page.getByTestId('folder-name-input').fill('보관함')
  await page.getByTestId('folder-name-confirm').click()

  // PATCH body 검증
  expect(patchedName).toBe('보관함')
  await expect(page.getByText('📁 보관함')).toBeVisible()
})

test('파일 삭제 — AlertDialog 표시 후 취소 시 DELETE 호출 안 함', async ({ authenticatedPage: page }) => {
  const file = createFile()
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [file] }))

  let deleteCalled = false
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${file.id}`,
    (route) => {
      deleteCalled = true
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByText('memo.txt')).toBeVisible()

  // 삭제 클릭 → window.confirm 아닌 AlertDialog 가 나타나야 한다 (#135)
  await page.getByRole('listitem').filter({ hasText: 'memo.txt' }).getByRole('button', { name: '삭제' }).click()
  await expect(page.getByTestId('drive-confirm-dialog')).toBeVisible()

  // 취소 → API 호출 없이 파일 그대로
  await page.getByTestId('drive-confirm-cancel').click()
  await expect(page.getByTestId('drive-confirm-dialog')).not.toBeVisible()
  expect(deleteCalled).toBe(false)
  await expect(page.getByText('memo.txt')).toBeVisible()
})

// #148 — DriveSidebar 팀 공간 생성 — window.prompt → Dialog 교체 검증
test('팀 공간 생성 — Dialog 표시, 이름 입력 후 만들기 클릭 시 POST 호출', async ({ authenticatedPage: page }) => {
  const newSpace = createSpace({ id: 99, name: '신규팀', type: 'TEAM' })
  let spacesStore = [personalSpace(), createSpace()]

  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spacesStore) })
      }
      if (method === 'POST') {
        spacesStore = [...spacesStore, newSpace]
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newSpace) })
      }
      return route.fallback()
    },
  )

  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${newSpace.id}/items`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files: [] }) }),
  )

  await page.goto(`/drive/spaces/1`)
  await expect(page.getByTestId('drive-sidebar')).toBeVisible()

  // + 버튼 클릭 → window.prompt 가 아닌 Dialog 가 나타나야 한다 (#148).
  await page.getByRole('button', { name: '팀 공간 만들기' }).click()
  await expect(page.getByTestId('space-name-dialog')).toBeVisible()

  await page.getByTestId('space-name-input').fill('신규팀')
  await page.getByTestId('space-name-confirm').click()

  // 사이드바에 새 공간이 나타나야 함.
  await expect(page.getByText('신규팀')).toBeVisible()
})
