// 노트 링크 넣기·고치기·해제·열기 E2E — 데스크톱(WP-312).
// 선택 툴바 🔗·⌘K 로 주소 입력을 열어 링크를 걸고, 커서가 링크 안이면 뜨는 버블에서 열기·고치기·해제한다.
// 결과는 화면의 <a href> 와 동기화 서버 저장본(마크다운) 양쪽으로 확인한다. 모바일 시트는 pages/mobile/wiki-link-ui.spec.ts.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { applyCollabMarkdown, changeCollabRole, typeAtEnd } from '../../fixtures/collab'
import { mockWikiMentions, mockWikiPageEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 412
const LINK_URL = 'https://example.com/spec'

async function open(page: Page, body: string, role: 'OWNER' | 'VIEWER' = 'OWNER') {
  await mockWikiMentions(page, PAGE_ID, [])
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '링크 확인', body, role })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()
}

/** 본문에서 글자 text 를 DOM 선택으로 고른다 — ProseMirror 는 selectionchange 로 선택을 따라간다. */
async function selectText(page: Page, text: string) {
  await page.locator('.ProseMirror').evaluate((root, t) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const i = node.data.indexOf(t)
      if (i < 0) continue
      ;(root as HTMLElement).focus()
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + t.length)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      root.dispatchEvent(new Event('mouseup', { bubbles: true }))
      return
    }
    throw new Error(`본문에 "${t}" 가 없다`)
  }, text)
}

/** 링크 글자 가운데를 눌러 커서를 링크 안에 둔다. */
async function placeCaretInLink(page: Page, linkText: string) {
  await page.locator('.ProseMirror a', { hasText: linkText }).click()
}

test('선택 툴바 🔗 로 선택한 글자에 링크를 건다 — 맨 도메인은 https:// 가 붙어 저장된다', async ({ authenticatedPage: page }) => {
  await open(page, '자세한 내용은 설계 문서 참고.')
  await selectText(page, '설계 문서')
  await page.getByTestId('wiki-format-tb-link').click()

  const input = page.getByTestId('wiki-link-input')
  await expect(input).toBeFocused()
  // 입력이 열린 동안 AI 선택 툴바는 숨는다(겹치지 않게).
  await expect(page.getByTestId('wiki-ai-toolbar')).toBeHidden()
  await input.fill('example.com/spec')
  await input.press('Enter')

  await expect(page.getByTestId('wiki-link-input-popover')).toHaveCount(0)
  await expect(page.locator('.ProseMirror a', { hasText: '설계 문서' })).toHaveAttribute('href', LINK_URL)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe(`자세한 내용은 [설계 문서](${LINK_URL}) 참고.`)
})

test('⌘K/Ctrl+K — 선택이 있으면 그 글자에, 커서만 있으면 친 주소를 링크 글자로 넣고 AI 패널은 열지 않는다', async ({
  authenticatedPage: page,
}) => {
  await open(page, '첫 문단 링크대상\n\n둘째 문단')
  await selectText(page, '링크대상')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByTestId('wiki-link-input').fill('https://a.example.com')
  await page.keyboard.press('Enter')
  await expect(page.locator('.ProseMirror a', { hasText: '링크대상' })).toHaveAttribute('href', 'https://a.example.com')
  // 전역 ⌘K(AI 패널 토글)는 에디터가 먼저 쓴 키를 건너뛴다.
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)

  // 빈 선택(커서) + ⌘K → 친 주소가 그대로 링크 글자가 된다.
  const second = page.locator('.ProseMirror p', { hasText: '둘째 문단' })
  await second.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' ')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByTestId('wiki-link-input').fill('docs.example.com/x')
  await page.keyboard.press('Enter')
  await expect(second.locator('a')).toHaveText('docs.example.com/x')
  await expect(second.locator('a')).toHaveAttribute('href', 'https://docs.example.com/x')
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  // 링크 바로 뒤에서 이어 친 글자는 링크가 아니다(마크가 끝에서 이어지지 않음).
  await page.keyboard.type(' 끝')
  await expect(second.locator('a')).toHaveText('docs.example.com/x')
  await expect
    .poll(() => savedMarkdown(page, PAGE_ID))
    .toBe('첫 문단 [링크대상](https://a.example.com)\n\n둘째 문단 [docs.example.com/x](https://docs.example.com/x) 끝')

  // 에디터 밖(제목)에서의 ⌘K 는 여전히 AI 패널을 연다.
  await page.getByPlaceholder('제목 없음').click()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
})

