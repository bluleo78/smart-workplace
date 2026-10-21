// 태그 구독 주소 창 E2E (WP-715) — 사이드바 ⋮ 「구독 주소…」 → 주소 보기·복사·새 주소로 바꾸기·없애기의 실제 배선.
// 백엔드 없이 page.route 로 /api/v1/calendar/** 를 모킹하고, 발급·재발급·폐기 요청이 나가는지와 창이 응답을 따라가는지 본다.
import type { Page } from '@playwright/test'

import type { CalendarEvent, CalendarTag, TagFeed } from '../../../src/types/calendar'
import { calendar } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

// 타임존 고정 — 호스트 TZ 에 따라 날짜 경계가 달라진다(이슈 #493).
test.use({ timezoneId: 'Asia/Seoul' })

const TAGS: CalendarTag[] = [
  { id: 1, name: '사내 공유', color: 'violet', eventCount: 12, hasFeed: true, fromOutlook: false },
  { id: 2, name: '운영', color: 'amber', eventCount: 5, hasFeed: false, fromOutlook: false },
]

/** 일정 목록·상세 + 태그 목록 스텁. 태그 PUT/POST/피드는 각 테스트가 더 구체적으로 다시 모킹한다(나중 등록 우선). */
async function stub(page: Page, events: CalendarEvent[], tags: CalendarTag[] = TAGS) {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await mockApi(page, 'GET', '/api/v1/calendars', [
    calendar({ id: 1, name: '기본', isDefault: true }),
    calendar({ id: 10, name: '회사 일정', isDefault: false, isReadOnly: true, accountEmail: 'me@corp.kr', provider: 'M365_GRAPH' }),
  ])
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
  await mockApi(page, 'GET', '/api/v1/calendar/tags', tags)
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const m = new URL(route.request().url()).pathname.match(/\/calendar\/events\/(\d+)$/)
      if (route.request().method() === 'GET') {
        const body = m ? events.find((e) => e.id === Number(m[1])) : events
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      }
      return route.fallback()
    },
  )
}

test('구독 주소 창: 주소가 있으면 주소·일정 수를 보이고, 새 주소로 바꾸기는 확인 뒤 POST 한다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  await mockApi(page, 'GET', '/api/v1/calendar/tags/1/feed', {
    url: 'https://example.test/api/v1/public/calendar/feeds/abc123.ics', createdAt: '2026-06-10T05:00:00Z', eventCount: 12,
  })
  const regen = await mockApi(page, 'POST', '/api/v1/calendar/tags/1/feed', {
    url: 'https://example.test/api/v1/public/calendar/feeds/new456.ics', createdAt: '2026-06-10T06:00:00Z', eventCount: 12,
  }, { capture: true })
  await page.goto('/calendar')

  await page.getByTestId('calendar-tag-menu-1').click()
  await page.getByTestId('calendar-tag-feed-1').click()
  const dialog = page.getByTestId('calendar-tag-feed-dialog')
  await expect(dialog).toContainText('「사내 공유」 구독 주소')
  await expect(dialog.getByTestId('calendar-tag-feed-url')).toHaveValue('https://example.test/api/v1/public/calendar/feeds/abc123.ics')
  await expect(dialog.getByTestId('calendar-tag-feed-count')).toHaveText('지금 이 태그를 붙인 일정 12개')

  await dialog.getByTestId('calendar-tag-feed-regenerate').click()
  await expect(page.getByTestId('calendar-tag-feed-confirm')).toContainText('이전 주소는 바로 막혀요')
  await page.getByTestId('calendar-tag-feed-confirm-submit').click()
  await expect.poll(() => regen.requests.length).toBe(1)
  await expect(dialog.getByTestId('calendar-tag-feed-url')).toHaveValue('https://example.test/api/v1/public/calendar/feeds/new456.ics')
})

