// 목록 불러오기 실패를 빈 상태와 구분한다(WP-865) — 드라이브·대화·노트·캘린더·홈 「지금 신경 쓸 일」.
// 예전엔 목록 API 가 500 이어도 「대화를 시작해 보세요」·「다 확인했습니다」 같은 빈 상태나 빈 본문·「준비 중…」으로 보여,
// 데이터가 없는 것처럼 오해하게 했다. 실패는 「…을(를) 불러오지 못했습니다」 + 다시 시도로 보이고, 다시 시도가 실제로 다시 부른다.
import type { Page } from '@playwright/test'

import { calendarEvent } from '../factories/calendar.factory'
import { personalSpace } from '../factories/drive.factory'
import { createChannel } from '../factories/messaging.factory'
import { wikiPageSummary, wikiSpace } from '../factories/wiki.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

/**
 * GET path 를 실패(500)로 가로채고, 돌려받은 함수를 부르면 그 뒤로는 body 로 성공한다.
 * 픽스처의 기본 모킹보다 나중에 등록해 이쪽이 이긴다. 부른 횟수도 센다(다시 시도가 실제 요청을 보내는지).
 */
async function failingThenOk(page: Page, path: string, body: unknown) {
  let failing = true
  const state = { calls: 0, recover: () => void (failing = false) }
  await page.route(
    (url) => url.pathname === path,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      state.calls += 1
      return failing
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '서버 오류' }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )
  return state
}

