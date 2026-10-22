// 노트 외부 공유 보기(WP-579) — 로그인하지 않은 브라우저가 /wiki/share/:token 을 열면 앱 셸 없는 읽기 전용 화면이 뜬다.
// 공개 API(/api/v1/public/wiki/shares/...)만 모킹한다 — 인증 모킹 없이(page 기본) 열어 로그인 없이도 그려지는지 본다.
import type { Page } from '@playwright/test'

import type { WikiPublicShare } from '../../../src/types/wiki'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/base.fixture'
import { solidPng } from '../../fixtures/png'
import { trackRequests } from '../../fixtures/requests'

const TOKEN = 'wsh_e2ePublic1'
const API = `/api/v1/public/wiki/shares/${TOKEN}`
const ROOT = 41
const CHILD = 42
const IMAGE_PATH = `${API}/pages/${ROOT}/attachments/7`
const PAGES: WikiPublicShare['pages'] = [
  { id: ROOT, parentId: null, title: '제품 로드맵', position: 0 },
  { id: CHILD, parentId: ROOT, title: '하반기 계획', position: 0 },
]
// 서버가 이미 가린 마크다운 — 가려진 멘션은 자리표시 글자, 범위 안 페이지 멘션은 제목 글자, 내부 링크는 글자만 남는다.
const ROOT_BODY = [
  '외부에 공개된 본문입니다',
  '담당 ‹접근 권한 없음› 관련 ‹접근 권한 없음›',
  '범위 안 페이지 하반기 계획 와 내부 링크 글자',
  '[참고 문서](https://example.com/ref)',
  `![그림](${IMAGE_PATH})`,
].join('\n\n')
const CHILD_BODY = '하위 페이지 본문입니다'

const share = (pageId: number): WikiPublicShare => ({
  workspaceName: '아이에이클라우드',
  rootPageId: ROOT,
  pages: PAGES,
  page: {
    id: pageId,
    title: PAGES.find((p) => p.id === pageId)?.title ?? '',
    markdown: pageId === ROOT ? ROOT_BODY : CHILD_BODY,
    updatedAt: '2026-10-21T01:00:00Z',
  },
})

/** 공개 조회 응답 — ?pageId 가 없으면 공유 루트, 있으면 그 페이지. 이미지는 단색 PNG. */
async function mockPublic(page: Page, status = 200) {
  await page.route((u) => u.pathname === API, (r) => {
    if (status !== 200) return r.fulfill({ status, json: status === 401 ? { loginRequired: true } : { message: 'x' } })
    const pageId = Number(new URL(r.request().url()).searchParams.get('pageId') ?? ROOT)
    return r.fulfill({ json: share(pageId) })
  })
  await page.route((u) => u.pathname === IMAGE_PATH, (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: solidPng(8, 8) }))
}

