// 노트 본문 이미지 업로드 E2E (#751) — 붙여넣기/드래그드롭/슬래시 메뉴 세 진입점이 모두
// useWikiImageUpload 의 같은 파이프라인(자리표시자 → 업로드 → blob 렌더 → 저장 payload 에는
// 원본 API 경로)을 타는지 검증한다. #750(wiki-image.spec.ts)이 "이미 본문에 있는 이미지
// 마크다운의 렌더·저장 보존"을 다뤘다면, 이 스펙은 "새로 업로드해 삽입"하는 경로를 다룬다.
// 백엔드는 띄우지 않고 page.route() 로만 목킹한다.
import type { Page } from '@playwright/test'
import type { WikiPageDetail } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 12
const FILE_ID = 34
const CONTENT_PATH = `/api/v1/wiki/pages/${PAGE_ID}/attachments/${FILE_ID}/content`

// 1x1 투명 PNG — GET content 응답 바디. 업로드하는 파일 자체의 바이트는 서버 목킹이라 의미가
// 없어 아무 바이트나 쓰되, MIME/확장자만 실제 이미지처럼 맞춘다.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const saved: string[] = []
const uploadPosts: number[] = []

// wiki-image.spec.ts(#750)와 동일 패턴 — 에디터 진입에 필요한 스페이스/트리/멤버/상세 라우트.
async function setup(page: Page, body: string) {
  await page.route(
    (u) => u.pathname === '/api/v1/wiki/spaces',
    (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { id: SPACE_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' },
            ]),
          })
        : r.fallback(),
  )
  await page.route(
    (u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ id: PAGE_ID, parentId: null, title: '이미지 업로드 테스트', position: 0, aiLastUsedAt: null }]),
          })
        : r.fallback(),
  )
  await page.route(
    (u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`,
    (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback()),
  )
  await page.route(
    (u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`,
    (r) => {
      const d: WikiPageDetail = {
        id: PAGE_ID,
        spaceId: SPACE_ID,
        parentId: null,
        title: '이미지 업로드 테스트',
        body,
        version: 1,
        updatedBy: 1,
        updatedAt: '2026-06-01T00:00:00Z',
        aiLastUsedAt: null,
        aiLastAction: null,
      }
      const m = r.request().method()
      if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
      if (m === 'PUT') {
        saved.push((r.request().postDataJSON() as { body: string }).body)
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...d, version: 2 }) })
      }
      return r.fallback()
    },
  )
}