test('넣을 수 없는 주소는 오류를 보이고 문서를 바꾸지 않으며, Esc 로 닫으면 본문으로 돌아온다', async ({
  authenticatedPage: page,
}) => {
  await open(page, '위험한 링크 시험')
  await selectText(page, '위험한')
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByTestId('wiki-link-input')
  await input.fill('javascript:alert(1)')
  await input.press('Enter')
  await expect(page.getByTestId('wiki-link-input-error')).toHaveText('올바른 링크 주소를 입력하세요')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('.ProseMirror a')).toHaveCount(0)

  // 고쳐 치면 오류가 사라진다.
  await input.fill('그냥글자')
  await expect(page.getByTestId('wiki-link-input-error')).toHaveCount(0)

  await input.press('Escape')
  await expect(page.getByTestId('wiki-link-input-popover')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expect(page.locator('.ProseMirror a')).toHaveCount(0)
  // Esc 는 입력만 닫는다 — AI 패널을 열거나 닫지 않는다.
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
})

test('커서가 링크 안이면 버블이 뜨고 ↗ 열기는 새 탭(opener 차단)으로 연다', async ({ authenticatedPage: page }) => {
  await page.context().route(`${LINK_URL}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>spec</p>' }))
  // 본문 첫 줄이 아니어야 위에 자리가 있다(첫 줄은 제목을 덮지 않게 아래로 뒤집힌다 — 아래 별도 시험).
  await open(page, `첫 줄\n\n둘째 줄\n\n셋째 줄\n\n자세한 내용은 [설계 문서](${LINK_URL}) 참고.`)
  const bubble = page.getByTestId('wiki-link-bubble')
  await expect(bubble).toHaveCount(0)

  await placeCaretInLink(page, '설계 문서')
  await expect(bubble).toBeVisible()
  await expect(page.getByTestId('wiki-link-bubble-url')).toHaveText(LINK_URL)
  // 버블은 링크 시작에 왼쪽 정렬해 바로 위에 붙는다(좌측 상단이 아니라).
  const linkBox = (await page.locator('.ProseMirror a').boundingBox())!
  const bubbleBox = (await bubble.boundingBox())!
  expect(bubbleBox.y + bubbleBox.height).toBeLessThanOrEqual(linkBox.y + 1)
  expect(Math.abs(bubbleBox.y + bubbleBox.height - linkBox.y)).toBeLessThan(40)
  expect(Math.abs(bubbleBox.x - linkBox.x)).toBeLessThan(4)

  const popupPromise = page.context().waitForEvent('page')
  await page.getByTestId('wiki-link-open').click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toBe(LINK_URL)
  expect(await popup.evaluate(() => window.opener)).toBeNull()

  // 링크 밖으로 커서를 옮기면 버블이 사라진다.
  await page.locator('.ProseMirror p').last().click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('End')
  await expect(bubble).toBeHidden()
})

test('버블 ✎ 고치기는 지금 주소를 채운 입력을 열고, 바꾼 주소가 링크 전체에 저장된다', async ({ authenticatedPage: page }) => {
  await open(page, `[설계 문서](${LINK_URL}) 참고.`)
  await placeCaretInLink(page, '설계 문서')
  await page.getByTestId('wiki-link-edit').click()
  const input = page.getByTestId('wiki-link-input')
  await expect(input).toHaveValue(LINK_URL)
  await expect(page.getByTestId('wiki-link-bubble')).toBeHidden()
  await input.fill('https://example.com/v2')
  await input.press('Enter')

  await expect(page.locator('.ProseMirror a')).toHaveCount(1)
  await expect(page.locator('.ProseMirror a')).toHaveText('설계 문서')
  await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.com/v2')
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('[설계 문서](https://example.com/v2) 참고.')
})

test('고치기 입력을 바깥 클릭으로 닫으면 버블이 포커스 없이 다시 떠 있지 않다', async ({ authenticatedPage: page }) => {
  await open(page, `[설계 문서](${LINK_URL}) 참고.`)
  await placeCaretInLink(page, '설계 문서')
  await page.getByTestId('wiki-link-edit').click()
  await expect(page.getByTestId('wiki-link-input')).toBeFocused()
  // 에디터 밖(헤더)을 누른다 — 입력은 닫히고 문서는 그대로.
  await page.getByTestId('wiki-page-header').click({ position: { x: 4, y: 4 } })
  await expect(page.getByTestId('wiki-link-input-popover')).toHaveCount(0)
  await expect(page.getByTestId('wiki-link-bubble')).toBeHidden()
  await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', LINK_URL)
})

test('버블 ⌀ 해제는 글자는 남기고 링크만 푼다', async ({ authenticatedPage: page }) => {
  await open(page, `[설계 문서](${LINK_URL}) 참고.`)
  await placeCaretInLink(page, '설계 문서')
  await page.getByTestId('wiki-link-unlink').click()
  await expect(page.locator('.ProseMirror a')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toHaveText('설계 문서 참고.')
  await expect(page.getByTestId('wiki-link-bubble')).toBeHidden()
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('설계 문서 참고.')
})

test('긴 주소는 버블에서 한 줄로 잘리고 화면을 넘지 않는다', async ({ authenticatedPage: page }) => {
  const long = `https://example.com/${'very-long-path-segment/'.repeat(12)}end?query=${'x'.repeat(40)}`
  await open(page, `[긴 링크](${long}) 뒤`)
  await placeCaretInLink(page, '긴 링크')
  const url = page.getByTestId('wiki-link-bubble-url')
  await expect(url).toBeVisible()
  await expect(url).toHaveAttribute('title', long)
  const box = (await page.getByTestId('wiki-link-bubble').boundingBox())!
  const vw = page.viewportSize()!.width
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vw)
  // 한 줄(버튼 높이 수준) — 주소가 줄바꿈돼 버블이 커지지 않는다.
  expect(box.height).toBeLessThan(48)
})