test('구독 주소가 없는 태그는 「구독 주소 만들기」만 보인다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  await page.goto('/calendar')
  await page.getByTestId('calendar-tag-menu-2').click()
  await page.getByTestId('calendar-tag-feed-2').click()
  const dialog = page.getByTestId('calendar-tag-feed-dialog')
  await expect(dialog.getByTestId('calendar-tag-feed-create')).toBeVisible()
  await expect(dialog.getByTestId('calendar-tag-feed-url')).toHaveCount(0)
})

/**
 * 태그 목록을 상태로 서빙하고, 구독 주소 발급(POST)·폐기(DELETE)가 그 태그의 hasFeed 를 실제 서버처럼 바꾸게 한다.
 * 화면은 성공 뒤 태그 목록을 다시 받으므로, 고정 응답이면 hasFeed 가 되돌아가 창이 이전 상태로 돌아간다.
 */
async function statefulFeed(page: Page, tagId: number, feed: TagFeed) {
  const tags = TAGS.map((t) => ({ ...t }))
  const calls = { post: 0, del: 0 }
  await page.route(
    (url) => url.pathname === '/api/v1/calendar/tags',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tags) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/calendar/tags/${tagId}/feed`,
    (route) => {
      const tag = tags.find((t) => t.id === tagId)!
      const method = route.request().method()
      if (method === 'POST') {
        calls.post++
        tag.hasFeed = true
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed) })
      }
      if (method === 'DELETE') {
        calls.del++
        tag.hasFeed = false
        return route.fulfill({ status: 204, body: '' })
      }
      return tag.hasFeed
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed) })
        : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: '구독 주소가 없습니다' }) })
    },
  )
  return calls
}

test('주소 없애기는 확인 뒤 DELETE 하고, 창은 「구독 주소 만들기」로 돌아간다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  const calls = await statefulFeed(page, 1, {
    url: 'https://example.test/api/v1/public/calendar/feeds/abc123.ics', createdAt: '2026-06-10T05:00:00Z', eventCount: 12,
  })
  await page.goto('/calendar')

  await page.getByTestId('calendar-tag-menu-1').click()
  await page.getByTestId('calendar-tag-feed-1').click()
  const dialog = page.getByTestId('calendar-tag-feed-dialog')
  await expect(dialog.getByTestId('calendar-tag-feed-url')).toBeVisible()
  await dialog.getByTestId('calendar-tag-feed-remove').click()
  await expect(page.getByTestId('calendar-tag-feed-confirm')).toContainText('지금 주소는 바로 막히고')
  await page.getByTestId('calendar-tag-feed-confirm-submit').click()
  await expect.poll(() => calls.del).toBe(1)
  await expect(dialog.getByTestId('calendar-tag-feed-create')).toBeVisible()
  await expect(dialog.getByTestId('calendar-tag-feed-url')).toHaveCount(0)
})

test('주소가 없는 태그에서 「구독 주소 만들기」를 누르면 POST 하고 새 주소를 보인다', async ({ authenticatedPage: page }) => {
  await stub(page, [])
  const calls = await statefulFeed(page, 2, {
    url: 'https://example.test/api/v1/public/calendar/feeds/fresh789.ics', createdAt: '2026-06-10T06:00:00Z', eventCount: 5,
  })
  await page.goto('/calendar')
  await page.getByTestId('calendar-tag-menu-2').click()
  await page.getByTestId('calendar-tag-feed-2').click()
  const dialog = page.getByTestId('calendar-tag-feed-dialog')
  await dialog.getByTestId('calendar-tag-feed-create').click()
  await expect.poll(() => calls.post).toBe(1)
  await expect(dialog.getByTestId('calendar-tag-feed-url')).toHaveValue('https://example.test/api/v1/public/calendar/feeds/fresh789.ics')
  await expect(dialog.getByTestId('calendar-tag-feed-count')).toHaveText('지금 이 태그를 붙인 일정 5개')
})
