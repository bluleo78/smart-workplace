import type { Page } from '@playwright/test'

import {
  applyCollabMarkdown,
  connectCollabPeer,
  leaveAllCollabPeers,
  presenceShot,
  readCollabMarkdown,
  setPageVisibility,
  typeAtEnd,
} from '../../fixtures/collab'
import { installFakeViewport, setKeyboard } from '../../fixtures/keyboard'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { expectStays, measureBox, nextFrame, stableBox } from '../../fixtures/wait'
import { cursorOf, KIM, LONG_BODY } from '../../fixtures/presence'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'
import { LABEL_SHOW_MS } from '../../../src/components/wiki/presenceLabels'
import { BACKGROUND_DISCONNECT_MS, CATCHUP_HIGHLIGHT_MS } from '../../../src/lib/collab/collabResume'

// 모바일(390px) 노트 접속자·원격 커서·복귀(WP-173) — 데스크톱은 pages/wiki/wiki-presence.spec.ts.

const SPACE_ID = 1
const pagePath = (pageId: number) => `/wiki/spaces/${SPACE_ID}/pages/${pageId}`
const syncStatus = (p: Page) => p.getByTestId('wiki-sync-status')
const presence = (p: Page) => p.getByTestId('wiki-presence')

test.afterEach(() => leaveAllCollabPeers())

test.describe('모바일 노트 접속자', () => {
  test('헤더는 아바타 하나와 +N 이고, 누르면 바텀시트에 모두 보인다', async ({ authenticatedPage: a, collabNs }) => {
    await mockWikiPageEditor(a, {
      spaceId: SPACE_ID,
      pageId: 36,
      title: '10월 1주차 스프린트 리뷰 및 다음 사이클 우선순위 논의',
      body: '첫 문단',
    })
    await a.goto(pagePath(36))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    for (const u of [
      { id: 3, name: '박민수' },
      { id: 4, name: '최수진 (플랫폼개발팀 · 백엔드 파트 리드)' },
      { id: 5, name: '이영희' },
    ])
      await connectCollabPeer(collabNs, 36, u)

    await expect(presence(a).locator('[data-testid^="wiki-presence-avatar-"]')).toHaveCount(1)
    await expect(presence(a).getByTestId('wiki-presence-more')).toHaveText('+2')
    const box = await stableBox(presence(a))
    expect(box.height).toBeGreaterThanOrEqual(44)
    await expectNoHorizontalOverflow(a)

    await expect(presence(a)).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(presence(a)).toHaveAttribute('aria-expanded', 'false')
    await presence(a).tap()
    const sheet = a.getByTestId('wiki-presence-sheet')
    await expect(sheet).toContainText('이 노트를 보고 있는 사람 3')
    await expect(sheet.getByTestId('wiki-presence-row-4')).toContainText('보는 중')
    await expect(presence(a)).toHaveAttribute('aria-expanded', 'true')
    await presenceShot(a, 'sheet-three')

    // 시트를 닫으면 포커스가 여는 버튼으로 돌아온다(공용 셸은 기본으로 복귀를 막으므로 이 화면이 직접 돌려준다).
    await a.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(presence(a)).toBeFocused()
  })

  test('시트를 연 채 접속자가 모두 나가면 시트가 닫히고, 다른 사람이 다시 들어와도 저절로 열리지 않는다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 37, title: '회의록', body: '첫 문단' })
    await a.goto(pagePath(37))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const park = await connectCollabPeer(collabNs, 37, { id: 3, name: '박민수' })
    await presence(a).tap()
    const sheet = a.getByTestId('wiki-presence-sheet')
    await expect(sheet).toBeVisible()

    park.leave()
    await expect(presence(a)).toHaveCount(0)
    await connectCollabPeer(collabNs, 37, { id: 4, name: '최수진' })
    await expect(presence(a).getByTestId('wiki-presence-avatar-4')).toBeVisible()
    // 열림 상태가 남아 있으면 새 접속자가 오는 순간 누르지도 않은 시트가 열린다.
    await expectStays(a, () => sheet.count(), 0)
  })
})