test('보기 전용은 바뀌지 않는다 — 버블·⌘K 입력 없이 클릭으로 링크가 열린다', async ({ authenticatedPage: page }) => {
  await page.context().route(`${LINK_URL}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>spec</p>' }))
  await mockWikiMentions(page, PAGE_ID, [])
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '링크 확인', body: `[설계 문서](${LINK_URL})`, role: 'VIEWER' })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="false"]')).toBeVisible()

  const popupPromise = page.context().waitForEvent('page')
  await page.locator('.ProseMirror a', { hasText: '설계 문서' }).click()
  const popup = await popupPromise
  expect(popup.url()).toBe(LINK_URL)
  await popup.close()
  await expect(page.getByTestId('wiki-link-bubble')).toHaveCount(0)
  await expect(page.getByTestId('wiki-format-tb-link')).toHaveCount(0)
})

test('본문 첫 줄 링크의 버블은 제목을 덮지 않게 아래로 뒤집히고, 본문 칼럼 밖으로 나가지 않는다', async ({ authenticatedPage: page }) => {
  const long = `https://example.com/${'very-long-path-segment/'.repeat(10)}end`
  await open(page, `[긴 링크](${long}) 를 맨 앞에 둔 첫 줄`)
  await placeCaretInLink(page, '긴 링크')
  const bubble = page.getByTestId('wiki-link-bubble')
  await expect(bubble).toBeVisible()
  const linkBox = (await page.locator('.ProseMirror a').boundingBox())!
  const bubbleBox = (await bubble.boundingBox())!
  const titleBox = (await page.getByPlaceholder('제목 없음').boundingBox())!
  const pmBox = (await page.locator('.ProseMirror').boundingBox())!
  // 아래로 뒤집힘 — 링크 밑에 붙고, 제목과 겹치지 않는다.
  expect(bubbleBox.y).toBeGreaterThanOrEqual(linkBox.y + linkBox.height - 1)
  expect(bubbleBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height)
  // 가로로 본문 칼럼 안(왼쪽 사이드바로 삐져나가지 않음).
  expect(bubbleBox.x).toBeGreaterThanOrEqual(pmBox.x - 1)
  expect(bubbleBox.x + bubbleBox.width).toBeLessThanOrEqual(pmBox.x + pmBox.width + 1)
})

test('링크 바로 뒤(경계) 커서의 ⌘K 는 옆 링크를 고치지 않고 새 링크를 넣는다', async ({ authenticatedPage: page }) => {
  await open(page, `[설계 문서](${LINK_URL})`)
  // 본문은 클릭·End 의 선택을 비동기로 읽는다 — 버블이 떴다(링크 안) 사라지는 것으로 커서가 경계에 닿았음을 확인한 뒤 ⌘K.
  const bubble = page.getByTestId('wiki-link-bubble')
  await placeCaretInLink(page, '설계 문서')
  await expect(bubble).toBeVisible()
  await page.keyboard.press('End')
  // 경계는 링크 안이 아니다 — 버블이 사라진다.
  await expect(bubble).toBeHidden()
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByTestId('wiki-link-input')
  await expect(input).toHaveValue('')
  await expect(page.getByTestId('wiki-link-apply')).toHaveText('넣기')
  await input.fill('b.example.com')
  await input.press('Enter')
  await expect(page.locator('.ProseMirror a')).toHaveCount(2)
  await expect(page.locator('.ProseMirror a').first()).toHaveAttribute('href', LINK_URL)
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe(`[설계 문서](${LINK_URL})[b.example.com](https://b.example.com)`)
})

test('고치기 입력의 제출 버튼은 "고치기", 새로 넣기는 "넣기"', async ({ authenticatedPage: page }) => {
  await open(page, `[설계 문서](${LINK_URL}) 새 글자`)
  await placeCaretInLink(page, '설계 문서')
  await page.getByTestId('wiki-link-edit').click()
  await expect(page.getByTestId('wiki-link-apply')).toHaveText('고치기')
  await page.keyboard.press('Escape')
  // Esc 는 다음 프레임에 본문 포커스·이전 선택을 되돌린다 — 그 뒤에 새로 골라야 되돌림이 선택을 덮지 않는다.
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await selectText(page, '새 글자')
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByTestId('wiki-link-apply')).toHaveText('넣기')
})