test.describe('노트 외부 보기(로그인 없음)', () => {
  test('로그인 없이 외부 링크를 연다 @smoke', async ({ page }) => {
    await mockPublic(page)
    await page.goto(`/wiki/share/${TOKEN}`)

    const view = page.getByTestId('wiki-public-share-page')
    await expect(view).toContainText('아이에이클라우드')
    await expect(view.getByRole('heading', { name: '제품 로드맵' })).toBeVisible()
    await expect(view).toContainText('외부에 공개된 본문입니다')
    // 앱 셸(앱 레일)은 없고, 로그인으로 보내지 않는다.
    await expect(page.getByTestId('app-rail')).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}$`))
    // 검색엔진 색인 막기 — 서버 헤더와 별개로 화면도 noindex 를 둔다.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    // 읽기 전용 — 편집 불가이고, 바깥 링크는 새 탭에 opener·referrer 없이 열린다.
    await expect(view.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    const link = view.getByRole('link', { name: '참고 문서' })
    await expect(link).toHaveAttribute('href', 'https://example.com/ref')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('rel', /noreferrer/)
    // 이미지는 공개 첨부 주소로 실제로 불러진다(본문은 편집기 스키마로만 그려지므로 로그인 API 를 부르지 않는다).
    const img = view.getByRole('img', { name: '그림' })
    await expect(img).toHaveAttribute('src', IMAGE_PATH)
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  })

  test('「전체 폭」 페이지는 외부 보기도 읽기 폭 제한 없이 편다 (WP-793)', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await mockPublic(page)
    // 공유 루트만 「전체 폭」으로 — 나중에 등록한 라우트가 먼저 받는다.
    await page.route((u) => u.pathname === API, (r) => {
      const pageId = Number(new URL(r.request().url()).searchParams.get('pageId') ?? ROOT)
      const s = share(pageId)
      return r.fulfill({ json: { ...s, page: { ...s.page, fullWidth: pageId === ROOT } } })
    })
    await page.goto(`/wiki/share/${TOKEN}`)

    const article = page.getByTestId('wiki-public-share-page').locator('article')
    await expect(article.getByRole('heading', { name: '제품 로드맵' })).toBeVisible()
    expect((await article.boundingBox())!.width).toBeGreaterThan(1000)

    // 기본 폭 페이지(하위)는 그대로 읽기 폭.
    await page.goto(`/wiki/share/${TOKEN}/pages/${CHILD}`)
    await expect(article.getByRole('heading', { name: '하반기 계획' })).toBeVisible()
    expect((await article.boundingBox())!.width).toBeLessThanOrEqual(768)
  })

  test('내부 링크를 로그인 없이 열면 로그인으로 가고 로그인 뒤 돌아온다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
    await mockPublic(page, 401)

    await page.goto(`/wiki/share/${TOKEN}/pages/${CHILD}`)
    await expect(page).toHaveURL(/\/login$/)
    // 로그인 뒤 AppLayout 이 1회 소비하는 대기 목적지 — 열었던 하위 페이지 주소가 그대로 남는다.
    const pending = await page.evaluate(() => sessionStorage.getItem('pendingPushTarget'))
    expect(JSON.parse(pending!)).toEqual({ tenantId: null, url: `/wiki/share/${TOKEN}/pages/${CHILD}` })
  })

  test('만료된 외부 링크 안내', async ({ page }) => {
    await mockPublic(page, 404)
    await page.goto(`/wiki/share/${TOKEN}`)

    const view = page.getByTestId('wiki-public-share-page')
    await expect(view).toContainText('링크가 열리지 않습니다')
    await expect(view).toContainText('공유가 해제됐거나 만료됐을 수 있습니다')
    // 안내 화면에도 색인 막기는 그대로.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    // 본문·트리는 없다.
    await expect(page.getByTestId('wiki-public-share-tree')).toHaveCount(0)
  })

  test('하위 페이지로 옮겨 다닌다', async ({ page }) => {
    const reqs = trackRequests(page, 'GET', API)
    await mockPublic(page)
    await page.goto(`/wiki/share/${TOKEN}`)

    const tree = page.getByTestId('wiki-public-share-tree')
    await expect(tree).toBeVisible()
    await expect(page.getByTestId('wiki-public-share-page')).toContainText('외부에 공개된 본문입니다')
    // 탭 제목은 문서 제목을 따른다.
    await expect(page).toHaveTitle(/제품 로드맵/)
    // 처음 열 땐 pageId 없이 — 서버가 공유 루트를 준다.
    expect(reqs.urls()[0].searchParams.has('pageId')).toBe(false)

    await tree.getByRole('button', { name: '하반기 계획' }).click()
    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}/pages/${CHILD}$`))
    await expect(page.getByTestId('wiki-public-share-page')).toContainText(CHILD_BODY)
    await expect(page.getByRole('heading', { name: '하반기 계획' })).toBeVisible()
    // 하위 이동은 ?pageId= 로 묻고, 옮겨 다니는 동안 트리는 그대로 남는다.
    expect(reqs.lastUrl()?.searchParams.get('pageId')).toBe(String(CHILD))
    await expect(tree.getByRole('button', { name: '제품 로드맵' })).toBeVisible()

    // 새로고침해도 주소의 pageId 로 같은 페이지가 열린다.
    await page.reload()
    await expect(page.getByTestId('wiki-public-share-page')).toContainText(CHILD_BODY)
    expect(reqs.lastUrl()?.searchParams.get('pageId')).toBe(String(CHILD))
  })

  test('가려진 멘션은 접근 권한 없음으로 보인다', async ({ page }) => {
    await mockPublic(page)
    await page.goto(`/wiki/share/${TOKEN}`)

    const body = page.getByTestId('wiki-public-share-page').locator('.wiki-editor')
    await expect(body).toContainText('담당 ‹접근 권한 없음› 관련 ‹접근 권한 없음›')
    // 범위 안 페이지는 제목 글자만, 내부 링크는 글자만 — 앱 안으로 이동하는 링크가 없다(바깥 http 링크 하나만 남는다).
    await expect(body).toContainText('범위 안 페이지 하반기 계획 와 내부 링크 글자')
    await expect(body.locator('a')).toHaveCount(1)
  })

  test('옮겨 다니는 동안에도 트리가 그대로 남는다', async ({ page }) => {
    await mockPublic(page)
    // 하위 페이지 응답만 늦춘다 — 기다리는 동안 트리가 사라지거나 본문이 빈 화면으로 깜빡이지 않아야 한다.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    await page.route((u) => u.pathname === API && u.searchParams.get('pageId') === String(CHILD), async (r) => {
      await gate
      await r.fulfill({ json: share(CHILD) })
    })
    await page.goto(`/wiki/share/${TOKEN}`)
    const tree = page.getByTestId('wiki-public-share-tree')
    try {
      await tree.getByRole('button', { name: '하반기 계획' }).click()
      await expect(page).toHaveURL(new RegExp(`/pages/${CHILD}$`))
      await expect(tree.getByRole('button', { name: '제품 로드맵' })).toBeVisible()
      await expect(page.getByTestId('wiki-public-share-skeleton')).toHaveCount(0)
    } finally {
      // 단언이 실패해도 막아 둔 라우트를 풀어 둔다(대기 중인 핸들러가 테스트 종료를 붙잡지 않게).
      release()
    }
    await expect(page.getByTestId('wiki-public-share-page')).toContainText(CHILD_BODY)
  })

  test('하위 페이지 하나만 열리지 않으면 트리는 두고 본문에만 안내한다', async ({ page }) => {
    await mockPublic(page)
    // 루트는 열렸고, 하위 페이지만 더는 공유되지 않는다(하위 밖으로 옮겨짐 등) — 404.
    await page.route((u) => u.pathname === API && u.searchParams.get('pageId') === String(CHILD), (r) =>
      r.fulfill({ status: 404, json: { message: 'x' } }))
    await page.goto(`/wiki/share/${TOKEN}`)
    const tree = page.getByTestId('wiki-public-share-tree')
    await tree.getByRole('button', { name: '하반기 계획' }).click()

    const view = page.getByTestId('wiki-public-share-page')
    await expect(view).toContainText('이 페이지는 더 이상 공유되지 않습니다')
    await expect(view).not.toContainText('링크가 열리지 않습니다')
    // 트리·머리는 그대로 — 다른 페이지로 다시 옮길 수 있다.
    await expect(view).toContainText('아이에이클라우드')
    await tree.getByRole('button', { name: '제품 로드맵' }).click()
    await expect(view).toContainText('외부에 공개된 본문입니다')
  })

  /** 켜 둔 동안만 열리는 링크 — revoke() 뒤엔 루트·하위 모두 404(해제). */
  async function mockRevocable(page: Page) {
    let revoked = false
    await page.route((u) => u.pathname === API, (r) => {
      if (revoked) return r.fulfill({ status: 404, json: { message: 'x' } })
      const pageId = Number(new URL(r.request().url()).searchParams.get('pageId') ?? ROOT)
      return r.fulfill({ json: share(pageId) })
    })
    return { revoke: () => { revoked = true } }
  }

  /** 닫힌 링크 화면 — 옛 트리·제목·워크스페이스 이름이 하나도 남지 않아야 한다. */
  async function expectLinkGone(page: Page) {
    const view = page.getByTestId('wiki-public-share-page')
    await expect(view).toContainText('링크가 열리지 않습니다')
    await expect(page.getByTestId('wiki-public-share-tree')).toHaveCount(0)
    for (const stale of ['제품 로드맵', '하반기 계획', '아이에이클라우드', '외부에 공개된 본문입니다']) {
      await expect(view).not.toContainText(stale)
    }
    await expect(view).not.toContainText('이 페이지는 더 이상 공유되지 않습니다')
  }

  test('해제된 뒤 다른 페이지를 열면 옛 트리·제목 없이 링크가 닫힌 안내가 뜬다', async ({ page }) => {
    const link = await mockRevocable(page)
    await page.goto(`/wiki/share/${TOKEN}`)
    const tree = page.getByTestId('wiki-public-share-tree')
    await expect(tree.getByRole('button', { name: '하반기 계획' })).toBeVisible()

    link.revoke()
    // 아직 열지 않은(캐시에 없는) 하위 페이지 — 404 뒤 루트를 다시 물어 해제를 알아챈다.
    await tree.getByRole('button', { name: '하반기 계획' }).click()
    await expectLinkGone(page)

    // 앞으로 돌아가 루트 주소로 와도(옛 응답이 캐시에 남아 있어도) 옛 본문은 보이지 않는다.
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}$`))
    await expectLinkGone(page)
  })

  test('하위만 닫힌 안내 뒤 링크가 해제되면 처음 페이지로 가도 닫힌 안내가 뜬다', async ({ page }) => {
    let revoked = false
    await mockPublic(page)
    await page.route((u) => u.pathname === API && u.searchParams.get('pageId') === String(CHILD), (r) =>
      r.fulfill({ status: 404, json: { message: 'x' } }))
    await page.route((u) => u.pathname === API && !u.searchParams.has('pageId'), (r) =>
      revoked ? r.fulfill({ status: 404, json: { message: 'x' } }) : r.fallback())
    await page.goto(`/wiki/share/${TOKEN}`)
    await page.getByTestId('wiki-public-share-tree').getByRole('button', { name: '하반기 계획' }).click()
    const view = page.getByTestId('wiki-public-share-page')
    await expect(view).toContainText('이 페이지는 더 이상 공유되지 않습니다')

    revoked = true
    await view.getByRole('button', { name: '처음 페이지로' }).click()
    await expectLinkGone(page)
  })

  test('휴대폰에서는 페이지 선택으로 옮겨 다닌다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const reqs = trackRequests(page, 'GET', API)
    await mockPublic(page)
    await page.goto(`/wiki/share/${TOKEN}`)

    // 왼쪽 트리는 숨고 그 자리에 선택 상자가 나온다.
    await expect(page.getByTestId('wiki-public-share-tree')).toBeHidden()
    await page.getByLabel('공유된 페이지').selectOption({ label: '하반기 계획' })
    await expect(page.getByTestId('wiki-public-share-page')).toContainText(CHILD_BODY)
    expect(reqs.lastUrl()?.searchParams.get('pageId')).toBe(String(CHILD))
  })

  test('일시적인 서버 오류는 만료와 다르게 안내하고 다시 시도할 수 있다', async ({ page }) => {
    let fail = true
    await page.route((u) => u.pathname === API, (r) =>
      fail ? r.fulfill({ status: 500, json: { message: 'x' } }) : r.fulfill({ json: share(ROOT) }))
    await page.goto(`/wiki/share/${TOKEN}`)

    const view = page.getByTestId('wiki-public-share-page')
    await expect(view).toContainText('문서를 불러오지 못했습니다')
    await expect(view).not.toContainText('만료됐을 수 있습니다')
    fail = false
    await view.getByRole('button', { name: '다시 시도' }).click()
    await expect(view).toContainText('외부에 공개된 본문입니다')
  })

  // robots.txt 로 막으면 크롤러가 화면을 받지 않아 noindex(화면 meta·nginx X-Robots-Tag)를 보지 못하고 주소만 색인될 수 있다 —
  // 공유 화면은 크롤링을 막지 않고 noindex 로만 막는다(nginx 헤더는 nginx.conf, 화면 meta 는 위 테스트들).
  test('robots.txt 가 공유 화면 크롤링을 막지 않는다', async ({ page }) => {
    const res = await page.request.get('/robots.txt')
    expect(await res.text()).not.toContain('Disallow: /wiki/share/')
  })
})
