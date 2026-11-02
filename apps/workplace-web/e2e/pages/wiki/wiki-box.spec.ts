// 노트 「상자」(WP-1303) — 슬래시 「상자」·「상자로 감싸기」로 만들고, 상자 테두리·여백을 눌러 통째 선택하면 상자 막대(꾸미기·↑/↓ 줄 추가·
// 글만 남기기·삭제)가 뜨며, 통째 선택 키(Enter·↓·↑·Esc·Backspace)로 상자 밖으로 오가는지. 여백 누르기가 어느 노드에 떨어지는지·실제 키가
// 숨은 선택을 어떻게 지나는지·떠 있는 막대 단추 누르기가 핵심이라 실제 브라우저로 본다(@input). 동시 편집 중 막대 유지는 동기화 테스트 서버로(@platform).
// 상자 명령·키 규칙의 문서 결과·동시 편집 병합 판정은 src/components/wiki/wikiBox.test.ts 가 지킨다.
import type { Locator, Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { caretAtEnd, envShot, readCollabMarkdown, typeAtEnd } from '../../fixtures/collab'
import { mockWikiPageEditor, openWikiEditor, openWikiEditors, savedMarkdown } from '../../fixtures/wiki-mock'

/** 상자 통째 선택 표시 — 상자는 NodeView 없이 그려져 ProseMirror 가 상자 요소 자신에 붙인다. */
const SELECTED = /\bProseMirror-selectednode\b/
/** 새 상자의 「기본」 모양(wikiBox.ts BOX_BASIC_STYLE) — 저장본에 이 style 로 남는다. */
const BASIC_STYLE = 'border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 12px 16px'
/** 시각 검증 스크린샷 — BOX_SHOTS(절대 경로)가 있을 때만 남긴다. */
const shot = (page: Page, name: string) => envShot(page, 'BOX_SHOTS', name)

/** 상자 위쪽 안쪽 여백을 누른다 — 안 글이 아니라 상자 요소 자신에 떨어지는 자리. */
async function clickTopPadding(page: Page, box: Locator) {
  const r = (await box.boundingBox())!
  await page.mouse.click(r.x + 40, r.y + 4)
}

/** 본문 노트를 편집기로 연다. */
async function openNote(page: Page, pageId: number, body: string) {
  await mockWikiPageEditor(page, { spaceId: 1, pageId, title: '상자 노트', body, role: 'EDITOR' })
  await openWikiEditor(page, { spaceId: 1, pageId })
}

const CARD = ['<div class="card" style="padding:8px">', '', '카드 글', '', '</div>'].join('\n')

test.describe('노트 상자 (WP-1303)', { tag: '@input' }, () => {
  test('슬래시 「상자」로 빈 상자를 넣으면 커서가 상자 안에 있고, 끝 빈 줄 Enter 로 상자 밖에 나간다', async ({ authenticatedPage: page }) => {
    const pageId = 81
    await openNote(page, pageId, '앞 문단')
    await caretAtEnd(page, '앞 문단')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    const popover = page.getByTestId('wiki-slash-popover')
    // 삽입 묶음 순서 — 표 · 이미지 · 상자 · HTML 블록.
    await expect(popover.getByRole('option').first()).toHaveText('표')
    await expect(popover.getByRole('option').nth(2)).toHaveText('상자')
    await expect(popover.getByRole('option').nth(3)).toHaveText('HTML 블록')
    await shot(page, 'slash-menu-box')
    await page.getByTestId('wiki-slash-option-box').click()

    const box = page.locator('.ProseMirror [data-wiki-html-box]')
    await expect(box).toHaveCount(1)
    // 「기본」 모양 — 옅은 테두리·둥근 모서리·안쪽 여백.
    await expect(box).toHaveCSS('border-radius', '8px')
    await expect(box).toHaveCSS('padding-top', '12px')
    await page.keyboard.type('상자 안 글')
    await expect(box).toHaveText('상자 안 글')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('밖 글')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('밖 글')
    await expect(box.locator('p')).toHaveCount(1)
    await expect
      .poll(() => savedMarkdown(page, pageId))
      .toContain([`<div style="${BASIC_STYLE}">`, '', '상자 안 글', '', '</div>', '', '밖 글'].join('\n'))
  })

  test('글을 고르고 「상자로 감싸기」를 누르면 고른 블록이 상자로 감싸지고 상자 막대가 뜬다', async ({ authenticatedPage: page }) => {
    const pageId = 82
    await openNote(page, pageId, '첫 줄\n\n둘째 줄\n\n셋째 줄')
    // 첫 줄부터 둘째 줄까지 고른다 — 고른 범위가 닿은 블록이 감싸진다. Home·End 는 쓰지 않는다(macOS Chromium 에서는 줄이 아니라 문서 끝까지 고른다).
    await page.locator('.ProseMirror p', { hasText: '첫 줄' }).click()
    await page.keyboard.press('Shift+ArrowDown')
    await page.getByTestId('wiki-format-tb-box').click()

    const box = page.locator('.ProseMirror [data-wiki-html-box]')
    await expect(box.locator('p')).toHaveText(['첫 줄', '둘째 줄'])
    await expect(box).toHaveClass(SELECTED)
    await expect(page.getByTestId('wiki-box-toolbar')).toBeVisible()
    await expect(page.locator('.ProseMirror > p')).toHaveText(['셋째 줄'])
    await shot(page, 'box-wrapped-basic')
    await expect.poll(() => savedMarkdown(page, pageId)).toContain([`<div style="${BASIC_STYLE}">`, '', '첫 줄', '', '둘째 줄', '', '</div>'].join('\n'))
  })

  test('들여온 카드도 위 여백을 누르면 통째 선택돼 상자 막대가 뜨고, 안 글을 누르면 보통 글 편집이다', async ({ authenticatedPage: page }) => {
    await openNote(page, 83, `앞 문단\n\n${CARD}\n\n뒤 문단`)
    const card = page.locator('.ProseMirror [data-wiki-html-box]')
    const toolbar = page.getByTestId('wiki-box-toolbar')
    await clickTopPadding(page, card)
    await expect(card).toHaveClass(SELECTED)
    await expect(toolbar).toBeVisible()
    // 상자 막대는 상자 바로 위에 붙는다.
    const [bar, rect] = [(await toolbar.boundingBox())!, (await card.boundingBox())!]
    expect(bar.y + bar.height).toBeLessThanOrEqual(rect.y + 1)
    // 막대 단추 — 꾸미기(WP-1304)·줄 추가·글만 남기기·삭제.
    await expect(toolbar.getByTestId('wiki-box-style')).toBeEnabled()
    await expect(toolbar.getByRole('button')).toHaveText(['꾸미기', '↑ 줄 추가', '↓ 줄 추가', '글만 남기기', '삭제'])
    await shot(page, 'box-selected-toolbar')

    // 안 글을 누르면 통째 선택이 풀리고 그 자리에 글을 쓴다.
    await card.locator('p').click()
    await expect(card).not.toHaveClass(SELECTED)
    await expect(toolbar).toBeHidden()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect(card).toHaveText('카드 글!')
  })

  test('상자 막대 — ↑ 줄 추가·↓ 줄 추가는 상자 밖 바로 위·아래에 새 줄을 만들고, 글만 남기기는 모양을 떼고, 삭제는 상자째 지운다', async ({
    authenticatedPage: page,
  }) => {
    const pageId = 84
    await openNote(page, pageId, `앞 문단\n\n${CARD}\n\n뒤 문단`)
    const card = page.locator('.ProseMirror [data-wiki-html-box]')
    const toolbar = page.getByTestId('wiki-box-toolbar')
    const top = page.locator('.ProseMirror > p')

    await clickTopPadding(page, card)
    await toolbar.getByTestId('wiki-box-line-above').click()
    await page.keyboard.type('위 새 줄')
    await expect(top).toHaveText(['앞 문단', '위 새 줄', '뒤 문단'])

    await clickTopPadding(page, card)
    await toolbar.getByTestId('wiki-box-line-below').click()
    await page.keyboard.type('아래 새 줄')
    await expect(top).toHaveText(['앞 문단', '위 새 줄', '아래 새 줄', '뒤 문단'])
    await expect(card).toHaveText('카드 글')

    await clickTopPadding(page, card)
    await toolbar.getByTestId('wiki-box-unwrap').click()
    await expect(card).toHaveCount(0)
    await expect(top).toHaveText(['앞 문단', '위 새 줄', '카드 글', '아래 새 줄', '뒤 문단'])
    await expect.poll(() => savedMarkdown(page, pageId)).toContain('위 새 줄\n\n카드 글\n\n아래 새 줄')

    // 삭제 — 새 상자를 감싸 만든 뒤 지운다.
    await page.locator('.ProseMirror p', { hasText: '카드 글' }).dblclick()
    await page.getByTestId('wiki-format-tb-box').click()
    await expect(card).toHaveClass(SELECTED)
    await toolbar.getByTestId('wiki-box-delete').click()
    await expect(card).toHaveCount(0)
    await expect(top).toHaveText(['앞 문단', '위 새 줄', '아래 새 줄', '뒤 문단'])
  })

  // WP-1304 — 꾸미기 창은 떠 있는 막대 안에서 열려 실제 누르기가 편집기 포커스·상자 통째 선택을 지키는지, 고른 모양이 테마 변수까지 풀려
  // 그려지는지(jsdom 은 CSS 변수를 풀지 못한다)를 본다. 항목별 style 계산·실행 취소·CSS 직접 고치기 정리는 WikiBoxStylePanel.test.tsx.
  test('상자 꾸미기 — 「꾸미기」로 막대 아래에 창이 열리고, 모양·여백을 누르면 상자가 바로 바뀌며 Esc 로 창만 닫힌다', async ({
    authenticatedPage: page,
  }) => {
    const pageId = 87
    await openNote(page, pageId, `앞 문단\n\n${CARD}\n\n뒤 문단`)
    const card = page.locator('.ProseMirror [data-wiki-html-box]')
    const toolbar = page.getByTestId('wiki-box-toolbar')
    await clickTopPadding(page, card)
    await toolbar.getByTestId('wiki-box-style').click()
    const panel = page.getByTestId('wiki-box-style-panel')
    await expect(panel).toBeVisible()
    // 창은 막대 아래에 붙는다.
    const [bar, box] = [(await toolbar.boundingBox())!, (await panel.boundingBox())!]
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)

    // 「안내」 — 옅은 파랑 바탕·둥근 모서리. 바탕은 --wiki-box-info-bg 를 거쳐 디자인 토큰 --info-subtle 로 풀린다(wiki-editor.css 별칭 —
    // 앱 화면에서는 내보낸 HTML 용 기본값 #eff6ff 가 아니라 토큰 색). 상자 선택·막대는 그대로다.
    await panel.getByTestId('wiki-box-style-preset-info').click()
    const infoSubtle = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--info-subtle)'
      document.body.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    })
    expect(infoSubtle).not.toBe('rgba(0, 0, 0, 0)')
    await expect(card).toHaveCSS('background-color', infoSubtle)
    await expect(card).toHaveCSS('border-radius', '8px')
    await expect(card).toHaveClass(SELECTED)
    await expect(panel.getByTestId('wiki-box-style-preset-info')).toHaveAttribute('aria-pressed', 'true')
    await panel.getByTestId('wiki-box-style-padding-wide').click()
    await expect(card).toHaveCSS('padding-top', '20px')
    await shot(page, 'box-style-panel')

    // Esc — 창만 닫고 상자 통째 선택·막대는 남는다.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(card).toHaveClass(SELECTED)
    await expect(toolbar).toBeVisible()
    await expect
      .poll(() => savedMarkdown(page, pageId))
      .toContain('<div class="card" style="background: var(--wiki-box-info-bg, #eff6ff); color: var(--wiki-box-info-fg, #1e40af);')
  })

  test('통째 선택 키 — Enter·↓ 다음 줄, ↑ 앞 줄, Esc 는 안 글 → 상자 → 바깥 줄, Backspace 는 상자 지우기', async ({ authenticatedPage: page }) => {
    const pageId = 85
    await openNote(page, pageId, `앞 문단\n\n${CARD}`)
    const card = page.locator('.ProseMirror [data-wiki-html-box]')
    const top = page.locator('.ProseMirror > p')

    // 노트 끝 상자 — Enter 는 상자 아래 새 줄.
    await clickTopPadding(page, card)
    await page.keyboard.press('Enter')
    await page.keyboard.type('아래')
    await expect(top).toHaveText(['앞 문단', '아래'])

    // ↑ 는 앞 줄, ↓ 는 다음 줄(이미 있는 줄로 옮긴다 — 새로 만들지 않는다).
    await clickTopPadding(page, card)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('!')
    await expect(top.first()).toHaveText('앞 문단!')
    await clickTopPadding(page, card)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('?')
    await expect(top).toHaveText(['앞 문단!', '?아래'])

    // Esc — 안 글에서 상자 통째 선택으로, 한 번 더면 상자 밖 옆 줄로.
    await caretAtEnd(page, '카드 글')
    await page.keyboard.press('Escape')
    await expect(card).toHaveClass(SELECTED)
    await expect(page.getByTestId('wiki-box-toolbar')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card).not.toHaveClass(SELECTED)
    await page.keyboard.type('#')
    await expect(top).toHaveText(['앞 문단!', '#?아래'])

    // 통째 선택된 상자에 글자를 치면 상자는 그대로 두고 다음 줄에 들어간다.
    await clickTopPadding(page, card)
    await page.keyboard.type('ab')
    await expect(card).toHaveText('카드 글')
    await expect(top).toHaveText(['앞 문단!', 'ab#?아래'])

    // Backspace 는 상자를 지운다.
    await clickTopPadding(page, card)
    await page.keyboard.press('Backspace')
    await expect(card).toHaveCount(0)
    await expect.poll(() => savedMarkdown(page, pageId)).not.toContain('card')
  })
})

