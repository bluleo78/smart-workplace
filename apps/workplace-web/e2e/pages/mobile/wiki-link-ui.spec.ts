// 모바일(터치 셸, 390px) 노트 링크 시트 E2E(WP-312) — 편집 중 링크를 누르면 바텀시트(열기·고치기·해제),
// 고치기·🔗 는 키보드 위로 올라오는 주소 입력 시트. 데스크톱 버블 시나리오는 pages/wiki/wiki-link-ui.spec.ts.
import type { Page } from '@playwright/test'

import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockWikiMentions, mockWikiPageEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 413
const LINK_URL = 'https://example.com/spec'

async function open(page: Page, body: string, role: 'OWNER' | 'VIEWER' = 'OWNER') {
  await mockWikiMentions(page, PAGE_ID, [])
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '링크 확인', body, role })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator(`.ProseMirror[contenteditable="${role === 'VIEWER' ? 'false' : 'true'}"]`)).toBeVisible()
}

test.describe('모바일 노트 링크 시트', () => {
  test('링크를 누르면 시트가 뜨고(버블 없음), 링크 열기는 새 탭(opener 차단)으로 연다', async ({ authenticatedPage: page }) => {
    await page.context().route(`${LINK_URL}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>spec</p>' }))
    await open(page, `[설계 문서](${LINK_URL}) 참고.`)
    await page.locator('.ProseMirror a', { hasText: '설계 문서' }).tap()

    const sheet = page.getByTestId('wiki-link-sheet')
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('wiki-link-sheet-url')).toHaveText(LINK_URL)
    await expect(page.getByTestId('wiki-link-bubble')).toBeHidden()
    // 행은 44px 이상(터치 영역).
    for (const id of ['wiki-link-sheet-open', 'wiki-link-sheet-edit', 'wiki-link-sheet-unlink']) {
      const box = (await page.getByTestId(id).boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
    }

    const popupPromise = page.context().waitForEvent('page')
    await page.getByTestId('wiki-link-sheet-open').tap()
    const popup = await popupPromise
    await popup.waitForLoadState()
    expect(popup.url()).toBe(LINK_URL)
    expect(await popup.evaluate(() => window.opener)).toBeNull()
    await popup.close()
    await expect(sheet).toHaveCount(0)
  })

  test('링크 고치기 → 주소 입력 시트(지금 주소가 채워짐, 16px)에서 바꾼 주소가 저장된다', async ({ authenticatedPage: page }) => {
    await open(page, `[설계 문서](${LINK_URL}) 참고.`)
    await page.locator('.ProseMirror a', { hasText: '설계 문서' }).tap()
    await page.getByTestId('wiki-link-sheet-edit').tap()

    const inputSheet = page.getByTestId('wiki-link-input-sheet')
    await expect(inputSheet).toBeVisible()
    await expect(inputSheet).toContainText('링크 고치기')
    const input = page.getByTestId('wiki-link-input')
    await expect(input).toHaveValue(LINK_URL)
    await expect(input).toBeFocused()
    // iOS 포커스 확대 방지 — 16px 이상, 주소 자판.
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    await expect(input).toHaveAttribute('inputmode', 'url')
    // 기존 링크 고치기라 제출 버튼도 '고치기'.
    await expect(page.getByTestId('wiki-link-apply')).toHaveText('고치기')

    // 잘못된 주소는 시트에 오류를 보이고 문서를 바꾸지 않는다.
    await input.fill('그냥글자')
    await page.getByTestId('wiki-link-apply').tap()
    await expect(page.getByTestId('wiki-link-input-error')).toBeVisible()
    await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', LINK_URL)

    await input.fill('example.com/v2')
    await page.getByTestId('wiki-link-apply').tap()
    await expect(inputSheet).toHaveCount(0)
    await expect(page.locator('.ProseMirror a')).toHaveText('설계 문서')
    await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.com/v2')
    await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('[설계 문서](https://example.com/v2) 참고.')
  })

  test('링크 해제는 글자를 남기고 링크만 푼다', async ({ authenticatedPage: page }) => {
    await open(page, `앞 [설계 문서](${LINK_URL}) 뒤`)
    await page.locator('.ProseMirror a', { hasText: '설계 문서' }).tap()
    const unlink = page.getByTestId('wiki-link-sheet-unlink')
    // 파괴적 작업 — 빨간 글자(destructive 토큰).
    await expect(unlink).toHaveClass(/text-destructive/)
    await unlink.tap()
    await expect(page.getByTestId('wiki-link-sheet')).toHaveCount(0)
    await expect(page.locator('.ProseMirror a')).toHaveCount(0)
    await expect(page.locator('.ProseMirror')).toHaveText('앞 설계 문서 뒤')
    await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('앞 설계 문서 뒤')
  })

  test('글자를 고르고 선택 툴바 🔗 를 누르면 주소 입력 시트로 링크를 건다', async ({ authenticatedPage: page }) => {
    await open(page, '자세한 내용은 설계 문서 참고.')
    // DOM 선택으로 "설계 문서" 를 고른다 — ProseMirror 는 selectionchange 로 따라간다.
    await page.locator('.ProseMirror').evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      walker.nextNode()
      const node = walker.currentNode as Text
      const i = node.data.indexOf('설계 문서')
      ;(root as HTMLElement).focus()
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + '설계 문서'.length)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    await page.getByTestId('wiki-format-tb-link').tap()
    const inputSheet = page.getByTestId('wiki-link-input-sheet')
    await expect(inputSheet).toContainText('링크 넣기')
    await expect(page.getByTestId('wiki-link-apply')).toHaveText('넣기')
    await expect(page.getByTestId('wiki-link-input-popover')).toHaveCount(0)
    await page.getByTestId('wiki-link-input').fill('example.com/spec')
    await page.getByTestId('wiki-link-apply').tap()
    await expect(inputSheet).toHaveCount(0)
    await expect(page.locator('.ProseMirror a', { hasText: '설계 문서' })).toHaveAttribute('href', LINK_URL)
    await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe(`자세한 내용은 [설계 문서](${LINK_URL}) 참고.`)
  })

  test('긴 주소는 시트에서 줄바꿈돼 전부 보이고 가로로 넘치지 않는다', async ({ authenticatedPage: page }) => {
    const long = `https://example.com/${'very-long-path-segment/'.repeat(8)}end?query=${'x'.repeat(40)}`
    await open(page, `[긴 링크](${long}) 뒤`)
    await page.locator('.ProseMirror a', { hasText: '긴 링크' }).tap()
    const url = page.getByTestId('wiki-link-sheet-url')
    await expect(url).toHaveText(long)
    const box = (await url.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    // 여러 줄로 감긴다.
    expect(box.height).toBeGreaterThan(40)
    await expectNoHorizontalOverflow(page)
  })

  test('보기 전용에선 시트 없이 링크가 그대로 새 탭으로 열린다', async ({ authenticatedPage: page }) => {
    await page.context().route(`${LINK_URL}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>spec</p>' }))
    await open(page, `[설계 문서](${LINK_URL})`, 'VIEWER')
    const popupPromise = page.context().waitForEvent('page')
    await page.locator('.ProseMirror a', { hasText: '설계 문서' }).tap()
    const popup = await popupPromise
    expect(popup.url()).toBe(LINK_URL)
    await popup.close()
    await expect(page.getByTestId('wiki-link-sheet')).toHaveCount(0)
  })
})
