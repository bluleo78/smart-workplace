// 노트 제목 줄바꿈 E2E (WP-315 데스크톱·WP-317 모바일) — 본문 위 제목 입력란이 긴 제목을 글자 중간에서 자르지 않고
// 여러 줄로 감싸 끝까지 보여야 한다. 제목 값은 여전히 한 줄이다: 붙여넣은 개행은 공백이 되고, Enter 는 본문 이동,
// 한글 조합 중 Enter 는 글자 확정만 한다. 폭이 바뀌거나 다른 곳에서 제목이 바뀌면 높이를 다시 맞춘다.
// 시각 검증 스크린샷은 WIKI_TITLE_SHOTS(절대 경로)가 있을 때만 남긴다.
import type { Locator, Page } from '@playwright/test'
import path from 'node:path'

import { wikiPageDetail } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { envShot, leaveAllCollabPeers } from '../../fixtures/collab'
import { mockGatedEvents } from '../../fixtures/gatedEvents'
import { pressMacChromeImeEnter } from '../../fixtures/ime'
import { expectStays, resizeAndSettle } from '../../fixtures/wait'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 315
const pagePath = `/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`
// 실데이터 길이 — 47자 넘는 한글 제목 + 띄어쓰기 없는 긴 영문 토큰(어디서든 끊겨야 하는 경우).
const LONG_KO = '2026년 하반기 제품 로드맵 검토 회의록 및 분기별 실행 계획과 담당자별 후속 조치 정리'
const LONG_EN = 'SmartWorkplaceRealtimeCollaborativeEditingSynchronizationArchitectureDecisionRecord'
const LONG_TITLE = `${LONG_KO} ${LONG_EN}`
// pageTitleClass 의 한 줄 높이(leading-[36px]).
const LINE_PX = 36

test.afterEach(() => leaveAllCollabPeers())

const titleField = (page: Page) => page.getByPlaceholder('제목 없음')

/** 제목 입력란 크기 — 가로로 넘치거나(잘림) 세로로 넘치면(내부 스크롤) 안 된다. */
const fieldMetrics = (field: Locator) =>
  field.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))

/** 긴 제목이 잘리지 않고 여러 줄로 다 보이는지 — 그리고 아래 본문과 겹치지 않는지. */
async function expectWrappedWhole(page: Page) {
  const field = titleField(page)
  await expect(field).toHaveValue(LONG_TITLE)
  const m = await fieldMetrics(field)
  expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth)
  expect(m.scrollHeight).toBeLessThanOrEqual(m.clientHeight)
  expect(m.clientHeight).toBeGreaterThanOrEqual(LINE_PX * 2)
  const titleBox = await field.boundingBox()
  const bodyBox = await page.locator('.ProseMirror').boundingBox()
  expect(titleBox && bodyBox && titleBox.y + titleBox.height <= bodyBox.y).toBe(true)
}

async function openNote(page: Page, title: string) {
  const puts = await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title, body: '본문 첫 문단' })
  await page.goto(pagePath)
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()
  return puts
}

