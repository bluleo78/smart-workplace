// 노트 에디터 마크다운 붙여넣기 E2E (#753) — transformPastedText 미설정으로 '## 제목' 이
// 평문으로 들어가던 결함을 막는다. text/plain 만 실어야 변환 경로를 탄다(text/html 이 함께
// 있으면 ProseMirror 가 HTML 파싱으로 분기한다 — parseFromClipboard 의 asText 조건).
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiPageEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 310

const setup = (page: Page, body: string) =>
  mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '붙여넣기', body })

/**
 * text/plain 만 담은 paste 이벤트를 에디터에 디스패치한다.
 * ProseMirror 는 DOM 이벤트를 직접 듣기 때문에 contenteditable 에서 bubbles:true 로 쏴야 하고,
 * 선택(selection)이 잡혀 있어야 삽입 위치가 정해진다 → 호출 전 반드시 클릭으로 포커스를 준다.
 */
async function pastePlainText(page: Page, text: string) {
  await page.locator('.ProseMirror').evaluate((el, t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

test('스파이크 — 합성 paste 가 마크다운으로 변환된다', async ({ authenticatedPage: page }) => {
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, '## 붙여넣은 제목')

  await expect(page.locator('.ProseMirror h2')).toHaveText('붙여넣은 제목')
})

test('마크다운 블록이 서식으로 변환되고 저장본으로 왕복한다', async ({ authenticatedPage: page }) => {
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, [
    '## 분기 지표',
    '',
    '- 첫째',
    '- 둘째',
    '',
    '| 항목 | 값 |',
    '| --- | --- |',
    '| 활성 사용자 | 1,850 |',
  ].join('\n'))

  // 1) 블록 요소로 렌더되는가
  const ed = page.locator('.ProseMirror')
  await expect(ed.locator('h2')).toHaveText('분기 지표')
  await expect(ed.locator('ul > li')).toHaveCount(2)
  await expect(ed.locator('ul > li').first()).toHaveText('첫째')
  await expect(ed.locator('table th')).toHaveCount(2)
  await expect(ed.locator('table td').first()).toHaveText('활성 사용자')

  // 2) 동기화 저장본(WP-172)이 마크다운으로 되돌아가는가 — 라운드트립 무손실. 붙여넣기는 한 번의 편집이라
  // 표까지 들어오면 나머지 블록도 함께 저장돼 있다.
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain('| 활성 사용자 |')
  const body = await savedMarkdown(page, PAGE_ID)
  expect(body).toContain('## 분기 지표')
  expect(body).toContain('- 첫째')
})

// 주의: 이 테스트는 `transformPastedText` 스위치를 꺼도(되돌려도) 그대로 통과한다 — 그 기능
// 자체의 회귀는 잡지 못한다는 뜻이다. 이 테스트가 실제로 지키는 것은 ProseMirror 의 "코드블록
// 예외 분기"(selection 이 codeBlock 안이면 clipboardTextParser/변환 훅 호출 전에 평문으로
// 단락시키는 동작)다. 즉 코드블록 안까지 마크다운 변환이 침범하는 회귀를 잡는 테스트이며,
// 메인 스위치(마크다운 붙여넣기 변환 자체)를 지키는 것은 나머지 3건이다.
test('코드블록 예외 — 코드블록 안에서는 평문으로 남는다', async ({ authenticatedPage: page }) => {
  // 코드블록이 이미 있는 본문에서 시작 — ProseMirror 가 inCode 를 clipboardTextParser 호출
  // 전에 단락시키는지 확인한다(별도 handlePaste 를 짜지 않은 근거).
  await setup(page, '```\n기존 코드\n```')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror pre code')).toBeVisible()

  // 코드블록 안을 클릭하면 selection 의 parent 가 codeBlock 이 되고, 그것만으로 inCode 가 성립한다.
  await page.locator('.ProseMirror pre code').click()
  await pastePlainText(page, '\n## 제목은 아니다')

  await expect(page.locator('.ProseMirror pre code')).toContainText('## 제목은 아니다')
  await expect(page.locator('.ProseMirror h2')).toHaveCount(0)
})

test('평문 HTML 은 렌더된다 (수용된 동작 고정)', async ({ authenticatedPage: page }) => {
  // 의도적으로 이 동작을 고정한다. markdown-it 의 html:true 때문에 평문 HTML 이 렌더되는데,
  // 이를 Markdown.configure({html:false}) 로 "고치면" 기존 페이지에 raw HTML 로 저장된 표(#742
  // 폴백 경로)의 로드가 깨진다. 즉 버그가 아니라 감수한 트레이드오프다 — 이 테스트가 깨지면
  // 스펙 §3.4 를 먼저 읽을 것.
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, '<b>굵게</b>')

  await expect(page.locator('.ProseMirror strong')).toHaveText('굵게')
})