test('키보드 — Alt+F10 으로 버블에 들어가 Tab 으로 옮기고, 포커스가 버블에 있어도 버블은 남으며 Esc 로 본문에 돌아간다', async ({
  authenticatedPage: page,
}) => {
  await open(page, `앞 [설계 문서](${LINK_URL}) 뒤`)
  await placeCaretInLink(page, '설계 문서')
  const bubble = page.getByTestId('wiki-link-bubble')
  await expect(bubble).toBeVisible()

  await page.keyboard.press('Alt+F10')
  await expect(page.getByTestId('wiki-link-open')).toBeFocused()
  await expect(bubble).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('wiki-link-edit')).toBeFocused()
  await expect(bubble).toBeVisible()

  // Esc → 본문으로, 버블은 커서가 링크 안이라 계속 뜬다.
  await page.keyboard.press('Escape')
  await expect(page.locator('.ProseMirror')).toBeFocused()
  await expect(bubble).toBeVisible()

  // 키보드로 해제까지.
  await page.keyboard.press('Alt+F10')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('wiki-link-unlink')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.ProseMirror a')).toHaveCount(0)
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('앞 설계 문서 뒤')
})

test('키보드 — 버블의 고치기를 Enter 로 누르면 지금 주소가 채워진 입력이 열린다', async ({ authenticatedPage: page }) => {
  await open(page, `[설계 문서](${LINK_URL}) 뒤`)
  await placeCaretInLink(page, '설계 문서')
  // 클릭의 선택 반영은 비동기(selectionchange)라 버블이 뜬 뒤에 키를 누른다 — 버블이 없으면 Alt+F10 은 아무 일도 하지 않고
  // Tab 이 에디터 밖(AI 런처)으로 나가 Enter 가 엉뚱한 버튼을 누른다.
  await expect(page.getByTestId('wiki-link-bubble')).toBeVisible()
  await page.keyboard.press('Alt+F10')
  await expect(page.getByTestId('wiki-link-open')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('wiki-link-edit')).toBeFocused()
  await page.keyboard.press('Enter')
  const input = page.getByTestId('wiki-link-input')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(LINK_URL)
})