test.describe('모바일 원격 커서', () => {
  test('원격 캐럿 근처를 탭하면 이름표가 3초 보인다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const opts = { spaceId: SPACE_ID, pageId: 47, title: '회의록', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install()
    await a.goto(pagePath(47))
    await b.goto(pagePath(47))
    await typeAtEnd(b, '둘째 문단', ' 모바일')
    const cur = cursorOf(a, KIM.id)
    await expect(cur).toHaveAttribute('data-label-visible', '')
    await a.clock.fastForward(LABEL_SHOW_MS + 100)
    await expect(cur).not.toHaveAttribute('data-label-visible')

    // 캐럿에서 10px 옆(24px 폭 안)을 탭해도 잡힌다.
    const caret = (await stableBox(cur.locator('.wiki-presence-cursor__caret')))
    await a.touchscreen.tap(caret.x + caret.width / 2 + 10, caret.y + caret.height / 2)
    await expect(cur).toHaveAttribute('data-label-visible', '')
    await presenceShot(a, 'cursor-tap')
    await a.clock.fastForward(LABEL_SHOW_MS + 100)
    await expect(cur).not.toHaveAttribute('data-label-visible')
  })

  test('바텀시트에서 이름을 누르면 시트가 닫히고 그 커서로 이동한다', async ({ authenticatedPage: a, newAuthedPage }) => {
    const opts = { spaceId: SPACE_ID, pageId: 48, title: '긴 회의록', body: LONG_BODY }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.goto(pagePath(48))
    await b.goto(pagePath(48))
    await typeAtEnd(b, '문단 40', ' 끝')
    const cur = cursorOf(a, KIM.id)
    await expect(cur).toHaveCount(1)
    await expect(cur).not.toBeInViewport()

    await presence(a).tap()
    await a.getByTestId('wiki-presence-sheet').getByTestId('wiki-presence-row-2').getByRole('button').tap()
    await expect(a.getByTestId('wiki-presence-sheet')).toBeHidden()
    await expect(cur).toBeInViewport()
    await expect(cur).toHaveAttribute('data-label-visible', '')
  })
})

test.describe('모바일 위쪽 삽입 스크롤 고정', () => {
  test('키보드로 입력하는 중 다른 사람이 위쪽에 문단을 넣어도 내 커서와 화면이 그대로이고 이어 친 글자가 같은 자리에 들어간다', async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    const paras = Array.from({ length: 30 }, (_, i) => `문단 ${i + 1}`)
    const body = paras.join('\n\n')
    await installFakeViewport(a)
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 51, title: '긴 노트', body })
    await a.goto(pagePath(51))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await typeAtEnd(a, '문단 25', ' 가')
    await setKeyboard(a, true)
    await expect.poll(() => readCollabMarkdown(collabNs, 51)).toContain('문단 25 가')

    const caretTop = () => a.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top)
    const scrollTop = () => a.getByTestId('wiki-editor-scroll').evaluate((el) => el.scrollTop)
    // 브라우저 스크롤 앵커링이 꺼져 있어야 보정이 운이 아니다(실제 iOS WebKit 은 앵커링이 없다).
    await expect(a.getByTestId('wiki-editor-scroll')).toHaveCSS('overflow-anchor', 'none')
    const before = await caretTop()
    const st0 = await scrollTop()

    const added = Array.from({ length: 5 }, (_, i) => `위에 넣은 문단 ${i + 1}`)
    await applyCollabMarkdown(collabNs, 51, { baseBody: body, body: [...added, ...paras].join('\n\n'), ai: false })
    await expect(a.locator('.ProseMirror')).toContainText('위에 넣은 문단 5')

    expect(Math.abs((await caretTop()) - before)).toBeLessThanOrEqual(2)
    expect(await scrollTop()).toBeGreaterThan(st0)
    await a.keyboard.type('나')
    await expect.poll(() => readCollabMarkdown(collabNs, 51)).toContain('문단 25 가나')
  })
})

test.describe('모바일 화면 회전 읽던 줄 고정', () => {
  test('긴 문단 중간을 읽다가 화면 폭이 바뀌어 다시 줄바꿈돼도 읽던 줄이 제자리에 있다', async ({ authenticatedPage: a }) => {
    const long = Array.from({ length: 300 }, (_, i) => `단어${i + 1}`).join(' ')
    const body = [...Array.from({ length: 10 }, (_, i) => `문단 ${i + 1}`), long, ...Array.from({ length: 20 }, (_, i) => `뒤 문단 ${i + 1}`)].join('\n\n')
    await mockWikiPageEditor(a, { spaceId: SPACE_ID, pageId: 63, title: '긴 문단', body })
    await a.goto(pagePath(63))
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    const scroller = a.getByTestId('wiki-editor-scroll')
    // 긴 문단의 가운데가 화면 맨 위에 오게 내린다(포커스 없음 — 읽는 중). scroll 이벤트가 앱에 닿을 때까지 기다린다.
    await a.locator('.ProseMirror p', { hasText: '단어150' }).evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          const sc = el.closest('[data-testid="wiki-editor-scroll"]')!
          const r = el.getBoundingClientRect()
          sc.addEventListener('scroll', () => requestAnimationFrame(() => resolve()), { once: true })
          sc.scrollTop += r.top + r.height / 2 - sc.getBoundingClientRect().top
        }),
    )
    // 화면 맨 위(스크롤 영역 top+4, 에디터 왼쪽+8)에 있는 글자 — 앱이 고르는 기준점과 같은 자리. 그 글자의 문단 내 위치.
    const at = await scroller.evaluate((sc) => {
      const e = document.querySelector('.ProseMirror')!.getBoundingClientRect()
      return document.caretRangeFromPoint(e.left + 8, sc.getBoundingClientRect().top + 4)!.startOffset
    })
    /** 긴 문단 안 offset 글자의 화면 top. */
    const lineTop = (offset: number) =>
      a.evaluate((o) => {
        const p = [...document.querySelectorAll('.ProseMirror p')].find((e) => e.textContent!.startsWith('단어1 '))!
        const range = document.createRange()
        range.setStart(p.firstChild!, o)
        range.setEnd(p.firstChild!, o + 1)
        return range.getBoundingClientRect().top
      }, offset)
    const y0 = await lineTop(at)

    // 폭이 넓어지면(가로 회전) 긴 문단이 다시 줄바꿈돼 문단 안 줄들의 높이가 바뀐다 — 문단 top 이 아니라 읽던 줄을 지켜야 한다.
    await a.setViewportSize({ width: 700, height: 844 })
    await expect.poll(() => scroller.evaluate((el) => el.clientWidth)).toBeGreaterThan(600)
    await nextFrame(a)
    expect(Math.abs((await lineTop(at)) - y0)).toBeLessThanOrEqual(2)
  })
})

