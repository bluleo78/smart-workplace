// 모바일 U4 — main 신규 기능(#884 좌/우 말풍선·#885 출발 화면 복귀·새 메시지 인라인 검색)의 모바일 셸 적응.
// H1 길게 누르기 작업 시트 · H2 이슈 채팅 드로워 URL·헤더 · M1~M5 · L1.
import type { Page } from '@playwright/test'

import { createChatMessage } from '../../factories/chat.factory'
import { createDm, createDmParticipant, createMessage } from '../../factories/messaging.factory'
import { DETAIL, json, KEY, longPress, stubChannelMessages, stubIssue } from '../../fixtures/mobile-chat'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

test.describe('H1 메시지 길게 누르기 작업 시트', () => {
  test('터치 셸에선 툴바를 그리지 않고, 탭은 시트를 열지 않는다(멘션 칩 탭 포함)', async ({ authenticatedPage: page }) => {
    await stubChannelMessages(page)
    // 길게 누르기 판정 타이머(450ms)를 가상 시계로 넘긴다
    await page.clock.install()
    await page.goto('/chat/channels/1')
    await expect(page.getByTestId('message-body-10')).toBeVisible()
    await expect(page.getByTestId('message-toolbar-10')).toHaveCount(0)
    await expect(page.getByTestId('message-toolbar-11')).toHaveCount(0)

    await page.getByTestId('message-body-11').tap()
    await page.getByTestId('mention-chip-20').tap()
    // 길게 누르기 판정 시간(450ms)을 넘겨도 시트는 없다.
    await page.clock.fastForward(700)
    await expectStays(page, () => page.getByTestId('message-action-sheet').count(), 0, { ms: 200 })
    // iOS 텍스트 선택·콜아웃 억제.
    await expect(page.getByTestId('message-10')).toHaveCSS('user-select', 'none')
  })

  test('타인 메시지: 이모지 줄 + 스레드·복사(수정·삭제 없음), 이모지를 누르면 반응이 붙는다', async ({ authenticatedPage: page }) => {
    await stubChannelMessages(page)
    const reactions = trackRequests(page, 'POST', '/api/v1/messaging/messages/10/reactions')
    await page.route((u) => u.pathname === '/api/v1/messaging/messages/10/reactions', (r) =>
      r.request().method() === 'POST' ? r.fulfill({ status: 204, body: '' }) : r.fallback())
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId('message-body-10'))

    const sheet = page.getByTestId('message-action-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('message-action-thread')).toBeVisible()
    await expect(sheet.getByTestId('message-action-copy')).toBeVisible()
    await expect(sheet.getByTestId('message-action-edit')).toHaveCount(0)
    await expect(sheet.getByTestId('message-action-delete')).toHaveCount(0)
    // 행은 44px 터치 타깃.
    expect((await sheet.getByTestId('message-action-thread').boundingBox())!.height).toBeGreaterThanOrEqual(44)
    // ＋ 로 전체 이모지 목록을 펼친다.
    await sheet.getByTestId('message-action-react-more').tap()
    await expect(sheet.getByTestId('message-action-react-🚀')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await sheet.getByTestId('message-action-react-👍').first().tap()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => reactions.lastBody<{ emoji: string }>()?.emoji).toBe('👍')
    await expect(page.getByTestId('reaction-pill-10-👍')).toBeVisible()
    // 반응 칩은 터치에서 32px 이상.
    expect((await page.getByTestId('reaction-pill-10-👍').boundingBox())!.height).toBeGreaterThanOrEqual(32)
  })

  test('답글 링크 위에서 길게 누르면 시트만 열리고 스레드는 열리지 않는다(발동 뒤 click 억제)', async ({ authenticatedPage: page }) => {
    await stubChannelMessages(page)
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId('message-thread-link-10'))
    await expect(page.getByTestId('message-action-sheet')).toBeVisible()
    await expect(page.getByTestId('thread-panel')).toHaveCount(0)
    await expect(page).toHaveURL(/\/chat\/channels\/1$/)
    // 시트의 스레드 행은 스레드를 연다.
    await page.getByTestId('message-action-thread').tap()
    await expect(page.getByTestId('message-action-sheet')).toHaveCount(0)
    await expect(page.getByTestId('thread-panel')).toBeVisible()
  })

  test('본인 메시지: 수정은 인라인 에디터, 삭제는 실행 취소 토스트(취소하면 DELETE 없음)', async ({ authenticatedPage: page }) => {
    await stubChannelMessages(page)
    const deletes = trackRequests(page, 'DELETE', '/api/v1/messaging/messages/11')
    await page.route((u) => u.pathname === '/api/v1/messaging/messages/11', (r) =>
      r.request().method() === 'DELETE' ? r.fulfill({ status: 204, body: '' }) : r.fallback())
    // 실행 취소 지연(5s)을 가상 시계로 넘긴다
    await page.clock.install()
    await page.goto('/chat/channels/1')

    await longPress(page, page.getByTestId('message-body-11'))
    const sheet = page.getByTestId('message-action-sheet')
    await expect(sheet.getByTestId('message-action-edit')).toBeVisible()
    // 파괴적 작업은 빨간 글자.
    const deleteColor = await sheet.getByTestId('message-action-delete').evaluate((el) => getComputedStyle(el).color)
    const editColor = await sheet.getByTestId('message-action-edit').evaluate((el) => getComputedStyle(el).color)
    expect(deleteColor).not.toBe(editColor)
    await sheet.getByTestId('message-action-edit').tap()
    await expect(page.getByTestId('message-editor-input-11')).toBeFocused()
    await page.getByTestId('message-editor-cancel-11').tap()

    await longPress(page, page.getByTestId('message-body-11'))
    await page.getByTestId('message-action-delete').tap()
    await expect(page.getByTestId('message-action-sheet')).toHaveCount(0)
    await page.getByRole('button', { name: '실행 취소' }).tap()
    // UNDO_DELETE_DELAY_MS(5s) 경과 — 취소했으므로 DELETE 가 나가지 않는다.
    await page.clock.fastForward(5500)
    await expectStays(page, deletes.count, 0, { ms: 200 })
  })
})

