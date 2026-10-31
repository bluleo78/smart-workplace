// HTML 파일 넣기(WP-1241) — 슬래시 「HTML 파일 넣기」가 실제 파일 선택기를 열고, 고른 .html 을 변환해 커서 자리에 모양째 넣는지(@input — OS 파일 선택기·
// 슬래시 팝업 클릭·편집기 포커스는 jsdom 이 흉내 내지 못한다). 변환 규칙·왕복은 src/components/wiki/wikiHtmlImport.test.ts,
// 「HTML 파일로 새 노트」 메뉴는 src/pages/wiki/wikiSidebar.test.tsx 가 지킨다. 편집기는 동기화 테스트 서버(mockWikiPageEditor)로 띄운다.
import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiPageEditor, openWikiEditor, savedMarkdown } from '../../fixtures/wiki-mock'

// 카드 보고서 아티팩트 — 페이지 스타일·카드(모양 영역)·배지(인라인 모양)·분석 스크립트(버려진다). CDN 은 E2E 네트워크 격리로 닿지 않아 쓰지 않는다.
const REPORT = `<!doctype html>
<html><head><title>카드 보고서</title>
<style>.card{border:2px solid rgb(99, 102, 241);border-radius:12px;padding:12px}.badge{color:rgb(22, 101, 52)}</style>
</head><body>
<h2>요약</h2>
<div class="card"><p>매출 증가 <span class="badge">+18%</span></p></div>
<script>window.dataLayer=[]</script>
</body></html>`

test.describe('노트 HTML 파일 넣기 (WP-1241)', () => {
  test('슬래시 「HTML 파일 넣기」 → 파일 선택 → 모양째 들어가고 글자는 바로 고칠 수 있다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const spaceId = 1
    const pageId = 71
    await mockWikiPageEditor(page, { spaceId, pageId, title: 'HTML 넣기', body: '앞 문단', role: 'EDITOR' })
    await openWikiEditor(page, { spaceId, pageId })

    // 앞 문단 끝에서 새 줄을 열고 슬래시 메뉴를 띄운다.
    // 동기화된 본문(앞 문단)이 그려진 뒤에 누른다 — 그 전에 누르면 커서가 동기화로 바뀐 문서의 맨 앞에 남는다.
    const first = page.locator('.ProseMirror p').first()
    await expect(first).toHaveText('앞 문단')
    await expect(page.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'live')
    // 커서를 앞 문단 끝에 둔다 — 부하 때 첫 동기화 직후 선택이 문서 맨 앞으로 다시 잡히는 일이 있어, 끝에 놓였는지 확인하며 다시 시도한다.
    await expect(async () => {
      await first.click()
      await page.keyboard.press('End')
      const atEnd = await page.evaluate(() => {
        const sel = window.getSelection()
        return sel?.anchorNode?.textContent === '앞 문단' && sel.anchorOffset === '앞 문단'.length
      })
      expect(atEnd).toBe(true)
    }).toPass({ timeout: 10_000 })
    // End 로 옮긴 DOM 선택을 ProseMirror 가 selectionchange(다음 작업)로 읽기 전에 Enter 를 누르면 예전 선택(맨 앞)에서 줄이 나뉜다
    // — 부하 때만 드러났다. 두 프레임을 넘겨 그 이벤트가 처리된 뒤 누른다.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()
    // 트리거가 앞 문단 다음 줄에 들어갔는지 — 넣을 자리가 맞는지 먼저 고정한다.
    await expect(page.locator('.ProseMirror p')).toHaveText(['앞 문단', '/'])

    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('wiki-slash-option-htmlImport').click()])
    expect(chooser.isMultiple()).toBe(false)
    await chooser.setFiles({ name: 'report.html', mimeType: 'text/html', buffer: Buffer.from(REPORT) })

    // 카드는 모양 영역으로, 페이지 스타일이 본문 범위에 적용돼 원본 테두리·배지 색으로 보인다.
    const card = page.locator('.ProseMirror [data-wiki-html-box].card')
    await expect(card).toBeVisible()
    await expect(card).toHaveCSS('border-top-width', '2px')
    await expect(card).toHaveCSS('border-top-color', 'rgb(99, 102, 241)')
    await expect(card.locator('[data-wiki-html-span].badge')).toHaveCSS('color', 'rgb(22, 101, 52)')
    await expect(page.locator('.ProseMirror h2')).toHaveText('요약')
    // 트리거 「/」 는 남지 않는다.
    await expect(page.locator('.ProseMirror')).not.toContainText('/')

    // 카드 안 글자는 일반 노트 글자 — 이어 쳐도 카드 안에 들어간다.
    await card.locator('p').click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' 확인')
    await expect(card.locator('p')).toHaveText('매출 증가 +18% 확인')

    // 저장 형식 — 페이지 스타일·모양 영역·인라인 모양이 그대로이고, 스크립트(분석 조각)는 들어가지 않는다.
    await expect
      .poll(() => savedMarkdown(page, pageId))
      .toContain('<div class="card">\n\n매출 증가 <span class="badge">+18%</span> 확인\n\n</div>')
    // 기존 노트에 넣었으므로 들여온 CSS 는 범위 class(wp-import-…) 아래로만 걸리고, 들여온 본문은 그 범위 영역 안이다 — 앞 문단은 범위 밖 그대로.
    const saved = await savedMarkdown(page, pageId)
    const scope = /<div class="(wp-import-[a-z0-9]{6})">/.exec(saved)?.[1]
    expect(scope).toBeTruthy()
    expect(saved).toContain(
      `<style data-wp-style>\n.${scope} .card {border:2px solid rgb(99, 102, 241);border-radius:12px;padding:12px}.${scope} .badge {color:rgb(22, 101, 52)}\n</style>`,
    )
    expect(saved, JSON.stringify(saved.slice(0, 400))).toMatch(/^앞 문단\n\n/)
    expect(saved).not.toContain('dataLayer')
  })
})