// 업로드 API 목킹 — status 로 성공/실패를 갈라 케이스별로 재사용한다.
async function stubUpload(page: Page, status: 201 | 500) {
  await page.route(
    (u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}/attachments`,
    (r) => {
      if (r.request().method() !== 'POST') return r.fallback()
      uploadPosts.push(1)
      if (status === 500) {
        return r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      }
      return r.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ fileId: FILE_ID, url: CONTENT_PATH, originalName: 'pasted.png', mimeType: 'image/png', sizeBytes: PNG.length }),
      })
    },
  )
  await page.route(CONTENT_PATH, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
}

// 클립보드에 이미지 파일을 담아 .ProseMirror 에 paste 이벤트를 디스패치한다(handlePaste 진입점).
async function pasteImageFile(page: Page, mimeType: string, name: string) {
  await page.locator('.ProseMirror').evaluate(
    (el, args) => {
      const file = new File([new Uint8Array([1, 2, 3])], args.name, { type: args.mimeType })
      const dt = new DataTransfer()
      dt.items.add(file)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { mimeType, name },
  )
}

// 클립보드에 이미지 파일과 텍스트를 동시에 담아 paste 이벤트를 디스패치한다 — 엑셀/워드에서
// 셀 범위를 복사하면 렌더링된 image/png 와 text/plain 이 함께 클립보드에 실리는 혼합 붙여넣기를
// 재현한다(핵심 회귀: 이 경우 기본 붙여넣기를 막으면 텍스트가 통째로 사라진다).
async function pasteMixedContent(page: Page, text: string) {
  await page.locator('.ProseMirror').evaluate(
    (el, args) => {
      const file = new File([new Uint8Array([1, 2, 3])], 'mixed.png', { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      dt.setData('text/plain', args.text)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { text },
  )
}

// 이미지 파일을 담아 .ProseMirror 에 drop 이벤트를 디스패치한다(handleDrop 진입점).
async function dropImageFile(page: Page) {
  await page.locator('.ProseMirror').evaluate((el) => {
    const file = new File([new Uint8Array([1, 2, 3])], 'dropped.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const rect = el.getBoundingClientRect()
    el.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 10, dataTransfer: dt }),
    )
  })
}

test.describe('노트 본문 이미지 업로드', () => {
  test.beforeEach(() => {
    saved.length = 0
    uploadPosts.length = 0
  })

  test('붙여넣기 업로드 성공 시 이미지가 blob 으로 렌더된다', async ({ authenticatedPage: page }) => {
    await stubUpload(page, 201)
    await setup(page, '')
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    await page.locator('.ProseMirror').click()
    await pasteImageFile(page, 'image/png', 'pasted.png')

    // 업로드 완료 → 자리표시자가 image 노드로 교체되고, WikiImage 가 CONTENT_PATH 를 fetch 해
    // objectURL 로 치환한다(#750 의 blob 렌더 경로를 그대로 탄다).
    const img = page.getByTestId('wiki-image')
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('src', /^blob:/)
  })

  test('저장 payload 의 마크다운에 원본 API 경로가 담긴다', async ({ authenticatedPage: page }) => {
    await stubUpload(page, 201)
    await setup(page, '')
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    await page.locator('.ProseMirror').click()
    await pasteImageFile(page, 'image/png', 'pasted.png')
    await expect(page.getByTestId('wiki-image')).toBeVisible()

    // 이미지 삽입 자체는 wikiImageUploadPlaceholder 메타가 없는 정상 트랜잭션이라 자동저장이 발화한다.
    await expect(page.getByTestId('wiki-save-state')).toHaveText('저장됨', { timeout: 5000 })

    // 0건이면 아래 인덱싱이 공허하게 통과한다 — 반드시 먼저 가드.
    expect(saved.length).toBeGreaterThan(0)
    expect(saved[saved.length - 1]).toContain(`](${CONTENT_PATH})`)
  })

  test('업로드 실패 시 자리표시자가 사라지고 에러 토스트가 뜬다', async ({ authenticatedPage: page }) => {
    await stubUpload(page, 500)
    await setup(page, '')
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    await page.locator('.ProseMirror').click()
    await pasteImageFile(page, 'image/png', 'pasted.png')

    // 워커 부하가 클 때 sonner 가 사라지는 중인 토스트를 잠깐 더 들고 있는 경우가 있어(#750
    // 계열 스펙과 같은 flake) strict-mode 위반을 피하려 first() 로 고정한다.
    await expect(page.locator('[data-sonner-toast]').first()).toContainText('이미지 업로드에 실패했습니다.')
    await expect(page.getByTestId('wiki-image')).toHaveCount(0)
    // 자리표시자(⏳ 이미지 업로드 중…)가 삭제 트랜잭션으로 제거돼 본문에 남지 않아야 한다.
    await expect(page.locator('.ProseMirror')).not.toContainText('업로드 중')
  })

  test('거부된 형식(SVG)은 업로드 요청 없이 토스트만 뜬다', async ({ authenticatedPage: page }) => {
    await stubUpload(page, 201)
    await setup(page, '')
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    await page.locator('.ProseMirror').click()
    await pasteImageFile(page, 'image/svg+xml', 'x.svg')

    await expect(page.locator('[data-sonner-toast]').first()).toContainText('PNG·JPEG·GIF·WebP 이미지만 10MB 까지 올릴 수 있습니다.')
    expect(uploadPosts.length).toBe(0)
    await expect(page.getByTestId('wiki-image')).toHaveCount(0)
  })

  test('혼합 붙여넣기(텍스트+이미지)는 텍스트를 보존하면서 이미지도 업로드한다', async ({ authenticatedPage: page }) => {
    await stubUpload(page, 201)
    await setup(page, '')
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    await page.locator('.ProseMirror').click()
    await pasteMixedContent(page, '엑셀표 텍스트')

    // 텍스트는 기본 붙여넣기를 그대로 태워 즉시 보존된다 — preventDefault 를 호출했다면
    // (Blocker 재발) 이 어서션이 실패한다.
    await expect(page.locator('.ProseMirror')).toContainText('엑셀표 텍스트')
    // 이미지는 마이크로태스크로 미뤄 비동기 업로드되므로, 텍스트 보존과 별개로 결국
    // blob 으로 렌더돼야 한다 — 텍스트를 살리는 대신 이미지를 잃어서는 안 된다.
    const img = page.getByTestId('wiki-image')
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('src', /^blob:/)
  })

  test('드래그드롭 업로드 성공 시 이미지가 blob 으로 렌더된다', async ({ authenticatedPage: page }) => {
    await stubUpload(page, 201)
    await setup(page, '')
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    await dropImageFile(page)

    const img = page.getByTestId('wiki-image')
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('src', /^blob:/)
  })

  test('슬래시 메뉴 이미지 항목 → 파일 선택 → 삽입', async ({ authenticatedPage: page }) => {
    await stubUpload(page, 201)
    await setup(page, '')
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    await page.locator('.ProseMirror').click()
    await page.keyboard.type('/')
    await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()

    // '이미지' 항목 클릭 → onImageInsertRef 가 숨은 file input(wiki-image-slash-input) 을 클릭해
    // OS 파일 선택기를 연다 — Playwright 의 filechooser 이벤트로 가로챈다.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('wiki-slash-option-image').click(),
    ])
    await chooser.setFiles({ name: 'slash.png', mimeType: 'image/png', buffer: PNG })

    const img = page.getByTestId('wiki-image')
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('src', /^blob:/)
  })
})