test.describe('H2·M5 이슈 채팅', () => {
  test('M5: 채팅은 ⋯ 밖 44px 아이콘(미읽음 빨간 점), ⋯ 에는 구독·삭제만', async ({ authenticatedPage: page }) => {
    await stubIssue(page, { unread: true })
    await page.goto(`/projects/${KEY}/issues/1`)
    const header = page.getByTestId('page-header')
    const chat = header.getByTestId('issue-chat-open')
    await expect(chat).toBeVisible()
    const box = (await chat.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
    await expect(chat.getByTestId('issue-chat-unread-dot')).toBeVisible()
    // ⋯ 보다 왼쪽.
    const more = (await header.getByTestId('mobile-header-more').boundingBox())!
    expect(box.x).toBeLessThan(more.x)
    await header.getByTestId('mobile-header-more').tap()
    const menu = page.getByTestId('mobile-header-more-menu')
    await expect(menu.getByTestId('watch-toggle')).toBeVisible()
    await expect(menu.getByTestId('issue-chat-open')).toHaveCount(0)
    await expect(page.getByTestId('issue-chat-open')).toHaveCount(1)
  })

  test('H2: 열면 ?chat=1, 시스템 뒤로가기는 드로워만 닫고 상세에 머문다. 헤더는 ‹ + MOB-1 채팅(기본 X 없음)', async ({ authenticatedPage: page }) => {
    await stubIssue(page)
    await page.goto(`/projects/${KEY}/issues/1`)
    await page.getByTestId('issue-chat-open').tap()
    const drawer = page.getByTestId('issue-chat-drawer')
    await expect(drawer).toBeVisible()
    await expect(page).toHaveURL(/[?&]chat=1$/)
    await expect(drawer.getByTestId('issue-chat-drawer-title')).toHaveText(`${KEY}-1 채팅`)
    await expect(drawer.getByRole('button', { name: 'Close' })).toHaveCount(0)
    const bar = (await drawer.getByTestId('issue-chat-drawer-back').boundingBox())!
    expect(bar.height).toBeGreaterThanOrEqual(44)
    await expectNoHorizontalOverflow(page)

    await page.goBack()
    await expect(drawer).toHaveCount(0)
    await expect(page).toHaveURL(DETAIL)

    // ‹ 로 닫아도 같은 결과 — 열 때 쌓은 항목을 되돌린다(히스토리에 chat=1 이 남지 않음).
    await page.getByTestId('issue-chat-open').tap()
    await expect(drawer).toBeVisible()
    await drawer.getByTestId('issue-chat-drawer-back').tap()
    await expect(drawer).toHaveCount(0)
    await expect(page).toHaveURL(DETAIL)
  })

  test('H2: ?chat=1 딥링크는 드로워가 열린 채 진입, ‹ 는 파라미터만 지우고 상세에 남는다', async ({ authenticatedPage: page }) => {
    await stubIssue(page)
    await page.goto(`/projects/${KEY}/issues/1?chat=1`)
    const drawer = page.getByTestId('issue-chat-drawer')
    await expect(drawer).toBeVisible()
    await drawer.getByTestId('issue-chat-drawer-back').tap()
    await expect(drawer).toHaveCount(0)
    await expect(page).toHaveURL(DETAIL)
  })

  test('H1(이슈 채팅): 본인 메시지 길게 누르기 → 복사·수정·삭제(이모지 줄 없음), 타인 메시지는 복사만', async ({ authenticatedPage: page }) => {
    await stubIssue(page)
    await page.goto(`/projects/${KEY}/issues/1?chat=1`)
    await expect(page.getByTestId('chat-message-body-502')).toBeVisible()
    await expect(page.getByTestId('chat-message-toolbar-502')).toHaveCount(0)

    await longPress(page, page.getByTestId('chat-message-body-502'))
    const sheet = page.getByTestId('message-action-sheet')
    await expect(sheet.getByTestId('message-action-copy')).toBeVisible()
    await expect(sheet.getByTestId('message-action-edit')).toBeVisible()
    await expect(sheet.getByTestId('message-action-delete')).toBeVisible()
    await expect(sheet.getByTestId('message-action-react-more')).toHaveCount(0)
    await sheet.getByTestId('message-action-edit').tap()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByTestId('chat-message-editor-input')).toBeFocused()
    await page.getByTestId('chat-message-editor-cancel').tap()

    await longPress(page, page.getByTestId('chat-message-body-501'))
    await expect(sheet.getByTestId('message-action-copy')).toBeVisible()
    await expect(sheet.getByTestId('message-action-edit')).toHaveCount(0)
    await expect(sheet.getByTestId('message-action-delete')).toHaveCount(0)
  })
})