test('입력이 열린 동안 보기 권한으로 강등되면 입력이 닫히고 문서는 그대로다', async ({ authenticatedPage: page, collabNs }) => {
  await open(page, '강등 시험 대상 글자')
  await selectText(page, '대상')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByTestId('wiki-link-input').fill('example.com')
  await changeCollabRole(collabNs, PAGE_ID, 'VIEWER')
  await expect(page.locator('.ProseMirror[contenteditable="false"]')).toBeVisible()
  await expect(page.getByTestId('wiki-link-input-popover')).toHaveCount(0)
  await expect(page.locator('.ProseMirror a')).toHaveCount(0)
  expect(await savedMarkdown(page, PAGE_ID)).toBe('강등 시험 대상 글자')
})

test('걸 글자를 다른 사람이 지웠으면 주소를 글자로 넣지 않고 알린 뒤 닫는다', async ({ authenticatedPage: page, collabNs }) => {
  await open(page, '지워질 대상\n\n남는 문단')
  await selectText(page, '대상')
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByTestId('wiki-link-input')
  await input.fill('example.com')
  // 다른 곳(서버 적용)에서 대상 문단을 지운다.
  await applyCollabMarkdown(collabNs, PAGE_ID, { body: '남는 문단' })
  await expect(page.locator('.ProseMirror')).toHaveText('남는 문단')
  await input.press('Enter')
  await expect(page.getByText('링크를 걸 글자가 다른 사람의 편집으로 지워졌어요')).toBeVisible()
  await expect(page.getByTestId('wiki-link-input-popover')).toHaveCount(0)
  await expect(page.locator('.ProseMirror a')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toHaveText('남는 문단')
  expect(await savedMarkdown(page, PAGE_ID)).toBe('남는 문단')
})

test('주소를 치는 동안 다른 사람이 선택 바로 뒤에 친 글자는 링크에 끌려 들어가지 않는다', async ({
  authenticatedPage: a,
  newAuthedPage,
}) => {
  await open(a, '링크대상\n\n둘째')
  const b = await newAuthedPage()
  await mockWikiMentions(b, PAGE_ID, [])
  await mockWikiPageEditor(b, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '링크 확인', body: '', seed: false })
  await b.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(b.locator('.ProseMirror')).toContainText('링크대상')

  await selectText(a, '링크대상')
  await a.keyboard.press('ControlOrMeta+k')
  const input = a.getByTestId('wiki-link-input')
  await input.fill('example.com')
  await typeAtEnd(b, '링크대상', ' 추가')
  await expect(a.locator('.ProseMirror p').first()).toHaveText('링크대상 추가')
  await input.press('Enter')
  await expect(a.locator('.ProseMirror a')).toHaveText('링크대상')
  await expect.poll(() => savedMarkdown(a, PAGE_ID)).toBe('[링크대상](https://example.com) 추가\n\n둘째')
})