test.describe('노트 상자 동시 편집 (WP-1303)', { tag: '@platform' }, () => {
  test('A 가 상자를 통째 선택한 채 B 가 상자 안·밖을 고쳐도 A 의 막대가 남고, A 가 이어 고친 결과가 양쪽·서버에 같다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const pageId = 86
    const opts = { spaceId: 1, pageId, title: '상자 동시 편집', body: `맨 위\n\n${CARD}\n\n맨 아래` }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage()
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await openWikiEditors(1, pageId, [a, b])
    for (const p of [a, b]) await expect(p.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'live')

    const card = a.locator('.ProseMirror [data-wiki-html-box]')
    await clickTopPadding(a, card)
    await expect(card).toHaveClass(SELECTED)

    // B 가 상자 안 글과 상자 밖 글을 고친다.
    await typeAtEnd(b, '카드 글', ' B')
    await typeAtEnd(b, '맨 위', ' 위B')
    await expect(card).toHaveText('카드 글 B')
    await expect(a.locator('.ProseMirror > p').first()).toHaveText('맨 위 위B')
    // A 의 통째 선택·막대는 그대로다.
    await expect(card).toHaveClass(SELECTED)
    await expect(a.getByTestId('wiki-box-toolbar')).toBeVisible()

    // A 가 상자 아래 줄을 넣어 쓰는 동안 B 는 상자 안을 더 고친다.
    await a.getByTestId('wiki-box-line-below').click()
    await a.keyboard.type('A 새 줄')
    await typeAtEnd(b, '카드 글 B', '2')
    const expected = ['맨 위 위B', '카드 글 B2', 'A 새 줄', '맨 아래']
    for (const p of [a, b]) {
      await expect(p.locator('.ProseMirror [data-wiki-html-box]')).toHaveText('카드 글 B2')
      await expect(p.locator('.ProseMirror > p')).toHaveText([expected[0], expected[2], expected[3]])
    }
    await expect
      .poll(() => readCollabMarkdown(collabNs, pageId))
      .toBe(['맨 위 위B', '', '<div class="card" style="padding:8px">', '', '카드 글 B2', '', '</div>', '', 'A 새 줄', '', '맨 아래'].join('\n'))
  })
})
