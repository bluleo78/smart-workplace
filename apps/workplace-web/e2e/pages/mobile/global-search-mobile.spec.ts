// global-search-mobile.spec.ts — 휴대폰 전체 화면 통합 검색(WP-1354)의 브라우저 판정분.
// 헤더 🔍 위치·시작 탭·「취소」·뒤로 가기 닫기·결과 이동 뒤 뒤로 가기·목록 밀면 키보드 내리기는
// vitest(src/components/search/SearchPaletteMobile.test.tsx)가 지킨다. 여기서는 jsdom 이 잴 수 없는 기하만 본다 —
// 검색 화면이 뷰포트 전체를 덮고, 종류 탭 줄은 옆으로 넘쳐 밀리되 페이지 자체는 가로로 넘치지 않는다.
// 데스크톱 팔레트의 기하는 e2e/pages/global-search.spec.ts.
import { measureBox } from '../../fixtures/wait'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('390px 에서 🔍 로 연 검색은 뷰포트 전체를 덮고 종류 탭 줄만 옆으로 넘친다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  await page.getByTestId('mobile-search-button').click()
  const palette = page.getByTestId('global-search')
  await expect(page.getByTestId('global-search-input')).toBeFocused()
  // 지금 앱(대화) 탭에서 시작한다.
  await expect(page.getByTestId('global-search-tab-chat')).toHaveAttribute('aria-selected', 'true')

  const viewport = page.viewportSize()!
  await expect(async () => {
    const p = await measureBox(palette, 'global-search')
    expect(Math.round(p.x)).toBe(0)
    expect(Math.round(p.y)).toBe(0)
    expect(Math.round(p.width)).toBe(viewport.width)
    expect(Math.round(p.height)).toBe(viewport.height)
  }).toPass()

  // 종류 탭 9개는 390px 에 다 들어가지 않는다 — 탭 줄 안에서만 가로로 넘쳐 밀 수 있고, 문서는 넘치지 않는다.
  const tabs = page.getByRole('tablist', { name: '검색할 앱' })
  const { scrollWidth, clientWidth } = await tabs.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  expect(scrollWidth, `탭 줄 scrollWidth ${scrollWidth} vs clientWidth ${clientWidth}`).toBeGreaterThan(clientWidth)
  await expectNoHorizontalOverflow(page)
})

// WP-1384 — 휴대폰 결과 행: 제목은 두 줄까지 보여 맞은 곳이 줄 끝에서 잘리지 않고, meta·시각은 제목 아래 줄로 내려 잘리지 않는다.
// jsdom 은 줄바꿈·말줄임을 잴 수 없어 브라우저로 본다. 검색 API 는 page.route 로 스텁한다.
const Q = '꿀사과 가 뒤에 있습니다요' // 14자

test('휴대폰 메시지 결과는 맞은 곳(13자째부터)이 두 줄 제목 안에 보이고 meta·시각은 아래 줄로 내려간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await stubChat(page)
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/discover', (r) => r.fulfill({ json: [] }))
  await page.route((u) => u.pathname === '/api/v1/search/messages', (r) =>
    r.fulfill({
      json: {
        hasMore: false,
        items: [
          {
            id: 901,
            channelId: 1,
            channelKind: 'CHANNEL',
            channelName: '모바일-개편',
            parentMessageId: null,
            authorName: '김하늘',
            authorKind: 'HUMAN',
            // 서버 발췌는 맞은 곳 앞 12자부터 — 맞은 글자는 13자째에서 시작한다.
            excerpt: `…어제 회의에서 나온 ${Q} 라는 말이 아직도 기억에 남아서 다시 적어 둡니다`,
            createdAt: '2026-11-05T01:00:00.000000Z',
          },
        ],
      },
    }),
  )
  await page.goto('/chat')
  await page.getByTestId('mobile-search-button').click()
  await page.getByTestId('global-search-input').fill(Q)

  const row = page.getByTestId('global-search-hit-chat:message:901')
  await expect(row).toBeVisible()
  const mark = row.locator('mark').first()
  await expect(mark).toBeVisible()
  const title = mark.locator('xpath=ancestor::span[contains(@class,"line-clamp-2")][1]')
  await expect(async () => {
    const m = await measureBox(mark, 'mark')
    const t = await measureBox(title, 'title')
    expect(m.x + m.width, '맞은 곳이 제목 오른쪽 밖').toBeLessThanOrEqual(t.x + t.width + 1)
    expect(m.y + m.height, '맞은 곳이 제목 아래 밖').toBeLessThanOrEqual(t.y + t.height + 1)
    // 제목은 두 줄까지 — 넘쳐 잘린 글자가 없다(맞은 곳이 줄 끝 「…」로 가려지지 않음).
    const clipped = await title.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
    expect(clipped, '제목이 두 줄을 넘어 잘림').toBe(false)
  }).toPass()

  // meta 묶음(# 채널 · 시각)은 제목 아래 줄, 글자는 잘리지 않는다.
  const group = row.getByTestId('global-search-hit-meta-group')
  await expect(async () => {
    const g = await measureBox(group, 'meta-group')
    const t = await measureBox(title, 'title')
    expect(g.y).toBeGreaterThanOrEqual(t.y + t.height - 1)
    const metaText = group.locator('span.truncate').first()
    const { s, c } = await metaText.evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }))
    expect(s, `meta scrollWidth ${s} vs ${c}`).toBeLessThanOrEqual(c)
  }).toPass()
  // 393px 로 띄우므로 공용 헬퍼(390 고정) 대신 뷰포트 폭과 비교한다.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393)
})

test('휴대폰 캘린더 결과는 반복 meta·꼬리표가 제목 아래 줄에서 잘리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await stubChat(page)
  await page.route((u) => u.pathname === '/api/v1/calendar/events/search', (r) =>
    r.fulfill({
      json: {
        truncated: false,
        nextCursor: null,
        items: [
          {
            id: 77,
            title: '모바일 개편 주간 점검 회의',
            startsAt: '2026-10-05T00:00:00Z',
            endsAt: '2026-10-05T01:00:00Z',
            allDay: false,
            location: null,
            calendarName: '기본',
            calendarColor: 'blue',
            recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=6',
            occurrenceStart: '2026-11-09T00:00:00Z',
            past: false,
            matchedField: 'TITLE',
            matchedText: null,
          },
        ],
      },
    }),
  )
  await page.goto('/chat')
  await page.getByTestId('mobile-search-button').click()
  await page.getByTestId('global-search-tab-calendar').click()
  await page.getByTestId('global-search-input').fill('주간 점검')

  const row = page.getByTestId('global-search-hit-calendar:77')
  await expect(row).toBeVisible()
  const title = row.locator('span.line-clamp-2')
  const group = row.getByTestId('global-search-hit-meta-group')
  await expect(async () => {
    const g = await measureBox(group, 'meta-group')
    const t = await measureBox(title, 'title')
    expect(g.y).toBeGreaterThanOrEqual(t.y + t.height - 1)
    const metaText = group.locator('span.truncate').first()
    const { s, c } = await metaText.evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }))
    expect(s, `meta scrollWidth ${s} vs ${c}`).toBeLessThanOrEqual(c)
    const tagText = group.locator('span.truncate').last()
    const tg = await tagText.evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }))
    expect(tg.s).toBeLessThanOrEqual(tg.c)
  }).toPass()
  // 393px 로 띄우므로 공용 헬퍼(390 고정) 대신 뷰포트 폭과 비교한다.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393)
})
