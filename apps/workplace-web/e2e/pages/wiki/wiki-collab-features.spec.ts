// 노트 동시 편집 회귀(WP-296, 스펙 §8) — 다른 사람(B)이 위쪽을 고치는 동안 A 가 기존 편집 기능을 써도 그대로 동작하고,
// 결과가 양쪽 화면과 서버 문서(= 저장될 노트 본문)에 같게 남는지 본다. 원격 변경은 y-prosemirror 가 문서 전체 교체 트랜잭션으로
// 반영하므로 열린 팝오버·툴바와 커서 기반 명령이 가장 깨지기 쉽다 — 그 사이에 B 의 입력을 끼워 넣는다.
// 단일 컨텍스트 동작은 wiki-table*·wiki-markdown-*·wiki-ai(서식) spec 이 지킨다.
import { readFile } from 'node:fs/promises'

import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { readCollabMarkdown, typeAtEnd } from '../../fixtures/collab'
import { expectStays } from '../../fixtures/wait'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const pagePath = (pageId: number) => `/wiki/spaces/${SPACE_ID}/pages/${pageId}`
const syncStatus = (page: Page) => page.getByTestId('wiki-sync-status')

/** 같은 노트를 A·B 두 컨텍스트로 연다 — 시드는 A 만(다시 시드하면 서버가 문서를 닫아 A 가 끊긴다). */
async function openBoth(
  a: Page,
  newAuthedPage: () => Promise<Page>,
  pageId: number,
  body: string,
): Promise<Page> {
  const opts = { spaceId: SPACE_ID, pageId, title: '동시 편집', body }
  await mockWikiPageEditor(a, opts)
  const b = await newAuthedPage()
  await mockWikiPageEditor(b, { ...opts, seed: false })
  await a.goto(pagePath(pageId))
  await b.goto(pagePath(pageId))
  for (const p of [a, b]) {
    await expect(syncStatus(p)).toHaveAttribute('data-status', 'live')
    await expect(p.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()
  }
  return b
}

/** B 가 맨 위 문단에 입력하고, 그 입력이 A 화면에 도착할 때까지 기다린다 — A 의 열린 UI 위로 원격 변경을 끼워 넣는다. */
async function remoteEditAbove(a: Page, b: Page, text: string) {
  await typeAtEnd(b, '맨 위', text)
  await expect(a.locator('.ProseMirror')).toContainText(`맨 위${text}`)
}

const TABLE_MD = ['| 항목 | 담당 |', '| --- | --- |', '| API 설계 | 김 |', '| 배포 | 이 |'].join('\n')

test.describe('동시 편집 중 기존 편집 기능', () => {
  test('표 툴바 — 위쪽 원격 입력 뒤에도 툴바가 표에 붙어 있고, 열 추가가 양쪽·저장본에 반영된다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const b = await openBoth(a, newAuthedPage, 51, `맨 위\n\n${TABLE_MD}`)
    await a.locator('.ProseMirror td').first().click()
    const toolbar = a.getByTestId('wiki-table-toolbar')
    await expect(toolbar).toBeVisible()

    const table = a.locator('.ProseMirror table')
    const yBefore = (await table.boundingBox())!.y
    // B 가 표 위에 문단을 하나 더 만든다 — 표가 실제로 아래로 밀려야 툴바가 따라오는지 볼 수 있다.
    await typeAtEnd(b, '맨 위', ' B')
    await b.keyboard.press('Enter')
    await b.keyboard.type('새 줄 B')
    await expect(a.locator('.ProseMirror p', { hasText: '새 줄 B' })).toBeVisible()
    await expect.poll(async () => (await table.boundingBox())!.y).toBeGreaterThan(yBefore + 10)
    // 원격 입력으로 표가 아래로 밀려도 툴바는 표 상단에 그대로 붙는다 — tippy placement:'top' 기본 간격(10px) 안팎.
    await expect(toolbar).toBeVisible()
    await expect.poll(async () => {
      const tableBox = (await table.boundingBox())!
      const barBox = (await toolbar.boundingBox())!
      const gap = tableBox.y - (barBox.y + barBox.height)
      return gap >= 0 && gap <= 16
    }).toBe(true)

    await toolbar.getByTestId('wiki-table-cmd-addColumnAfter').click()
    for (const p of [a, b]) {
      await expect(p.locator('.ProseMirror table th')).toHaveCount(3)
      // 첫 열 셀에서 '오른쪽에 열 삽입' — 새 빈 열은 1열 바로 뒤에 들어간다.
      await expect(p.locator('.ProseMirror table tr').nth(1).locator('td')).toHaveText(['API 설계', '', '김'])
    }
    // 문서 끝 표 뒤의 마지막 '\n' 은 공용 표 직렬화기 계약(wikiTableNonTextCell.test 왕복 기대값과 같다).
    await expect.poll(() => readCollabMarkdown(collabNs, 51)).toBe(
      ['맨 위 B', '', '새 줄 B', '', '| 항목 |  | 담당 |', '| --- | --- | --- |', '| API 설계 |  | 김 |', '| 배포 |  | 이 |'].join('\n') + '\n',
    )
  })

  test('표 단축키 — 같은 표의 다른 셀을 상대가 고치는 중에도 Ctrl+Alt+↓ 행 추가가 양쪽에 반영되고 상대 입력도 남는다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const b = await openBoth(a, newAuthedPage, 52, `맨 위\n\n${TABLE_MD}`)
    // 글자를 하나 쳐서 A 의 커서를 'API 설계' 셀 끝에 확정한다(클릭만으론 selectionchange 가 비동기).
    await typeAtEnd(a, 'API 설계', '.')
    const apiCell = a.locator('.ProseMirror td').first()
    await expect(apiCell).toHaveText('API 설계.')
    await typeAtEnd(b, '배포', ' B')
    await expect(a.locator('.ProseMirror')).toContainText('배포 B')

    // 원격 변경 뒤에도 A 의 커서가 그 셀에 남았는지 — 다시 누르지 않고 그대로 쳐서 글자가 떨어진 자리를 본 뒤 지운다.
    await a.keyboard.type('!')
    await expect(apiCell).toHaveText('API 설계.!')
    await a.keyboard.press('Backspace')
    await a.keyboard.press('Backspace')
    await expect(apiCell).toHaveText('API 설계')

    await a.keyboard.press('Control+Alt+ArrowDown')
    for (const p of [a, b]) {
      await expect(p.locator('.ProseMirror table tr')).toHaveCount(4)
      // 새 행은 'API 설계' 행 바로 아래 — 그 행은 그대로, 상대가 고친 행은 한 칸 밀린다.
      const rows = p.locator('.ProseMirror table tr')
      await expect(rows.nth(1).locator('td')).toHaveText(['API 설계', '김'])
      await expect(rows.nth(2).locator('td')).toHaveText(['', ''])
      await expect(rows.nth(3).locator('td')).toHaveText(['배포 B', '이'])
    }
    await expect.poll(() => readCollabMarkdown(collabNs, 52)).toBe(
      ['맨 위', '', '| 항목 | 담당 |', '| --- | --- |', '| API 설계 | 김 |', '|  |  |', '| 배포 B | 이 |'].join('\n') + '\n',
    )
  })

  test('병합 셀 표(HTML 폴백) — 두 사람이 각자 다른 셀을 고쳐도 병합이 유지되고 HTML 로 저장된다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const html =
      '<table><tbody><tr><th colspan="2"><p>병합 머리</p></th></tr><tr><td><p>왼쪽칸</p></td><td><p>오른쪽칸</p></td></tr></tbody></table>'
    const b = await openBoth(a, newAuthedPage, 53, `맨 위\n\n${html}`)
    await expect(a.locator('.ProseMirror th[colspan="2"]')).toHaveCount(1)

    await typeAtEnd(a, '왼쪽칸', ' A')
    await typeAtEnd(b, '오른쪽칸', ' B')
    for (const p of [a, b]) {
      await expect(p.locator('.ProseMirror')).toContainText('왼쪽칸 A')
      await expect(p.locator('.ProseMirror')).toContainText('오른쪽칸 B')
      await expect(p.locator('.ProseMirror th[colspan="2"]')).toHaveCount(1)
    }
    await expect.poll(() => readCollabMarkdown(collabNs, 53)).toContain('<p>오른쪽칸 B</p>')
    const md = await readCollabMarkdown(collabNs, 53)
    expect(md).toContain('colspan="2"')
    expect(md).toContain('<p>왼쪽칸 A</p>')
    // GFM 파이프 표로 바뀌면 병합이 사라진다.
    expect(md).not.toContain('| --- |')
  })

  test('슬래시 메뉴 — 열려 있는 동안 위쪽 원격 입력이 와도 닫히지 않고, 고른 블록이 내 자리에 적용된다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const b = await openBoth(a, newAuthedPage, 54, '맨 위\n\n마지막 문단')
    // 클릭만으론 커서가 확정되지 않는다(selectionchange 비동기) — 글자를 하나 쳐서 확정한 뒤 줄을 바꾼다.
    await typeAtEnd(a, '마지막 문단', '.')
    await a.keyboard.press('Enter')
    await a.keyboard.type('/')
    const popover = a.getByTestId('wiki-slash-popover')
    await expect(popover).toBeVisible()

    await remoteEditAbove(a, b, ' B')
    await expect(popover).toBeVisible()

    await a.getByTestId('wiki-slash-option-heading2').click()
    await a.keyboard.type('새 제목')
    for (const p of [a, b]) await expect(p.locator('.ProseMirror h2')).toHaveText('새 제목')
    await expect.poll(() => readCollabMarkdown(collabNs, 54)).toBe('맨 위 B\n\n마지막 문단.\n\n## 새 제목')
  })

  test('버블 툴바 — 글을 고른 채 위쪽 원격 입력이 와도 툴바가 남고, 굵게가 고른 글자에만 적용된다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const b = await openBoth(a, newAuthedPage, 55, '맨 위\n\n굵게 대상\n\n그대로 문단')
    const target = a.locator('.ProseMirror p', { hasText: '굵게 대상' })
    await target.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      el.dispatchEvent(new Event('mouseup', { bubbles: true }))
    })
    const toolbar = a.getByTestId('wiki-ai-toolbar')
    await expect(toolbar).toBeVisible()

    await remoteEditAbove(a, b, ' B')
    await expect(toolbar).toBeVisible()

    await a.getByTestId('wiki-format-tb-bold').click()
    for (const p of [a, b]) await expect(p.locator('.ProseMirror strong')).toHaveText('굵게 대상')
    await expect.poll(() => readCollabMarkdown(collabNs, 55)).toBe('맨 위 B\n\n**굵게 대상**\n\n그대로 문단')
  })

  test('마크다운 붙여넣기 — 상대가 다른 문단을 치는 중에 붙여 넣어도 서식으로 바뀌어 양쪽에 들어가고 상대 입력도 남는다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const b = await openBoth(a, newAuthedPage, 56, '맨 위\n\n붙일 자리')
    await typeAtEnd(a, '붙일 자리', '.')
    await a.keyboard.press('Enter')
    await remoteEditAbove(a, b, ' B')
    await a.locator('.ProseMirror').evaluate((el, t) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', t)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, ['## 분기 지표', '', '- 첫째', '- 둘째', '', '| 항목 | 값 |', '| --- | --- |', '| 활성 | 1,850 |'].join('\n'))

    for (const p of [a, b]) {
      await expect(p.locator('.ProseMirror h2')).toHaveText('분기 지표')
      await expect(p.locator('.ProseMirror ul > li')).toHaveCount(2)
      await expect(p.locator('.ProseMirror table td').first()).toHaveText('활성')
    }
    await expect.poll(() => readCollabMarkdown(collabNs, 56)).toBe(
      ['맨 위 B', '', '붙일 자리.', '', '## 분기 지표', '', '- 첫째', '- 둘째', '', '| 항목 | 값 |', '| --- | --- |', '| 활성 | 1,850 |'].join('\n') + '\n',
    )
  })

  test('소스 보기·내보내기 — 상대가 방금 친 내용까지 현재 문서 그대로 보이고 .md 로 받아진다', async ({
    authenticatedPage: a,
    newAuthedPage,
  }) => {
    const b = await openBoth(a, newAuthedPage, 57, `# 문서 제목\n\n맨 위\n\n${TABLE_MD}`)
    await remoteEditAbove(a, b, ' 상대가 방금 친 문장')

    await a.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
    await a.getByTestId('wiki-menu-source').click()
    await expect(a.getByTestId('wiki-source-dialog')).toBeVisible()
    const src = await a.getByTestId('wiki-source-pre').innerText()
    expect(src).toContain('맨 위 상대가 방금 친 문장')
    expect(src).toContain('| API 설계 | 김 |')

    const [download] = await Promise.all([a.waitForEvent('download'), a.getByTestId('wiki-source-download').click()])
    const file = await readFile((await download.path())!, 'utf8')
    expect(file).toContain('맨 위 상대가 방금 친 문장')
    expect(file).toContain('| API 설계 | 김 |')
    // 대화상자를 연 뒤 들어온 원격 입력은 열린 대화상자를 바꾸지 않는다(스냅숏) — 다시 열면 보인다.
    await typeAtEnd(b, '맨 위 상대가 방금 친 문장', '!')
    // 원격 입력이 A 문서에 도착한 뒤(양성 사건)부터 대화상자가 그대로인지 지켜본다 — 도착 전이면 부재 확인이 공허하다.
    await expect(a.locator('.ProseMirror')).toContainText('문장!')
    await expectStays(a, async () => (await a.getByTestId('wiki-source-pre').innerText()).includes('문장!'), false, { ms: 500 })
    await a.keyboard.press('Escape')
    await expect(a.getByTestId('wiki-source-dialog')).toBeHidden()
    await a.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
    await a.getByTestId('wiki-menu-source').click()
    await expect(a.getByTestId('wiki-source-pre')).toContainText('맨 위 상대가 방금 친 문장!')
  })
})
