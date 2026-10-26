// 노트 외부 공유 보기(WP-579) — 로그인하지 않은 브라우저가 /wiki/share/:token 을 열면 앱 셸 없는 읽기 전용 화면이 뜬다.
// 공개 API(/api/v1/public/wiki/shares/...)만 모킹한다 — 인증 모킹 없이(page 기본) 열어 로그인 없이도 그려지는지 본다.
// 하위 이동(?pageId)·가린 멘션·만료/하위만 닫힘/해제·일시 오류·로그인 필요(401)·휴대폰 선택 상자는 src/pages/wiki/wikiShare.test.tsx 가 지킨다(WP-983).
// 여기엔 배선(@wiring)·전체 폭 기하(@layout)·robots.txt(@platform)만 남는다.
import type { Page } from '@playwright/test'

import type { WikiPublicShare } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/base.fixture'
import { solidPng } from '../../fixtures/png'

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
  test('로그인 없이 외부 링크를 연다 @smoke', { tag: '@wiring' }, async ({ page }) => {
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

  test('「전체 폭」 페이지는 외부 보기도 읽기 폭 제한 없이 편다 (WP-793)', { tag: '@layout' }, async ({ page }) => {
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

  // robots.txt 로 막으면 크롤러가 화면을 받지 않아 noindex(화면 meta·nginx X-Robots-Tag)를 보지 못하고 주소만 색인될 수 있다 —
  // 공유 화면은 크롤링을 막지 않고 noindex 로만 막는다(nginx 헤더는 nginx.conf, 화면 meta 는 위 테스트들).
  test('robots.txt 가 공유 화면 크롤링을 막지 않는다', { tag: '@platform' }, async ({ page }) => {
    const res = await page.request.get('/robots.txt')
    expect(await res.text()).not.toContain('Disallow: /wiki/share/')
  })
})
