// 노트 본문 마크다운 보존 E2E — 저장(마크다운 직렬화) 후 다시 열어도 내용이 그대로인지.
// WP-299: 표 셀에 멘션 칩·이미지만 있으면 저장 시 셀이 빈칸이 됐다(표 직렬화기가 텍스트 없는 셀을 건너뜀).
// WP-300: 마크다운 링크 [text](url) 가 에디터를 거치면 글자만 남았다(스키마에 link 마크 없음).
// 동기화 서버의 실시간 문서는 칩·이미지를 메모리에 들고 있어 새로고침만으론 결함이 안 보인다 — 저장본(마크다운)을
// 읽어 확인하고, 그 저장본으로 문서를 다시 시드한 뒤 열어야 "저장 후 다시 열기"가 된다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { seedCollabFor, typeAtEnd } from '../../fixtures/collab'
import { mockWikiMentions, mockWikiPageEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 330
const CONTENT_PATH = '/api/v1/wiki/attachments/7/content'
const LINK_URL = 'https://example.com/spec'

// 1x1 투명 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 노트 에디터 라우트 + 이미지 콘텐츠·멘션 해소 스텁. */
async function setup(page: Page, body: string, role: 'OWNER' | 'VIEWER' = 'OWNER') {
  await page.route(CONTENT_PATH, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await mockWikiMentions(page, PAGE_ID, [])
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '보존 확인', body, role })
}

/** 저장본으로 문서를 다시 시드하고 페이지를 다시 연다 — 실시간 문서를 버리고 마크다운에서 새로 읽게 한다. */
async function reopenFromSaved(page: Page, saved: string) {
  await seedCollabFor(page, PAGE_ID, saved)
  await page.reload()
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()
}

test('표 셀에 멘션·이미지만 있어도 저장 후 다시 열면 셀에 그대로 있다 (WP-299)', async ({ authenticatedPage: page }) => {
  const row = `| <@3> | ![](${CONTENT_PATH}) |`
  await setup(page, ['| 담당 | 사진 |', '| --- | --- |', row, '', '표 아래 문단'].join('\n'))
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()

  const cells = page.locator('.ProseMirror td')
  await expect(cells.nth(0).locator('[data-mtype="USER"]')).toBeVisible()
  await expect(cells.nth(1).getByTestId('wiki-image')).toBeVisible()

  // 다른 곳을 편집해 저장 → 저장본에 셀 내용이 남아야 한다(수정 전엔 "|  |  |").
  await typeAtEnd(page, '표 아래 문단', ' 수정')
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain('표 아래 문단 수정')
  const saved = await savedMarkdown(page, PAGE_ID)
  expect(saved).toContain(row)

  await reopenFromSaved(page, saved)
  await expect(cells.nth(0).locator('[data-mtype="USER"]')).toBeVisible()
  await expect(cells.nth(1).getByTestId('wiki-image')).toBeVisible()
})

test('마크다운 링크가 저장 후 다시 열어도 링크로 남는다 (WP-300)', async ({ authenticatedPage: page }) => {
  const linkMd = `[설계 문서](${LINK_URL})`
  await setup(page, [`자세한 내용은 ${linkMd} 참고.`, '', '편집할 문단'].join('\n'))
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()

  const link = page.locator('.ProseMirror a', { hasText: '설계 문서' })
  await expect(link).toHaveAttribute('href', LINK_URL)
  // 새 탭 + opener 차단으로 렌더된다.
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)

  await typeAtEnd(page, '편집할 문단', ' 수정')
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain('편집할 문단 수정')
  const saved = await savedMarkdown(page, PAGE_ID)
  expect(saved).toContain(linkMd)

  await reopenFromSaved(page, saved)
  await expect(link).toHaveAttribute('href', LINK_URL)

  // 소스 보기에도 링크 마크다운이 그대로 보인다.
  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByTestId('wiki-menu-source').click()
  await expect(page.getByTestId('wiki-source-dialog')).toContainText(linkMd)
})

test('편집 모드에선 Ctrl/⌘+클릭으로만 링크를 새 탭에 연다 (WP-300)', async ({ authenticatedPage: page }) => {
  // 실제 외부로 나가지 않게 새 탭 요청을 스텁한다(컨텍스트 라우트 — 새 탭에도 걸린다).
  await page.context().route(`${LINK_URL}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>spec</p>' }))
  await setup(page, `[설계 문서](${LINK_URL}) 참고.`)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()
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

test('보기 전용에선 링크를 그냥 클릭하면 새 탭(opener 차단)으로 열린다 (WP-300)', async ({ authenticatedPage: page }) => {
  await page.context().route(`${LINK_URL}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>spec</p>' }))
  await setup(page, `[설계 문서](${LINK_URL}) 참고.`, 'VIEWER')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror[contenteditable="false"]')).toBeVisible()

  const popupPromise = page.context().waitForEvent('page')
  await page.locator('.ProseMirror a', { hasText: '설계 문서' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toBe(LINK_URL)
  expect(await popup.evaluate(() => window.opener)).toBeNull()
})

test('굵게 바로 뒤 줄바꿈이 있어도 단어가 붙지 않고 저장 후에도 띄어져 있다 (WP-314)', async ({ authenticatedPage: page }) => {
  // AI·MCP 도구가 쓴 본문처럼 문단 안 소프트 줄바꿈이 마크 바로 뒤에 온다.
  await setup(page, ['**담당자**\n홍길동', '', '편집할 문단'].join('\n'))
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror[contenteditable="true"]')
  await expect(editor).toBeVisible()

  // 수정 전엔 normalizeDOM 이 줄바꿈을 지워 "담당자홍길동" 으로 붙어 보였다.
  const first = editor.locator('p').first()
  await expect(first).toHaveText('담당자 홍길동')

  await typeAtEnd(page, '편집할 문단', ' 수정')
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain('편집할 문단 수정')
  const saved = await savedMarkdown(page, PAGE_ID)
  expect(saved).toContain('**담당자** 홍길동')
  expect(saved).not.toContain('**담당자**홍길동')

  await reopenFromSaved(page, saved)
  await expect(first).toHaveText('담당자 홍길동')
})
