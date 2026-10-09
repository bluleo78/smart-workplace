import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { connectCollabPeer, leaveAllCollabPeers, presenceShot, typeAtEnd } from '../../fixtures/collab'
import { expectTheme, textContrast, withTheme } from '../../fixtures/contrast'
import { LAYOUT_BODY as BODY, LAYOUT_PEERS as PEERS, tagsDisjoint } from '../../fixtures/presence'
import { stableBox } from '../../fixtures/wait'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'

// 다수 접속자(8명)·긴 이름·실제 같은 노트로 헤더·팝오버·이름표가 넘치거나 겹치지 않고, 라이트·다크 대비를 지키는지(WP-173 시각 검증).
// PRESENCE_SHOTS 를 주면 스크린샷을 남긴다(presenceShot).

const SPACE_ID = 1
const pagePath = (pageId: number) => `/wiki/spaces/${SPACE_ID}/pages/${pageId}`
const presence = (p: Page) => p.getByTestId('wiki-presence')

test.afterEach(() => leaveAllCollabPeers())

for (const theme of ['light', 'dark'] as const) {
  test(`8명·긴 이름 — 헤더·팝오버·이름표가 넘치거나 겹치지 않고 대비를 지킨다 (${theme})`, async ({
    authenticatedPage: a,
    newAuthedPage,
    collabNs,
  }) => {
    await withTheme(a, theme)
    await a.setViewportSize({ width: 1024, height: 800 })
    const opts = { spaceId: SPACE_ID, pageId: 90, title: '10월 1주차 스프린트 리뷰 및 다음 사이클 우선순위 논의', body: BODY }
    await mockWikiPageEditor(a, opts)
    const b = await newAuthedPage({ user: { id: 2, name: '김철수철수 (모바일앱개발팀)' } })
    await mockWikiPageEditor(b, { ...opts, seed: false })
    await a.clock.install()
    await a.goto(pagePath(90))
    await expectTheme(a, theme)
    await expect(a.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'live')
    // 접속자가 붙기 전에 A 의 시계를 멈춘다 — 이름표가 켜진 채(3초가 지나지 않은 채) 배치·대비를 잰다. 수신 메시지 처리는 타이머와 무관하다.
    await a.clock.pauseAt((await a.evaluate(() => Date.now())) + 50)
    await b.goto(pagePath(90))
    const peers = []
    for (const u of PEERS) peers.push(await connectCollabPeer(collabNs, 90, u))
    // 블록 3 = 마지막 일반 문단(0 제목·1 번호 목록·2 제목) — 가까운 자리에 커서 둘 + ✦ 하나로 이름표 쌓기를 강제한다.
    peers[0].setCursor(3, 6)
    peers[1].setCursor(3, 9)
    peers[2].setAiMarker(3, 7)
    await typeAtEnd(b, '대기 중인 PR 을 매일 아침 점검한다.', ' 확인')
    await expect(a.locator('.wiki-presence-cursor')).toHaveCount(3)
    // 멈춘 시계는 requestAnimationFrame 도 멈춘다 — 이름표 배치(scheduleFitTags)가 돌도록 타이머·프레임을 100ms 만큼 흘린다(3초 이름표 창보다 훨씬 짧아 이름표는 켜진 채).
    await a.clock.runFor(100)

    await expect(presence(a).locator('[data-testid^="wiki-presence-avatar-"]')).toHaveCount(3)
    await expect(presence(a).getByTestId('wiki-presence-more')).toHaveText('+5')
    const header = a.getByTestId('wiki-page-header')
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    // 가운데 고정 AI 런처(#830)와 겹치지 않는다.
    const launcher = (await stableBox(a.getByTestId('chat-launcher')))
    expect((await stableBox(presence(a))).x).toBeGreaterThanOrEqual(launcher.x + launcher.width)

    const tags = await tagsDisjoint(a)
    expect(tags.count).toBeGreaterThanOrEqual(3)
    expect(tags.disjoint).toBe(true)

    for (const loc of [
      presence(a).locator('[data-slot="avatar-fallback"]').first(),
      presence(a).getByTestId('wiki-presence-more'),
      a.locator('.wiki-presence-cursor[data-label-visible] .wiki-presence-cursor__tag').first(),
      a.locator('.wiki-ai-marker__tag').first(),
    ])
      expect(await textContrast(loc)).toBeGreaterThanOrEqual(4.5)
    await presenceShot(a, `desktop-1024-${theme}`)
    await a.setViewportSize({ width: 1440, height: 900 })
    // 폭이 바뀐 뒤 다시 배치하는 프레임도 흘린다.
    await a.clock.runFor(100)
    await presenceShot(a, `desktop-1440-${theme}`)

    await a.clock.resume()
    await presence(a).click()
    const pop = a.getByTestId('wiki-presence-popover')
    await expect(pop.locator('li')).toHaveCount(8)
    const longName = pop.getByTestId('wiki-presence-row-5').getByTestId('wiki-presence-name')
    await expect(longName).toHaveAttribute('title', PEERS[2].name)
    expect(await longName.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    const pb = (await stableBox(pop))
    expect(pb.x + pb.width).toBeLessThanOrEqual(1440)
    await presenceShot(a, `popover-${theme}`)
  })
}
