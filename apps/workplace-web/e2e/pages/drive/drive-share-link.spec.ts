// 드라이브 공유 링크 E2E (백엔드 없이 page.route 모킹).
// 시나리오:
//   1. 생성→URL 노출(/s/ 랜딩 URL 확인)→폐기 흐름 (POST body payload 검증 포함)
//   2. 공개 랜딩(/s/:token) — 인증 없이 접근 시 share-download-btn 표시
//   3. 공개 랜딩 — 비밀번호를 X-Share-Password 헤더로 전달, URL 쿼리 미포함 확인

import type { Page } from '@playwright/test'

import type { CreatedShareLink, ShareLink } from '../../../src/types/drive'

import { createFile, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const FILE_ID = 10

// 공간 목록 스텁 — DriveSidebar 마운트 시 페치.
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

// 공간 단건 스텁 — DrivePage 마운트 시 getSpace 호출.
async function stubSpaceSingle(page: Page) {
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createSpace({ id: SPACE_ID })),
          })
        : route.fallback(),
  )
}

// 항목 목록 스텁 — 파일 1건(FILE_ID=10) 포함.
async function stubItems(page: Page) {
  const file = createFile({ id: FILE_ID, name: 'report.txt' })
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files: [file] }),
          })
        : route.fallback(),
  )
}

// ── 공유 링크 생성→URL 노출→폐기 흐름 ──────────────────────────────────
test(
  '공유 링크 생성 → URL 노출 → 폐기 흐름',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // 링크 목록 상태 — 폐기 전/후 응답을 클로저로 제어
    let linkRevoked = false

    const createdLink: CreatedShareLink = {
      id: 5,
      token: 'sl_abc',
      audience: 'EXTERNAL',
      hasPassword: false,
      expiresAt: null,
    }

    const activeLink: ShareLink = {
      id: 5,
      audience: 'EXTERNAL',
      hasPassword: false,
      expiresAt: null,
      revoked: false,
      createdAt: '2026-06-21T00:00:00Z',
      createdBy: 1,
    }

    // POST → 생성 응답, GET → 목록 응답(폐기 여부 반영)
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${FILE_ID}/share-links`,
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(createdLink),
          })
        } else {
          // GET — 폐기 후에는 revoked: true 로 반환
          const link: ShareLink = { ...activeLink, revoked: linkRevoked }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([link]),
          })
        }
      },
    )

    // DELETE /api/v1/drive/share-links/5 → 204
    await page.route(
      (url) => url.pathname === '/api/v1/drive/share-links/5',
      async (route) => {
        if (route.request().method() === 'DELETE') {
          linkRevoked = true
          await route.fulfill({ status: 204, body: '' })
        } else {
          await route.fallback()
        }
      },
    )

    await stubSpaces(page)
    await stubSpaceSingle(page)
    await stubItems(page)

    // 드라이브 공간 진입
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    // 파일 행 호버 → 공유 링크 버튼 클릭 (#292 hover-reveal 패턴)
    const fileRow = page.getByRole('listitem').filter({ hasText: 'report.txt' })
    await fileRow.hover()
    await fileRow.getByTestId('share-link-btn').click()

    // 모달 열림 확인
    await expect(page.getByTestId('share-link-modal')).toBeVisible()

    // 외부 가시성(기본 선택) 유지 — EXTERNAL 라디오 확인
    const externalRadio = page.locator('#share-audience-external')
    await expect(externalRadio).toBeChecked()

    // ── 생성 버튼 클릭 ──
    let postedBody: Record<string, unknown> = {}
    // POST body 를 가로채기 위해 route 를 재등록하지 않고 waitForRequest 로 캡처
    const [postReq] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes(`/drive/files/${FILE_ID}/share-links`) &&
          req.method() === 'POST',
      ),
      page.getByTestId('share-link-create-btn').click(),
    ])
    postedBody = postReq.postDataJSON() as Record<string, unknown>

    // POST body 에 audience: 'EXTERNAL' 포함 검증 (입력→API payload 파이프라인)
    expect(postedBody.audience).toBe('EXTERNAL')

    // 생성 직후 URL 1회 표시 영역 확인
    const urlSection = page.getByTestId('share-link-created-url')
    await expect(urlSection).toBeVisible()

    // 생성된 URL input 값에 토큰 포함 + /s/ 랜딩 경로 확인 (다운로드 API URL 이 아닌 랜딩 URL)
    const urlInput = urlSection.getByRole('textbox', { name: /생성된 공유 링크/i })
    await expect(urlInput).toHaveValue(/sl_abc/)
    await expect(urlInput).toHaveValue(/\/s\//)
    // 다운로드 API 경로가 공유되지 않아야 한다
    const inputVal = await urlInput.inputValue()
    expect(inputVal).not.toContain('/api/v1/public/drive/share/')

    // 목록에 링크 1건 표시
    await expect(page.getByTestId('share-link-list')).toBeVisible()
    await expect(page.getByTestId('share-link-item')).toHaveCount(1)
    // 외부 배지 표시 확인
    await expect(page.getByTestId('share-link-item')).toContainText('외부')

    // ── 폐기 버튼 클릭 ──
    const [deleteReq] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes('/drive/share-links/5') && req.method() === 'DELETE',
      ),
      page.getByTestId('share-link-revoke-btn').click(),
    ])
    // DELETE 요청이 올바른 경로로 전송됐는지 확인
    expect(deleteReq.url()).toContain('/drive/share-links/5')

    // 폐기 후 목록 갱신 → '폐기됨' 배지 표시 (revoked: true)
    await expect(page.getByTestId('share-link-item')).toContainText('폐기됨')
    // 상태가 API 토큰 페이지와 동일한 Badge(pill) 컴포넌트로 렌더돼야 함 — 순수 텍스트 회귀 방지 (#675)
    await expect(
      page.getByTestId('share-link-item').getByText('폐기됨'),
    ).toHaveClass(/inline-flex/)
    // 폐기된 링크에는 폐기 버튼이 사라짐
    await expect(page.getByTestId('share-link-revoke-btn')).toHaveCount(0)
  },
)

// ── 과거 만료일 입력 시 생성 차단(#673) ──
// <input type=date min> 은 네이티브 캘린더 위젯 클릭만 막을 뿐 키보드 직접 입력은 통과시킨다.
// onCreate() 진입 시 명시적으로 재검증해 API 호출 자체를 막아야 한다.
test(
  '만료일에 과거 날짜 입력 시 생성이 차단되고 인라인 에러가 표시된다',
  async ({ authenticatedPage: page }) => {
    let postCalled = false
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${FILE_ID}/share-links`,
      async (route) => {
        if (route.request().method() === 'POST') {
          postCalled = true
          await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          })
        }
      },
    )

    await stubSpaces(page)
    await stubSpaceSingle(page)
    await stubItems(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    const fileRow = page.getByRole('listitem').filter({ hasText: 'report.txt' })
    await fileRow.hover()
    await fileRow.getByTestId('share-link-btn').click()
    await expect(page.getByTestId('share-link-modal')).toBeVisible()

    // 네이티브 min 제약을 우회 — fill() 로 과거 날짜를 직접 주입(키보드 타이핑과 동일 효과)
    await page.locator('#share-expires').fill('2020-01-01')
    await page.getByTestId('share-link-create-btn').click()

    // 인라인 에러 표시 + POST 호출 자체가 발생하지 않아야 한다
    await expect(page.getByTestId('share-expires-error')).toBeVisible()
    await expect(page.getByTestId('share-expires-error')).toContainText('오늘 이후')
    expect(postCalled).toBe(false)

    // 생성 직후 URL 노출 영역도 나타나지 않아야 한다
    await expect(page.getByTestId('share-link-created-url')).toHaveCount(0)
  },
)

