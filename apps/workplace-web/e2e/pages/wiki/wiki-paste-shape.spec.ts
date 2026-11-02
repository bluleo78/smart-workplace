// 노트 밖 HTML 붙여넣기 「모양 유지」와 붙여넣기 칩(WP-1306) — 웹 페이지 조각을 실제 브라우저 복사(⌘C)·붙여넣기(⌘V)로 옮겨, 페이지 CSS 로 칠한
// 카드가 상자로·색 글자가 서식 span 으로 들어오고, 칩 「글만」이 붙인 범위만 글로 바꾸며, 이어 치면 칩이 닫히고, ⌘Z 한 번에 붙여넣기가
// 사라지는지. 브라우저가 페이지 CSS 를 인라인 style 로 옮겨 싣는 복사·실제 붙여넣기 키·떠 있는 칩 누르기가 핵심이라 실제 브라우저로 본다(@input).
// 거를 목록·조각 변환·칩 상태 규칙은 src/components/wiki/wikiPasteForeign.test.ts·wikiPasteChip.test.ts 가 지킨다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { caretAtEnd, envShot } from '../../fixtures/collab'
import { mockWikiPageEditor, openWikiEditor, savedMarkdown } from '../../fixtures/wiki-mock'

/** 시각 검증 스크린샷 — PASTE_SHOTS(절대 경로)가 있을 때만 남긴다. */
const shot = (page: Page, name: string) => envShot(page, 'PASTE_SHOTS', name)

/**
 * 노트 화면 밖에 「웹 페이지」 조각을 띄우고 통째로 골라 ⌘C 로 복사한다. 모양은 전역 <style> 의 class 규칙으로만 칠한다 —
 * 브라우저가 복사할 때 규칙 결과를 인라인 style 로 옮겨 싣는지(Chrome interchange 직렬화)가 이 기능의 전제다.
 */
async function copyWebFragment(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = [
      '.wp1306-page{position:fixed;left:0;bottom:0;z-index:1;background:#fff;color:#212529;font-family:Georgia,serif;font-size:17px;padding:4px}',
      '.wp1306-card{background-color:#dbeafe;border:1px solid #93c5fd;border-radius:12px;padding:16px;margin:0 0 12px;font-size:15px}',
      '.wp1306-red{color:#dc2626}',
    ].join('\n')
    const host = document.createElement('div')
    host.className = 'wp1306-page'
    host.innerHTML =
      '<div class="wp1306-card"><p>카드 <span class="wp1306-red">빨강</span> 글</p></div><p>바깥 글</p>'
    document.head.appendChild(style)
    document.body.appendChild(host)
    const range = document.createRange()
    range.selectNodeContents(host)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  })
  await page.keyboard.press('ControlOrMeta+C')
}

/** 본문 노트를 편집기로 연다. */
async function openNote(page: Page, pageId: number, body: string) {
  await mockWikiPageEditor(page, { spaceId: 1, pageId, title: '붙여넣기 노트', body, role: 'EDITOR' })
  await openWikiEditor(page, { spaceId: 1, pageId })
}

test.describe('노트 밖 HTML 붙여넣기 모양 유지 (WP-1306)', { tag: '@input' }, () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  test('웹 페이지 카드를 붙이면 상자·색 글자로 들어오고 칩이 뜬다 — 「글만」을 누르면 글만 남고, 「모양 유지」로 돌아온다', async ({ authenticatedPage: page }) => {
    const pageId = 1306
    await openNote(page, pageId, '앞 문단')
    await copyWebFragment(page)
    await caretAtEnd(page, '앞 문단')
    await page.keyboard.press('Enter')
    await page.keyboard.press('ControlOrMeta+V')

    const editor = page.locator('.ProseMirror')
    const box = editor.locator('[data-wiki-html-box]')
    await expect(box).toHaveCount(1)
    await expect(box).toHaveCSS('background-color', 'rgb(219, 234, 254)')
    await expect(box).toHaveCSS('border-top-left-radius', '12px')
    await expect(box.locator('[data-wiki-html-span]')).toHaveText('빨강')
    await expect(box.locator('[data-wiki-html-span]')).toHaveCSS('color', 'rgb(220, 38, 38)')
    // 바깥 페이지의 글꼴·크기는 들어오지 않는다(노트 본문 글꼴 그대로).
    const bodyFont = await editor.locator('p', { hasText: '앞 문단' }).evaluate((el) => getComputedStyle(el).fontFamily)
    await expect(editor.locator('p', { hasText: '바깥 글' })).toHaveCSS('font-family', bodyFont)

    const chip = page.getByTestId('wiki-paste-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('붙여 넣었습니다')
    await expect(page.getByTestId('wiki-paste-shape')).toHaveAttribute('aria-pressed', 'true')
    await shot(page, 'paste-chip-shape')
    await expect.poll(() => savedMarkdown(page, pageId)).toContain('<div style="background-color: rgb(219, 234, 254)')

    await page.getByTestId('wiki-paste-plain').click()
    await expect(box).toHaveCount(0)
    await expect(editor.locator('[data-wiki-html-span]')).toHaveCount(0)
    await expect(editor.locator('p', { hasText: '카드 빨강 글' })).toBeVisible()
    await expect(page.getByTestId('wiki-paste-plain')).toHaveAttribute('aria-pressed', 'true')
    await shot(page, 'paste-chip-plain')
    await expect.poll(() => savedMarkdown(page, pageId)).toBe('앞 문단\n\n카드 빨강 글\n\n바깥 글')

    await page.getByTestId('wiki-paste-shape').click()
    await expect(box).toHaveCount(1)
    await expect(page.getByTestId('wiki-paste-shape')).toHaveAttribute('aria-pressed', 'true')
  })

  test('붙인 뒤 이어 치면 칩이 닫히고, ⌘Z 한 번에 붙여넣기가 통째로 사라진다', async ({ authenticatedPage: page }) => {
    const pageId = 1307
    await openNote(page, pageId, '앞 문단')
    await copyWebFragment(page)
    await caretAtEnd(page, '앞 문단')
    await page.keyboard.press('Enter')
    await page.keyboard.press('ControlOrMeta+V')
    const chip = page.getByTestId('wiki-paste-chip')
    await expect(chip).toBeVisible()
    await page.keyboard.type('뒤')
    await expect(chip).toBeHidden()

    // 이어 친 글자 한 번, 붙여넣기 한 번 — 각각 실행 취소 한 단계다.
    const editor = page.locator('.ProseMirror')
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(editor.locator('[data-wiki-html-box]')).toHaveCount(1)
    await expect(editor).not.toContainText('바깥 글뒤')
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(editor.locator('[data-wiki-html-box]')).toHaveCount(0)
    await expect(editor).not.toContainText('카드')
    await expect(editor).not.toContainText('바깥 글')
    await expect(editor).toContainText('앞 문단')
  })

  test('Esc 를 누르면 칩만 닫히고 붙인 모양은 그대로다', async ({ authenticatedPage: page }) => {
    const pageId = 1308
    await openNote(page, pageId, '앞 문단')
    await copyWebFragment(page)
    await caretAtEnd(page, '앞 문단')
    await page.keyboard.press('Enter')
    await page.keyboard.press('ControlOrMeta+V')
    await expect(page.getByTestId('wiki-paste-chip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('wiki-paste-chip')).toBeHidden()
    await expect(page.locator('.ProseMirror [data-wiki-html-box]')).toHaveCount(1)
  })
})