test.describe('목록 불러오기 실패 상태 (WP-865)', () => {
  test('드라이브 — 공간 목록 500 이면 사이드바·본문에 실패 안내, 다시 시도하면 개인 공간으로 들어간다', async ({ authenticatedPage: page }) => {
    const spaces = await failingThenOk(page, '/api/v1/drive/spaces', [personalSpace({ id: 7 })])

    await page.goto('/drive')

    await expect(page.getByTestId('drive-index-error')).toContainText('드라이브를 불러오지 못했습니다')
    await expect(page.getByTestId('drive-spaces-error')).toContainText('공간 목록을 불러오지 못했습니다')

    spaces.recover()
    const before = spaces.calls
    await page.getByTestId('drive-index-error-retry').click()
    await expect(page).toHaveURL(/\/drive\/spaces\/7$/)
    await expect(page.getByTestId('drive-spaces-error')).toHaveCount(0)
    await expect(page.getByTestId('drive-space-list')).toContainText('내 드라이브')
    expect(spaces.calls).toBeGreaterThan(before)
  })

  test('대화 — 채널 목록 500 이면 「대화를 시작해 보세요」 대신 실패 안내, 다시 시도하면 채널과 빈 상태가 돌아온다', async ({ authenticatedPage: page }) => {
    const channels = await failingThenOk(page, '/api/v1/messaging/channels', [createChannel({ id: 3, name: '공지' })])

    await page.goto('/chat')

    await expect(page.getByTestId('channel-load-error')).toContainText('대화 목록을 불러오지 못했습니다')
    await expect(page.getByText('대화를 시작해 보세요')).toHaveCount(0)
    await expect(page.getByTestId('channel-list-error')).toContainText('채널 목록을 불러오지 못했습니다')

    channels.recover()
    await page.getByTestId('channel-list-error-retry').click()
    await expect(page.getByTestId('channel-link-3')).toContainText('공지')
    await expect(page.getByText('대화를 시작해 보세요')).toBeVisible()
    await expect(page.getByTestId('channel-load-error')).toHaveCount(0)
  })

  // WP-881: 다시 부르는 동안 버튼이 disabled 로 꺼져 키보드 초점이 body 로 사라졌다.
  test('대화 — 키보드로 다시 시도하면 다시 부르는 동안·다시 실패해도 초점이 버튼에 남고, 성공하면 불러온 목록으로 옮긴다', async ({ authenticatedPage: page }) => {
    const channels = await failingThenOk(page, '/api/v1/messaging/channels', [createChannel({ id: 3, name: '공지' })])
    // 다시 시도 응답만 늦춰 「다시 부르는 중」 상태를 확인할 수 있게 한다.
    let slow = false
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      async (route) => {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 1500))
        return route.fallback()
      },
    )

    await page.goto('/chat')
    const retry = page.getByTestId('channel-list-error-retry')
    await expect(retry).toBeVisible()

    slow = true
    await retry.focus()
    await page.keyboard.press('Enter')
    // 다시 부르는 중 — 누름은 막혀도(aria-disabled) 초점은 그대로다.
    await expect(retry).toHaveAttribute('aria-disabled', 'true')
    await expect(retry).toBeFocused()
    // 다시 실패 — 같은 버튼에 남는다.
    await expect(retry).not.toHaveAttribute('aria-disabled')
    await expect(retry).toBeFocused()

    channels.recover()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('channel-link-3')).toContainText('공지')
    await expect(page.getByTestId('channel-list-error')).toHaveCount(0)
    // 안내가 있던 자리 뒤 — 불러온 채널 목록의 첫 링크로 초점이 옮겨 간다(body 로 사라지지 않음).
    await expect(page.getByTestId('channel-link-3')).toBeFocused()
  })

  test('노트 — 공간 목록 500 이면 「준비 중…」에 멈추지 않고 실패 안내, 다시 시도하면 첫 공간으로 간다', async ({ authenticatedPage: page }) => {
    const spaces = await failingThenOk(page, '/api/v1/wiki/spaces', [wikiSpace({ id: 4, name: '개인 노트' })])

    await page.goto('/wiki')

    await expect(page.getByTestId('wiki-spaces-error')).toContainText('노트 공간을 불러오지 못했습니다')
    await expect(page.getByText('노트 공간을 준비 중…')).toHaveCount(0)
    await expect(page.getByTestId('wiki-sidebar-spaces-error')).toBeVisible()

    spaces.recover()
    await page.getByTestId('wiki-spaces-error-retry').click()
    await expect(page).toHaveURL(/\/wiki\/spaces\/4/)
    await expect(page.getByTestId('wiki-spaces-error')).toHaveCount(0)
  })

  test('노트 — 공간 안에서 공간 목록만 실패하면 선택 상자 자리에 안내하고 페이지 트리는 그대로 쓴다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/wiki/spaces', { message: '서버 오류' }, { status: 500 })
    await mockApi(page, 'GET', '/api/v1/wiki/spaces/4/pages', [wikiPageSummary({ id: 21, title: '회의록' })])

    await page.goto('/wiki/spaces/4')

    await expect(page.getByTestId('wiki-sidebar-spaces-error')).toContainText('노트 공간을 불러오지 못했습니다')
    await expect(page.getByTestId('wiki-tree-row-21')).toContainText('회의록')
  })

  test('캘린더 — 일정 500 이면 달력 위에 실패 안내, 다시 시도하면 일정이 그려진다', async ({ authenticatedPage: page }) => {
    const NOW = new Date('2026-10-14T09:00:00+09:00')
    await page.clock.setFixedTime(NOW)
    const events = await failingThenOk(page, '/api/v1/calendar/events', [
      calendarEvent({ id: 11, title: '주간 회의', startsAt: '2026-10-14T10:00:00+09:00', endsAt: '2026-10-14T11:00:00+09:00' }),
    ])

    await page.goto('/calendar')

    await expect(page.getByTestId('calendar-events-error')).toContainText('일정을 불러오지 못했습니다')
    // 달력은 그대로 — 실패해도 이동·보기 전환은 쓸 수 있다.
    await expect(page.getByTestId('calendar-view-month-btn')).toBeVisible()

    events.recover()
    await page.getByTestId('calendar-events-error-retry').click()
    await expect(page.getByTestId('calendar-events-error')).toHaveCount(0)
    await expect(page.getByText('주간 회의').first()).toBeVisible()
  })

  test('홈 — 「지금 신경 쓸 일」 소스가 실패한 채 0건이면 「다 확인했습니다」 대신 실패 안내, 다시 시도하면 빈 상태', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/me/dashboard', { widgets: [{ id: 'synthesis', type: 'synthesis', count: 5, hidden: false }] })
    const messaging = await failingThenOk(page, '/api/v1/me/messaging-summary', {
      unreadConversationCount: 0, needsReplyCount: 0, aiAttentionCount: 0, attentionCount: 0, recent: [],
    })

    await page.goto('/')

    await expect(page.getByTestId('dashboard-attention-error')).toContainText('지금 신경 쓸 일을 불러오지 못했습니다')
    await expect(page.getByTestId('dashboard-attention-empty')).toHaveCount(0)

    messaging.recover()
    await page.getByTestId('dashboard-attention-error-retry').click()
    await expect(page.getByTestId('dashboard-attention-empty')).toContainText('다 확인했습니다')
    await expect(page.getByTestId('dashboard-attention-error')).toHaveCount(0)
  })

  test('홈 — 다른 소스 행이 있어도 실패한 소스가 있으면 「일부 항목을 불러오지 못했습니다」를 함께 보인다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/me/dashboard', { widgets: [{ id: 'synthesis', type: 'synthesis', count: 5, hidden: false }] })
    await mockApi(page, 'GET', '/api/v1/me/mail-summary', { message: '서버 오류' }, { status: 500 })
    await mockApi(page, 'GET', '/api/v1/me/messaging-summary', {
      unreadConversationCount: 1, needsReplyCount: 0, aiAttentionCount: 1, attentionCount: 1,
      recent: [{
        kind: 'CHANNEL', conversationId: 5, label: '#dev', lastAuthorName: '박서연', lastMessagePreview: '배포 확인 부탁',
        lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), unreadCount: 1, mentioned: false,
        needsReply: false, newThreadReplyCount: 0, aiReason: '배포 여부 질문',
      }],
    })

    await page.goto('/')

    await expect(page.getByTestId('dashboard-attention-focus')).toContainText('#dev')
    await expect(page.getByTestId('dashboard-attention-partial-error')).toContainText('일부 항목을 불러오지 못했습니다')
  })

  test('홈 — AI 우선순위만 실패하면 정렬 점수만 빠지므로 빈 상태는 그대로 「다 확인했습니다」', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/me/dashboard', { widgets: [{ id: 'synthesis', type: 'synthesis', count: 5, hidden: false }] })
    await mockApi(page, 'GET', '/api/v1/me/priority-items', { message: '서버 오류' }, { status: 500 })

    await page.goto('/')

    await expect(page.getByTestId('dashboard-attention-empty')).toContainText('다 확인했습니다')
    await expect(page.getByTestId('dashboard-attention-error')).toHaveCount(0)
  })
})