test('마크다운 링크를 붙여넣으면 링크로 들어가고 저장본에 그대로 남는다 (WP-300)', async ({ authenticatedPage: page }) => {
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, '참고: [설계 문서](https://example.com/spec)')

  await expect(page.locator('.ProseMirror a', { hasText: '설계 문서' })).toHaveAttribute('href', 'https://example.com/spec')
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain('참고: [설계 문서](https://example.com/spec)')
})

test('맨 URL 을 붙여넣으면 자동 링크가 되지 않고 글자로 남는다 (WP-300)', async ({ authenticatedPage: page }) => {
  // 링크 마크를 들이면서 저장 마크다운이 `<url>` 로 바뀌지 않게 자동 링크(autolink·붙여넣기 규칙)를 껐다.
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, 'https://example.com/plain')

  await expect(page.locator('.ProseMirror p')).toHaveText('https://example.com/plain')
  await expect(page.locator('.ProseMirror a')).toHaveCount(0)
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('https://example.com/plain')
})

test('HTML 로 붙여넣은 링크의 공백 든 주소가 인코딩돼 링크로 저장된다 (WP-300)', async ({ authenticatedPage: page }) => {
  // 브라우저에서 복사한 링크(text/html)는 markdown-it 을 거치지 않아 주소가 정규화되지 않았다 — 공백이 그대로면
  // 저장본의 [t](a b) 가 링크 문법이 아니라 다음에 열 때 평문이 된다.
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.locator('.ProseMirror').evaluate((el) => {
    const dt = new DataTransfer()
    dt.setData('text/html', '<a href="https://example.com/my doc">내 문서</a>')
    dt.setData('text/plain', '내 문서')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })

  await expect(page.locator('.ProseMirror a', { hasText: '내 문서' })).toHaveAttribute('href', 'https://example.com/my%20doc')
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('[내 문서](https://example.com/my%20doc)')
})

// WP-314 — 여러 줄 붙여넣기는 줄마다 줄바꿈(hardBreak)으로 남아야 한다. 굵게 바로 뒤 줄바꿈도 마찬가지다.
// 소프트 줄바꿈을 공백으로 바꾸던 첫 수정은 '첫 줄\n둘째 줄' 을 한 줄로 접었고, 수정 전 main 은 굵게 뒤 줄이 붙었다.
test('여러 줄과 굵게 뒤 줄바꿈이 붙여넣기 후에도 줄바꿈으로 남는다 (WP-314)', async ({ authenticatedPage: page }) => {
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await pastePlainText(page, ['첫 줄', '둘째 줄', '**담당자**', '홍길동'].join('\n'))

  const p = page.locator('.ProseMirror p').first()
  await expect(p.locator('br')).toHaveCount(3)
  await expect(p).toHaveText('첫 줄둘째 줄담당자홍길동')
  await expect(p.locator('strong')).toHaveText('담당자')

  // 저장본에도 하드 브레이크로 남는다.
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain('홍길동')
  expect(await savedMarkdown(page, PAGE_ID)).toContain('첫 줄\\\n둘째 줄\\\n**담당자**\\\n홍길동')
})