test.describe('모바일 복귀', () => {
  test('2분 넘게 자리를 비운 사이 남이 고쳤으면, 돌아올 때 바로 다시 붙고 토스트로 알리며 바뀐 문단을 잠깐 표시한다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 71, title: '회의록', body: '첫 문단\n\n둘째 문단' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install()
    await a.goto(pagePath(71))
    await b.goto(pagePath(71))
    // A 가 B 를 안다(누가 고쳤는지 셀 수 있다).
    await expect(presence(a)).toBeVisible()

    await setPageVisibility(a, 'hidden')
    await a.clock.fastForward(BACKGROUND_DISCONNECT_MS + 1000)
    // A 가 스스로 끊었다 — B 화면에서 A 가 사라지고, 숨겨진 동안 다시 붙지 않는다(실제 provider 의 close 처리가 재연결을 끼워 넣지 않는지).
    await expect(presence(b)).toHaveCount(0)
    await expectStays(b, () => presence(b).count(), 0, { ms: 1500 })
    await typeAtEnd(b, '둘째 문단', ' — 김철수가 고침')
    await expect.poll(() => readCollabMarkdown(collabNs, 71)).toContain('김철수가 고침')

    await setPageVisibility(a, 'visible')
    await expect(syncStatus(a)).toHaveAttribute('data-status', 'live')
    await expect(a.getByText('자리를 비운 동안 1명이 수정했어요')).toBeVisible()
    // "변경 보기" 는 버전 기록 비교(WP-282)가 생기기 전까지 달지 않는다.
    await expect(a.getByRole('button', { name: '변경 보기' })).toHaveCount(0)
    await expect(a.locator('.wiki-catchup-highlight')).toHaveText('둘째 문단 — 김철수가 고침')
    // 모바일에선 이 토스트만 화면 아래에 뜬다(06 §D 승인 예외) — 알리는 하이라이트 문단을 가리지 않는다.
    const toastBox = a.locator('[data-sonner-toast]', { hasText: '자리를 비운 동안' })
    await expect(toastBox).toHaveAttribute('data-y-position', 'bottom')
    const hl = (await stableBox(a.locator('.wiki-catchup-highlight')))
    // 들어오는 슬라이드가 끝난 자리로 판정한다(토스트 위 끝이 하이라이트 아래 끝보다 아래, 화면 안).
    await expect.poll(async () => (await measureBox(toastBox)).y).toBeGreaterThan(hl.y + hl.height)
    const tb = (await stableBox(toastBox))
    expect(tb.y + tb.height).toBeLessThanOrEqual(a.viewportSize()!.height)
    await presenceShot(a, 'resume-toast')
    await a.clock.fastForward(CATCHUP_HIGHLIGHT_MS + 100)
    await expect(a.locator('.wiki-catchup-highlight')).toHaveCount(0)
  })

  test('잠깐(2분 이내) 비웠다 돌아오면 토스트 없이 다른 사람 수정만 반영·표시된다', async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    const opts = { spaceId: SPACE_ID, pageId: 72, title: '회의록', body: '첫 문단' }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: KIM })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install()
    await a.goto(pagePath(72))
    await b.goto(pagePath(72))
    await expect(presence(a)).toBeVisible()

    await setPageVisibility(a, 'hidden')
    // 20초만 넘긴다 — 2분 자가 해제는 물론 provider 의 무응답 소켓 재활용(messageReconnectTimeout 30초)도 건드리지 않는 길이.
    await a.clock.fastForward(20_000)
    await typeAtEnd(b, '첫 문단', ' 잠깐')
    // A 는 끊지 않았다 — 숨겨진 동안에도 받는다. 받은 뒤에 돌아와야 '돌아와 바로 resume' 경로가 결정적이다.
    await expect(a.locator('.ProseMirror')).toContainText('첫 문단 잠깐')
    await setPageVisibility(a, 'visible')
    await expect(a.locator('.wiki-catchup-highlight')).toHaveText('첫 문단 잠깐')
    await expectStays(a, () => a.getByText(/자리를 비운 동안/).count(), 0, { ms: 1000 })
  })
})