// ── 만료일 표시 포맷 — 공용 formatDateOnly(zero-pad, 하이픈) 사용 확인 (#617) ──
test(
  '기존 링크 목록 — 만료일이 zero-pad 하이픈 포맷으로 표시된다',
  async ({ authenticatedPage: page }) => {
    const activeLink: ShareLink = {
      id: 5,
      audience: 'EXTERNAL',
      hasPassword: false,
      // 로케일 기본 포맷이면 "2099. 1. 5." 로 표시되던 값 — non-zero-pad 회귀 검증
      expiresAt: '2099-01-05T00:00:00Z',
      revoked: false,
      createdAt: '2026-06-21T00:00:00Z',
      createdBy: 1,
    }

    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${FILE_ID}/share-links`,
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([activeLink]),
          })
        } else {
          await route.fallback()
        }
      },
    )

    await stubSpaces(page)
    await stubSpaceSingle(page)
    await stubItems(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    const fileRow = page.getByRole('listitem').filter({ hasText: 'report.txt' })
    await fileRow.hover()
    await fileRow.getByTestId('share-link-btn').click()

    await expect(page.getByTestId('share-link-modal')).toBeVisible()

    const item = page.getByTestId('share-link-item')
    await expect(item).toBeVisible()
    // zero-pad 하이픈 포맷(YYYY-MM-DD) 표시 — formatDateOnly 결과
    await expect(item).toContainText('2099-01-05')
    // 로케일 기본 포맷(공백+점, non-zero-pad)이 남아있지 않아야 한다
    const text = await item.innerText()
    expect(text).not.toMatch(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?/)
  },
)

// ── 만료일 표시 — 콜론 포함 오프셋(+09:00) 회귀 검증 (#617 재발) ──
// 백엔드 OffsetDateTime 직렬화는 "+09:00" 같은 콜론 포함 오프셋을 내려준다.
// parseUtcDate 의 오프셋 판별 정규식이 이를 인식 못하면 Invalid Date → "-" 로 표시된다.
test(
  '기존 링크 목록 — 콜론 포함 오프셋(+09:00) 만료일도 "-" 없이 표시된다',
  async ({ authenticatedPage: page }) => {
    const activeLink: ShareLink = {
      id: 5,
      audience: 'EXTERNAL',
      hasPassword: false,
      expiresAt: '2099-01-05T23:59:59+09:00',
      revoked: false,
      createdAt: '2026-06-21T00:00:00Z',
      createdBy: 1,
    }

    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${FILE_ID}/share-links`,
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([activeLink]),
          })
        } else {
          await route.fallback()
        }
      },
    )

    await stubSpaces(page)
    await stubSpaceSingle(page)
    await stubItems(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    const fileRow = page.getByRole('listitem').filter({ hasText: 'report.txt' })
    await fileRow.hover()
    await fileRow.getByTestId('share-link-btn').click()

    await expect(page.getByTestId('share-link-modal')).toBeVisible()

    const item = page.getByTestId('share-link-item')
    await expect(item).toBeVisible()
    // 회귀 시(콜론 오프셋 미인식) Invalid Date 가드로 "-" 만 표시되어 이 assertion 이 실패한다
    await expect(item).toContainText('2099-01-05')
  },
)