test('이미지(노드) 선택에서의 ⌘K 는 링크 입력 대신 전역 AI 패널로 넘어간다', async ({ authenticatedPage: page }) => {
  const content = '/api/v1/wiki/attachments/7/content'
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.route(content, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: png }))
  await open(page, `앞 문단\n\n![그림](${content})\n\n뒤 문단`)
  await page.getByTestId('wiki-image').click()
  await expect(page.locator('.ProseMirror .ProseMirror-selectednode')).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expect(page.getByTestId('wiki-link-input-popover')).toHaveCount(0)
})

test('문단 끝에서 다음 문단 맨 앞까지 고른 선택은 앞 문단 글자에만 링크가 걸린다(원격 편집이 있어도)', async ({
  authenticatedPage: a,
  newAuthedPage,
}) => {
  await open(a, '첫 문단 대상\n\n둘째 문단')
  const b = await newAuthedPage()
  await mockWikiMentions(b, PAGE_ID, [])
  await mockWikiPageEditor(b, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '링크 확인', body: '', seed: false })
  await b.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(b.locator('.ProseMirror')).toContainText('둘째 문단')

  // "대상" 부터 둘째 문단 맨 앞(오프셋 0)까지 DOM 선택.
  await a.locator('.ProseMirror').evaluate((root) => {
    const [p1, p2] = Array.from(root.querySelectorAll('p'))
    const t1 = p1.firstChild as Text
    ;(root as HTMLElement).focus()
    const range = document.createRange()
    range.setStart(t1, t1.data.indexOf('대상'))
    range.setEnd(p2.firstChild as Text, 0)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  })
  await a.keyboard.press('ControlOrMeta+k')
  const input = a.getByTestId('wiki-link-input')
  await input.fill('example.com')
  await typeAtEnd(b, '둘째 문단', ' 추가')
  await expect(a.locator('.ProseMirror p').nth(1)).toHaveText('둘째 문단 추가')
  await input.press('Enter')
  await expect(a.locator('.ProseMirror a')).toHaveCount(1)
  await expect(a.locator('.ProseMirror a')).toHaveText('대상')
  await expect.poll(() => savedMarkdown(a, PAGE_ID)).toBe('첫 문단 [대상](https://example.com)\n\n둘째 문단 추가')
})

test('해제는 커서가 든 링크만 푼다 — 맞닿은 다른 주소 링크는 남는다', async ({ authenticatedPage: page }) => {
  await open(page, '[AAAA](https://a.example.com)[BBBB](https://b.example.com) 끝')
  await placeCaretInLink(page, 'AAAA')
  await expect(page.getByTestId('wiki-link-bubble-url')).toHaveText('https://a.example.com')
  await page.getByTestId('wiki-link-unlink').click()
  await expect(page.locator('.ProseMirror a')).toHaveCount(1)
  await expect(page.locator('.ProseMirror a')).toHaveText('BBBB')
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('AAAA[BBBB](https://b.example.com) 끝')
})

test('커서 자리 넣기 중 그 문단이 지워지면 예전 위치에 주소를 넣지 않고 알린 뒤 닫는다', async ({ authenticatedPage: page, collabNs }) => {
  await open(page, '지워질 문단\n\n남는 문단')
  await page.locator('.ProseMirror p', { hasText: '지워질 문단' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByTestId('wiki-link-input')
  await expect(page.getByTestId('wiki-link-apply')).toHaveText('넣기')
  await input.fill('example.com')
  await applyCollabMarkdown(collabNs, PAGE_ID, { body: '남는 문단' })
  await expect(page.locator('.ProseMirror')).toHaveText('남는 문단')
  await input.press('Enter')
  await expect(page.getByText('링크를 걸 글자가 다른 사람의 편집으로 지워졌어요')).toBeVisible()
  await expect(page.getByTestId('wiki-link-input-popover')).toHaveCount(0)
  await expect(page.locator('.ProseMirror a')).toHaveCount(0)
  expect(await savedMarkdown(page, PAGE_ID)).toBe('남는 문단')
})
