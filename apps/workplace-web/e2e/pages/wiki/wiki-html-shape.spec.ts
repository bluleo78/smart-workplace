// 노트 HTML 모양 보존(WP-1240) — 페이지 스타일 CSS 가 노트 본문 범위에만 적용되고, 노트의 position:fixed 덮개가 본문 밖(제목·화면)을
// 덮지 못하는지. CSS 적용·contain 기하는 jsdom 이 잴 수 없어 실제 브라우저로 본다(@layout).
// 범위 가두기 순수 함수·주입·칩 동작은 src/components/wiki/wikiHtmlScope.test.ts, 저장 형식 라운드트립은 공용 패키지 테스트가 지킨다.
// 로그인·동기화 서버가 필요 없는 공개 공유 화면으로 띄운다 — 편집기·판 미리보기와 같은 확장(WikiStyle + WikiHtmlScope)을 쓴다.
import type { WikiPublicShare } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/base.fixture'

const TOKEN = 'wsh_e2eHtmlShape1'
const API = `/api/v1/public/wiki/shares/${TOKEN}`
const PAGE_ID = 51

// 노트 CSS 가 앱 전체를 바꾸려 하는 최악의 경우 — body 배경, 화면 전체를 덮는 fixed 덮개.
const BODY = [
  '<style data-wp-style>',
  'body{background:rgb(1, 2, 3)}',
  '.card{border-radius:12px;background:rgb(15, 23, 42);color:rgb(255, 255, 255);padding:16px}',
  '.cover{position:fixed;inset:0;z-index:2147483647;background:rgba(255, 0, 0, 0.5)}',
  '</style>',
  '',
  '<div class="card">',
  '',
  '매출 <span class="badge" style="color:rgb(22, 163, 74)">좋음</span>',
  '',
  '</div>',
  '',
  '<div class="cover">',
  '',
  '덮개',
  '',
  '</div>',
].join('\n')

const share: WikiPublicShare = {
  workspaceName: '아이에이클라우드',
  rootPageId: PAGE_ID,
  pages: [{ id: PAGE_ID, parentId: null, title: '분기 보고', position: 0 }],
  page: { id: PAGE_ID, title: '분기 보고', markdown: BODY, updatedAt: '2026-10-31T01:00:00Z' },
}

test.describe('노트 HTML 모양 (WP-1240)', () => {
  test('페이지 스타일은 본문에만 적용되고 fixed 덮개는 본문 밖을 덮지 못한다', { tag: '@layout' }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.route((u) => u.pathname === API, (r) => r.fulfill({ json: share }))
    await page.goto(`/wiki/share/${TOKEN}`)

    const view = page.getByTestId('wiki-public-share-page')
    const body = view.locator('.ProseMirror')
    const card = body.locator('div.card[data-wiki-html-box]')
    await expect(card).toContainText('매출')

    // 모양이 적용된다 — 카드 class 규칙과 span 의 인라인 style.
    await expect(card).toHaveCSS('border-radius', '12px')
    await expect(card).toHaveCSS('background-color', 'rgb(15, 23, 42)')
    await expect(card.locator('span.badge')).toHaveCSS('color', 'rgb(22, 163, 74)')
    // 보기 전용이라 페이지 스타일 칩은 보이지 않는다.
    await expect(view.getByTestId('wiki-style-chip')).toBeHidden()

    // body 규칙은 앱 문서가 아니라 본문 범위(본문 루트)에 걸린다.
    await expect(body).toHaveCSS('background-color', 'rgb(1, 2, 3)')
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgb(1, 2, 3)')

    // fixed 덮개는 본문 상자 안에 갇힌다 — 본문 위의 제목은 덮이지 않는다.
    const cover = body.locator('div.cover')
    const [coverBox, bodyBox] = await Promise.all([cover.boundingBox(), body.boundingBox()])
    expect(coverBox).not.toBeNull()
    expect(bodyBox).not.toBeNull()
    expect(coverBox!.y).toBeGreaterThanOrEqual(bodyBox!.y - 1)
    expect(coverBox!.y + coverBox!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height + 1)
    expect(coverBox!.height).toBeLessThan(900)
    const heading = view.getByRole('heading', { name: '분기 보고' })
    const hit = await heading.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!top && (top === el || el.contains(top))
    })
    expect(hit).toBe(true)
  })
})