// ── 공개 랜딩 페이지 — 인증 없이 접근 ─────────────────────────────────
// ShareLinkPage (/s/:token) 는 AppLayout·인증 없이 렌더되어야 한다.
// 인증 fixture 를 쓰지 않고 기본 page 를 직접 사용.
test('공개 공유 링크 랜딩 — 인증 없이 share-download-btn 표시', async ({ page }) => {
  // /s/sl_abc 진입 시 /login 리디렉트 없이 랜딩 페이지가 렌더돼야 한다.
  await page.goto('/s/sl_abc')

  // 다운로드 버튼 표시 확인 (인증 없이 접근 가능)
  await expect(page.getByTestId('share-download-btn')).toBeVisible()
  await expect(page.getByTestId('share-download-btn')).toHaveText('다운로드')

  // /login 으로 리디렉트되지 않아야 한다
  expect(page.url()).not.toContain('/login')
})

// ── 비밀번호 헤더 계약 검증 — X-Share-Password 헤더로 전달, URL 쿼리 미포함 ──
// 다운로드 엔드포인트를 page.route 로 가로채 요청 헤더와 URL 을 검증한다.
test(
  '공개 랜딩 — 비밀번호를 X-Share-Password 헤더로 전달하고 URL 쿼리에는 미포함',
  async ({ page }) => {
    // 공개 다운로드 엔드포인트 모킹 — 파일 응답 대신 200 + 빈 blob
    let capturedHeaders: Record<string, string> = {}
    let capturedUrl = ''

    await page.route('**/api/v1/public/drive/share/*/download*', async (route) => {
      capturedHeaders = route.request().headers()
      capturedUrl = route.request().url()
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: {
          'Content-Disposition': "attachment; filename=\"test.txt\"",
        },
        body: 'file-content',
      })
    })

    await page.goto('/s/sl_pw')

    // 비밀번호 입력 — 항상 표시됨(토글 불필요)
    await expect(page.getByLabel('공유 링크 비밀번호')).toBeVisible()
    await page.getByLabel('공유 링크 비밀번호').fill('secret123')

    // 다운로드 버튼 클릭 → fetch 요청 발생
    const [fetchReq] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/public/drive/share/')),
      page.getByTestId('share-download-btn').click(),
    ])

    // 비밀번호가 X-Share-Password 헤더로 전달됐는지 확인
    // Playwright 는 헤더명을 소문자로 반환
    expect(capturedHeaders['x-share-password']).toBe('secret123')

    // URL 에 password 쿼리가 포함되지 않아야 한다
    expect(capturedUrl).not.toContain('password=')
    expect(fetchReq.url()).not.toContain('password=')

    // 토큰이 URL 에 포함됐는지 확인
    expect(capturedUrl).toContain('sl_pw')
  },
)

// ── 랜딩 페이지 — 401 오류 시 한국어 메시지 표시 ──
test('공개 랜딩 — 401 응답 시 친화적 에러 메시지 표시', async ({ page }) => {
  // 다운로드 엔드포인트 → 401 반환
  await page.route('**/api/v1/public/drive/share/*/download*', async (route) => {
    await route.fulfill({ status: 401, body: '' })
  })

  await page.goto('/s/sl_401')

  await page.getByTestId('share-download-btn').click()

  // 에러 메시지 표시 확인
  const errEl = page.getByTestId('share-error-msg')
  await expect(errEl).toBeVisible()
  await expect(errEl).toContainText('비밀번호가 필요하거나 올바르지 않습니다')
})
