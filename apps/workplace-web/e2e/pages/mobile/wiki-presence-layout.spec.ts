import type { Page } from '@playwright/test'

import { connectCollabPeer, leaveAllCollabPeers, presenceShot } from '../../fixtures/collab'
import { expectTheme, textContrast, withTheme } from '../../fixtures/contrast'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { LAYOUT_BODY as BODY, LAYOUT_PEERS as PEERS, tagsDisjoint } from '../../fixtures/presence'
import { stableBox } from '../../fixtures/wait'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'

// 모바일(390px) 다수 접속자·긴 이름 — 헤더 한 줄·바텀시트·이름표 넘침·대비(WP-173 시각 검증). 데스크톱은 pages/wiki/wiki-presence-layout.spec.ts.

const SPACE_ID = 1
const pagePath = (pageId: number) => `/wiki/spaces/${SPACE_ID}/pages/${pageId}`
const presence = (p: Page) => p.getByTestId('wiki-presence')

test.afterEach(() => leaveAllCollabPeers())

for (const theme of ['light', 'dark'] as const) {
  test(`390px 8명·긴 이름 — 헤더 한 줄·바텀시트·이름표가 넘치지 않고 대비를 지킨다 (${theme})`, async ({
    authenticatedPage: a,
    collabNs,
  }) => {
    await withTheme(a, theme)
    const opts = { spaceId: SPACE_ID, pageId: 91, title: '10월 1주차 스프린트 리뷰 및 다음 사이클 우선순위 논의', body: BODY }
    await mockWikiPageEditor(a, opts)
    await a.clock.install()
    await a.goto(pagePath(91))
    await expectTheme(a, theme)
    await expect(a.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'live')
    // 데스크톱 스펙과 같은 이유로 접속자가 붙기 전에 시계를 멈춘다.
    await a.clock.pauseAt((await a.evaluate(() => Date.now())) + 50)
    const peers = []
    for (const u of PEERS) peers.push(await connectCollabPeer(collabNs, 91, u))
    // 블록 3 = 마지막 일반 문단(번호 목록 블록은 글 상자가 아니다).
    peers[0].setCursor(3, 6)
    peers[2].setAiMarker(3, 8)
    await expect(a.locator('.wiki-presence-cursor')).toHaveCount(1)
    // 멈춘 시계는 requestAnimationFrame 도 멈춘다 — 이름표 배치(scheduleFitTags)가 돌도록 타이머·프레임을 100ms 만큼 흘린다(3초 이름표 창보다 훨씬 짧아 이름표는 켜진 채).
    await a.clock.runFor(100)

    await expect(presence(a).locator('[data-testid^="wiki-presence-avatar-"]')).toHaveCount(1)
    await expect(presence(a).getByTestId('wiki-presence-more')).toHaveText('+6')
    await expectNoHorizontalOverflow(a)
    expect((await stableBox(a.getByTestId('wiki-page-header'))).height).toBeLessThanOrEqual(56)
    expect((await stableBox(presence(a))).height).toBeGreaterThanOrEqual(44)
    const tags = await tagsDisjoint(a)
    expect(tags.count).toBeGreaterThanOrEqual(2)
    expect(tags.disjoint).toBe(true)
    expect(await textContrast(a.locator('.wiki-presence-cursor[data-label-visible] .wiki-presence-cursor__tag').first())).toBeGreaterThanOrEqual(4.5)
    await presenceShot(a, `header-${theme}`)

    await a.clock.resume()
    await presence(a).tap()
    const sheet = a.getByTestId('wiki-presence-sheet')
    await expect(sheet.locator('li')).toHaveCount(7)
    const row = sheet.getByTestId('wiki-presence-row-5')
    expect((await stableBox(row)).height).toBeGreaterThanOrEqual(44)
    expect(await row.getByTestId('wiki-presence-name').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await expectNoHorizontalOverflow(a)
    await presenceShot(a, `sheet-${theme}`)
  })
}