// ── 새 메시지(/chat/new) ───────────────────────────────────────────────────────
const DM_ID = 77
async function stubNewMessage(page: Page) {
  await stubChat(page)
  // 아이디가 이메일인 사용자 — 후보 행에 '@' 가 두 번 붙지 않아야 한다(M3).
  await page.route((u) => u.pathname === '/api/v1/members', (r) =>
    r.fulfill(json({ content: [{ userId: 2, name: '밥', username: 'bob@example.com', kind: 'HUMAN' }], totalElements: 1 })))
  const dm = createDm({
    id: DM_ID,
    participants: [createDmParticipant({ userId: 1, name: '나' }), createDmParticipant({ userId: 2, name: '밥' })],
  })
  let created = false
  await page.route((u) => u.pathname === '/api/v1/messaging/dms', (r) => {
    if (r.request().method() === 'POST') {
      created = true
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(dm) })
    }
    return r.fulfill(json(created ? [dm] : []))
  })
  const sends = trackRequests(page, 'POST', `/api/v1/messaging/channels/${DM_ID}/messages`)
  await page.route((u) => u.pathname === `/api/v1/messaging/channels/${DM_ID}/messages`, (r) => {
    if (r.request().method() === 'POST') {
      const body = (r.request().postDataJSON() as { body: string }).body
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createMessage({ id: 9, channelId: DM_ID, body })) })
    }
    return r.fulfill(json({ items: [], nextCursor: null, hasMore: false }))
  })
  await page.route((u) => u.pathname === `/api/v1/messaging/channels/${DM_ID}/read`, (r) => r.fulfill({ status: 204, body: '' }))
  return sends
}