test.describe('데스크톱 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('긴 제목이 글자 중간에서 잘리지 않고 여러 줄로 감겨 다 보인다', async ({ authenticatedPage: page }) => {
    await openNote(page, LONG_TITLE)
    await expect(page.getByTestId('mobile-shell')).toHaveCount(0)
    await expectWrappedWhole(page)
  })

  test('붙여넣은 개행은 공백 하나가 되고 커서는 붙여넣은 자리 뒤에 남으며 한 줄 제목으로 저장된다', async ({
    authenticatedPage: page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const puts = await openNote(page, '앞뒤')
    const field = titleField(page)
    await field.click()
    await field.press('End')
    await field.press('ArrowLeft')
    await page.evaluate(() => navigator.clipboard.writeText('가\n나'))
    await field.press('ControlOrMeta+V')
    await expect(field).toHaveValue('앞가 나뒤')
    // 커서가 끝으로 튀지 않았는지 — 이어 친 글자가 붙여넣은 자리 바로 뒤에 들어가야 한다.
    await page.keyboard.type('!')
    await expect(field).toHaveValue('앞가 나!뒤')
    await field.blur()
    await expect.poll(() => puts.lastBody<{ title: string }>()?.title).toBe('앞가 나!뒤')
  })

  test('한글 조합 중 Enter 는 글자 확정만 하고 본문으로 옮기지 않는다', async ({ authenticatedPage: page }) => {
    await openNote(page, '회의록')
    const field = titleField(page)
    await field.click()
    // 조합 중 Enter keydown(isComposing) — IME 가 실제로 보내는 형태를 그대로 디스패치한다.
    await field.evaluate((el) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })),
    )
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('회의록')
    // 조합이 아닌 Enter 는 그대로 본문으로 옮긴다.
    await field.press('Enter')
    await expect(page.locator('.ProseMirror')).toBeFocused()
    await expect(field).toHaveValue('회의록')
  })

  test('macOS Chrome 한글 IME — 조합 Enter 뒤 compositionend 와 함께 오는 조합 아닌 Enter 한 번도 본문으로 옮기지 않는다', async ({
    authenticatedPage: page,
  }) => {
    await openNote(page, '회의록')
    const field = titleField(page)
    await field.click()
    await pressMacChromeImeEnter(field, '록')
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('회의록')
    // 무시는 한 번뿐 — 이어 누른 Enter 는 본문으로 옮긴다.
    await field.press('Enter')
    await expect(page.locator('.ProseMirror')).toBeFocused()
  })

  test('개행이 든 채 저장된 제목(API·MCP)도 한 줄로 보이고, 열기만 해서는 저장하지 않는다', async ({ authenticatedPage: page }) => {
    const puts = await openNote(page, '첫 줄\r\n둘째 줄\n셋째 줄')
    const field = titleField(page)
    await expect(field).toHaveValue('첫 줄 둘째 줄 셋째 줄')
    expect((await fieldMetrics(field)).clientHeight).toBe(LINE_PX)
    await field.click()
    await field.blur()
    await expectStays(page, () => puts.count(), 0)
  })

  test('다른 곳에서 제목이 길게 바뀌면 새로고침 없이 높이가 늘어 다 보인다', async ({ authenticatedPage: page }) => {
    const events = await mockGatedEvents(page)
    await openNote(page, '짧은 제목')
    const field = titleField(page)
    expect((await fieldMetrics(field)).clientHeight).toBe(LINE_PX)

    // 서버 제목을 긴 제목으로 바꾼다 — 나중에 등록한 라우트가 이긴다.
    await page.route(
      (u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`,
      (r) =>
        r.request().method() === 'GET'
          ? r.fulfill({
              json: wikiPageDetail({
                id: PAGE_ID, spaceId: SPACE_ID, title: LONG_TITLE, body: '본문 첫 문단', version: 2, updatedBy: 2, updatedAt: '2026-06-01T00:00:00Z',
              }),
            })
          : r.fallback(),
    )
    events.deliver(
      `event: wiki.page.updated\ndata: ${JSON.stringify({ spaceId: SPACE_ID, pageId: PAGE_ID, title: LONG_TITLE, actorId: 2 })}\n\n`,
    )
    await expectWrappedWhole(page)
  })
})

test.describe('모바일 390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('긴 제목이 글자 중간에서 잘리지 않고 여러 줄로 감겨 다 보인다', async ({ authenticatedPage: page }) => {
    await openNote(page, LONG_TITLE)
    await expect(page.getByTestId('mobile-shell')).toHaveCount(1)
    await expectWrappedWhole(page)
  })

  test('창 폭이 바뀌면 줄 수에 맞게 높이를 다시 맞춘다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 900, height: 844 })
    await openNote(page, LONG_TITLE)
    await expect(page.getByTestId('mobile-shell')).toHaveCount(1)
    const field = titleField(page)
    const wide = (await fieldMetrics(field)).clientHeight

    await resizeAndSettle(page, { width: 390, height: 844 })
    await expect.poll(async () => (await fieldMetrics(field)).clientHeight).toBeGreaterThan(wide)
    await expectWrappedWhole(page)

    // 다시 넓히면 줄어든다(늘기만 하고 안 줄면 빈 줄이 남는다).
    await resizeAndSettle(page, { width: 900, height: 844 })
    await expect.poll(async () => (await fieldMetrics(field)).clientHeight).toBe(wide)
  })
})

// 시각 검증 스크린샷 — 데스크톱·모바일 × 라이트·다크. 평소 회귀 실행에선 건너뛴다.
test.describe('시각 검증', () => {
  test.skip(!process.env.WIKI_TITLE_SHOTS, '시각 검증 스크린샷 전용 — WIKI_TITLE_SHOTS 가 있을 때만')

  for (const [tag, viewport] of [
    ['desktop-1440', { width: 1440, height: 900 }],
    ['mobile-390', { width: 390, height: 844 }],
  ] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${tag} ${scheme}`, async ({ authenticatedPage: page }) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme: scheme })
        await openNote(page, LONG_TITLE)
        await expectWrappedWhole(page)
        await envShot(page, 'WIKI_TITLE_SHOTS', `${tag}-${scheme}-01-view`)
        // 제목 끝에 커서를 둔 편집 상태 — 캐럿 위치·포커스 표시 확인.
        const field = titleField(page)
        await field.click()
        // 끝으로 이동 — 맥의 Cmd+End 는 textarea 끝으로 가지 않아 선택 범위를 직접 둔다.
        await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length))
        // 커서가 마지막 줄 끝에 있고, 안쪽 스크롤로 첫 줄이 가려지지 않았는지.
        expect(
          await field.evaluate((el: HTMLTextAreaElement) => [el.selectionStart === el.value.length, el.scrollTop]),
        ).toEqual([true, 0])
        // 캐럿이 보이게 찍는다(기본 screenshot 은 캐럿을 숨긴다).
        await page.screenshot({ path: path.join(process.env.WIKI_TITLE_SHOTS!, `${tag}-${scheme}-02-caret-end.png`), caret: 'initial' })
      })
    }
  }
})
