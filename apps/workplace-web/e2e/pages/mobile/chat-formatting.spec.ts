// 채팅 서식(WP-101) — 모바일(390px 터치). 「Aa」 를 누르면 입력 줄(한 줄 알약) 위에 서식 버튼 줄이 한 줄 가로 스크롤로 나오고,
// 버튼이 입력 포커스를 빼앗지 않으며(키보드 유지), 버튼으로 쓴 서식이 전송 본문 마크다운이 되는지 검증한다.
import { expectNoHorizontalOverflow, expect, test } from '../../fixtures/mobile.fixture'
import { json, KEY, stubChannelMessages, stubIssue } from '../../fixtures/mobile-chat'
import { trackRequests } from '../../fixtures/requests'

const EVIDENCE = process.env.WP101_EVIDENCE_DIR

test('팀 채팅: 서식 줄이 입력 줄 위에 한 줄로 나오고, 버튼으로 굵게·목록을 쓴다', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  const sends = trackRequests(page, 'POST', '/api/v1/messaging/channels/1/messages')
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) =>
    r.request().method() === 'POST' ? r.fulfill(json({ id: 90, channelId: 1, authorId: 1, body: '' })) : r.fallback())
  await page.goto('/chat/channels/1')

  const input = page.getByTestId('message-composer-input')
  const toggle = page.getByTestId('message-composer-input-format')
  // 「Aa」 는 ＋ 옆 44px 터치 타깃.
  await expect.poll(async () => Math.round((await toggle.boundingBox())!.height)).toBe(44)
  await input.tap()
  await toggle.tap()
  await expect(input).toBeFocused()

  const toolbar = page.getByTestId('message-composer-input-format-toolbar')
  await expect(toolbar).toBeVisible()
  const [bar, pill] = [(await toolbar.boundingBox())!, (await input.boundingBox())!]
  // 입력 줄 위, 한 줄(44px 버튼 높이).
  expect(bar.y + bar.height).toBeLessThanOrEqual(pill.y)
  expect(Math.round(bar.height)).toBe(44)
  // 넘치면 줄 안에서만 가로 스크롤 — 페이지는 가로로 넘치지 않는다.
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('message-composer-input-format-bold').tap()
  await expect(input).toBeFocused()
  await page.keyboard.type('공지')
  await page.getByTestId('message-composer-input-format-bold').tap()
  // 터치 셸 Enter = 줄바꿈(새 문단).
  await page.keyboard.press('Enter')
  await page.getByTestId('message-composer-input-format-bulletList').tap()
  await page.keyboard.type('하나')
  // 목록 안 Enter = 새 항목.
  await page.keyboard.press('Enter')
  await page.keyboard.type('둘')
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/e2e-mobile.png` })
  await page.getByTestId('message-composer-submit').tap()
  await expect.poll(() => sends.bodies().map((b) => (b as { body: string }).body)).toEqual(['**공지**\n\n- 하나\n- 둘'])
})

test('이슈 채팅: 서식 줄이 입력 줄 위에 나온다', async ({ authenticatedPage: page }) => {
  await stubIssue(page)
  await page.goto(`/projects/${KEY}/issues/1?chat=1`)
  await page.getByTestId('chat-composer-input').tap()
  await page.getByTestId('chat-composer-input-format').tap()
  const toolbar = page.getByTestId('chat-composer-input-format-toolbar')
  await expect(toolbar).toBeVisible()
  const [bar, pill] = [(await toolbar.boundingBox())!, (await page.getByTestId('chat-composer-input').boundingBox())!]
  expect(bar.y + bar.height).toBeLessThanOrEqual(pill.y)
  await expectNoHorizontalOverflow(page)
})
