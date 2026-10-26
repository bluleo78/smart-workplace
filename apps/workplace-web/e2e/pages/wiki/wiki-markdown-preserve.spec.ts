// 노트 본문 링크의 브라우저 동작 E2E (WP-300) — 편집 모드 Ctrl/⌘+클릭, 보기 전용 클릭이 새 탭(opener 차단)으로 열리는지.
// 저장(마크다운 직렬화) 왕복 보존 — 표 셀의 멘션·이미지(WP-299), 링크(WP-300), 마크 뒤 소프트 줄바꿈(WP-314) — 은 동기화 서버와 같은
// 공용 스키마의 markdownToDoc/docToMarkdown 이 맡으므로 packages/wiki-editor-schema 의 단위 테스트
// (wikiTableNonTextCell·wikiLink·softbreakAfterMark)가 검증한다(WP-409).
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiMentions, mockWikiPageEditor, openWikiEditor } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 330
const LINK_URL = 'https://example.com/spec'

/** 노트 에디터 라우트 + 멘션 해소 스텁. */
async function setup(page: Page, body: string) {
  await mockWikiMentions(page, PAGE_ID, [])
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '보존 확인', body })
}

test('편집 모드에선 Ctrl/⌘+클릭으로만 링크를 새 탭에 연다 (WP-300)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  // 실제 외부로 나가지 않게 새 탭 요청을 스텁한다(컨텍스트 라우트 — 새 탭에도 걸린다).
  await page.context().route(`${LINK_URL}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>spec</p>' }))
  await setup(page, `[설계 문서](${LINK_URL}) 참고.`)
  await openWikiEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID })
  const link = page.locator('.ProseMirror a', { hasText: '설계 문서' })

  // 그냥 클릭은 링크 글자 편집용 커서 배치 — 새 탭이 뜨지 않는다.
  let opened = 0
  page.context().on('page', () => opened++)
  await link.click()
  await expect(page.locator('.ProseMirror')).toBeFocused()
  expect(opened).toBe(0)

  const popupPromise = page.context().waitForEvent('page')
  await link.click({ modifiers: ['ControlOrMeta'] })
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toBe(LINK_URL)
  // noopener — 열린 탭이 이 탭을 조작할 수 없다.
  expect(await popup.evaluate(() => window.opener)).toBeNull()
  expect(opened).toBe(1)
})

// 보기 전용에서 그냥 클릭하면 새 탭(opener 차단)으로 열리는지는 wiki-link-ui.spec.ts 「보기 전용은 바뀌지 않는다…」가 맡는다.
