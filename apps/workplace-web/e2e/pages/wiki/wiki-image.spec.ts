// 노트 본문 이미지 렌더·저장 보존 E2E (#750) — tiptap 에 image 노드가 없어 페이지를 열고
// 저장하면 본문의 이미지 마크다운이 영구 삭제되던 회귀를 막는다. 이제 image 노드가 blob
// objectURL 로 렌더되고(액세스 토큰이 메모리 Bearer 라 <img src> 는 인증을 못 실음),
// 저장 payload 의 마크다운에는 원본 API 경로가 그대로 남아야 한다(objectURL 을 본문에 쓰면
// 새로고침 시 깨진다). CONTENT_PATH(/api/v1/wiki/attachments/7/content)는 #751 에서
// 실제로 추가될 예정인 첨부 콘텐츠 엔드포인트로, 아직 백엔드에는 없다.
import type { Page } from '@playwright/test'
import type { WikiPageDetail } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 400
const CONTENT_PATH = '/api/v1/wiki/attachments/7/content'
const EXTERNAL_URL = 'https://example.com/x.png'

// 1x1 투명 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const saved: string[] = []

// wiki-table.spec.ts 패턴 — 에디터 진입에 필요한 스페이스/트리/멤버/상세 라우트를 모두 모킹한다.
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
            body: JSON.stringify([{ id: PAGE_ID, parentId: null, title: '이미지 테스트', position: 0, aiLastUsedAt: null }]),
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
        title: '이미지 테스트',
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

test.describe('노트 본문 이미지', () => {
  test.beforeEach(() => {
    saved.length = 0
  })

  test('본문의 이미지 마크다운이 blob 으로 렌더된다', async ({ authenticatedPage: page }) => {
    await page.route(CONTENT_PATH, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await setup(page, `# 제목\n\n![대체텍스트](${CONTENT_PATH})\n\n본문`)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    const img = page.getByTestId('wiki-image')
    await expect(img).toBeVisible()
    // objectURL 로 치환됐는지 — API 경로가 그대로 src 에 남아 있으면 인증이 깨진다.
    await expect(img).toHaveAttribute('src', /^blob:/)
    await expect(img).toHaveAttribute('alt', '대체텍스트')
  })

  test('이미지 로드 실패 시 플레이스홀더를 보여준다', async ({ authenticatedPage: page }) => {
    await page.route(CONTENT_PATH, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await setup(page, `![대체텍스트](${CONTENT_PATH})`)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    await expect(page.getByTestId('wiki-image-error')).toBeVisible()
    await expect(page.getByTestId('wiki-image')).toHaveCount(0)
  })

  test('본문을 편집해도 이미지 마크다운이 저장 payload 에 남는다', async ({ authenticatedPage: page }) => {
    await page.route(CONTENT_PATH, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await setup(page, `# 제목\n\n![대체텍스트](${CONTENT_PATH})\n\n본문`)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.getByTestId('wiki-image')).toBeVisible()

    // 본문 끝 문단을 클릭해 타이핑 → 800ms 디바운스 자동저장 발화.
    await page.locator('.ProseMirror p').filter({ hasText: '본문' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 추가')

    // 자동저장 완료 표시 — 헤더 저장상태 칩(wiki-save-state).
    await expect(page.getByTestId('wiki-save-state')).toHaveText('저장됨', { timeout: 5000 })

    // 핵심 단언 — 저장 payload 에 이미지 마크다운이 살아 있어야 한다(#750 의 버그 그 자체).
    expect(saved.length).toBeGreaterThan(0)
    expect(saved[saved.length - 1]).toContain(`![대체텍스트](${CONTENT_PATH})`)
  })

  test('외부 URL 이미지는 blob 변환 없이 원본 src 그대로 렌더된다', async ({ authenticatedPage: page }) => {
    // 아직 wiki 첨부 업로드 UI/엔드포인트가 없어 실사용에서 가장 흔히 밟히는 분기는
    // /api/v1 이 아닌 외부 https:// 패스스루다. 실제 네트워크로 나가지 않도록 스텁한다.
    await page.route(EXTERNAL_URL, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await setup(page, `# 제목\n\n![외부이미지](${EXTERNAL_URL})\n\n본문`)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
    await expect(page.locator('.ProseMirror')).toBeVisible()

    const img = page.getByTestId('wiki-image')
    await expect(img).toBeVisible()
    // blob 으로 치환되지 않고 원본 외부 URL 이 그대로 남아야 한다.
    await expect(img).toHaveAttribute('src', EXTERNAL_URL)
  })
})