test.describe('M1~M4 새 메시지·입력', () => {
  test('M1: 헤더 제목은 "새 메시지"(모듈 제목 "채팅" 바 대신), 본문 라벨은 화면에서 숨김', async ({ authenticatedPage: page }) => {
    await stubNewMessage(page)
    await page.goto('/chat/new')
    await expect(page.getByTestId('mobile-back-title')).toHaveText('새 메시지')
    await expect(page.getByTestId('mobile-back')).toHaveCount(1)
    // 본문의 "새 메시지" 라벨은 스크린리더 전용(시각적으로 두 번 보이지 않음).
    const label = page.getByTestId('new-message-label')
    await expect(label).toHaveText('새 메시지')
    expect((await label.boundingBox())?.height ?? 0).toBeLessThanOrEqual(1)
    await expectNoHorizontalOverflow(page)
  })

  test('M3: 받는 사람 탭·후보 행은 44px, 이메일 아이디에 @ 를 덧붙이지 않는다', async ({ authenticatedPage: page }) => {
    await stubNewMessage(page)
    await page.goto('/chat/new')
    await page.getByTestId('new-message-recipient-input').fill('밥')
    const row = page.getByTestId('member-search-row-2')
    await expect(row).toBeVisible()
    await expect(row).toContainText('bob@example.com')
    await expect(row).not.toContainText('@bob@')
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    for (const k of ['ALL', 'HUMAN', 'AGENT']) {
      expect((await page.getByTestId(`member-search-filter-${k}`).boundingBox())!.height, k).toBeGreaterThanOrEqual(44)
    }
  })

  test('M2·M4: Enter 는 줄바꿈, 보내기 버튼만 전송 → DM 으로 replace 이동(뒤로가기로 빈 작성 화면에 돌아오지 않음)', async ({ authenticatedPage: page }) => {
    const sends = await stubNewMessage(page)
    await page.goto('/chat/new')
    await page.getByTestId('new-message-recipient-input').fill('밥')
    await page.getByTestId('member-search-row-2').tap()
    await expect(page.getByTestId('recipient-chip-2')).toBeVisible()
    const lengthBefore = await page.evaluate(() => history.length)

    await page.getByTestId('message-composer-input').tap()
    await page.keyboard.type('첫 줄')
    await page.keyboard.press('Enter')
    await page.keyboard.type('둘째 줄')
    // Enter 로는 전송되지 않았다(줄바꿈만) — 아직 작성 화면.
    await expect(page).toHaveURL(/\/chat\/new$/)
    expect(sends.count()).toBe(0)

    await page.getByTestId('message-composer-submit').tap()
    await expect.poll(() => sends.bodies<{ body: string }>().map((b) => b.body)).toEqual(['첫 줄\n둘째 줄'])
    await expect(page).toHaveURL(new RegExp(`/chat/dms/${DM_ID}$`))
    expect(await page.evaluate(() => history.length)).toBe(lengthBefore)
  })

  test('M4: 이슈 채팅 입력 안내는 "메시지를 입력하세요"(Shift+Enter 안내 없음), Enter 는 줄바꿈', async ({ authenticatedPage: page }) => {
    await stubIssue(page)
    const posts = trackRequests(page, 'POST', '/api/v1/chat/threads/100/messages')
    await page.route('**/api/v1/chat/threads/100/messages', (r) => {
      if (r.request().method() !== 'POST') return r.fallback()
      const body = (r.request().postDataJSON() as { body: string }).body
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createChatMessage({ id: 600, threadId: 100, body })) })
    })
    await page.goto(`/projects/${KEY}/issues/1?chat=1`)
    const input = page.getByTestId('chat-composer-input')
    await expect(input.locator('[data-placeholder]')).toHaveAttribute('data-placeholder', '메시지를 입력하세요')
    await input.tap()
    await page.keyboard.type('가')
    await page.keyboard.press('Enter')
    await page.keyboard.type('나')
    expect(posts.count()).toBe(0)
    await page.getByTestId('chat-composer-submit').tap()
    await expect.poll(() => posts.bodies<{ body: string }>().map((b) => b.body)).toEqual(['가\n나'])
  })
})
