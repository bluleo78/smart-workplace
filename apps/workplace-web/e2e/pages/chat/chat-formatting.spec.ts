// 채팅 서식(WP-101) — 팀 채팅 데스크톱.
// 「Aa」 로 서식 도구 줄을 열고 버튼·단축키·마크다운 입력 규칙으로 쓴 서식이 전송 payload 의 마크다운 본문이 되는지,
// 서버가 준 마크다운 본문이 <strong>·<u>·목록·코드 블록으로 그려지고 예전 평문 메시지는 예전처럼 보이는지,
// 서식 메시지를 수정하면 서식이 복원되고 그대로 저장되는지 검증한다.
import type { Page } from '@playwright/test'

import { createChannelMember, createMessage } from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { stubChat } from '../../fixtures/mobile.fixture'
import { json } from '../../fixtures/mobile-chat'
import { trackRequests } from '../../fixtures/requests'

const EVIDENCE = process.env.WP101_EVIDENCE_DIR

/** 채널 1 — 본인(1)의 서식 메시지 31, 동료(20)의 예전 평문 메시지 30. */
async function stubChannel(page: Page) {
  await stubChat(page)
  const legacy = createMessage({
    id: 30, channelId: 1, authorId: 20, authorName: '동료', createdAt: '2026-09-30T03:00:00Z',
    body: '예전 메시지\n    들여쓴 줄 a_b 2*3 #해시\n\n- 이건 목록으로 보인다\nhttps://a.com/x_(y)',
  })
  const formatted = createMessage({
    id: 31, channelId: 1, authorId: 1, authorName: 'me', createdAt: '2026-09-30T03:10:00Z',
    body: '**배포** 일정은 <u>금요일</u> ~~목요일~~ `v1.2`\n\n- 빌드\n- 검증\n\n```\nkubectl rollout status\n```',
  })
  // 본인의 예전 메시지 — 저장하면 모양이 바뀔 수 있는 목록 표기(`* `·`1)`).
  const ownLegacy = createMessage({
    id: 32, channelId: 1, authorId: 1, authorName: 'me', createdAt: '2026-09-30T03:15:00Z', body: '* 별표 항목\n1) 괄호 번호',
  })
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) => {
    if (r.request().method() === 'GET') return r.fulfill(json({ items: [ownLegacy, formatted, legacy], nextCursor: null, hasMore: false }))
    if (r.request().method() !== 'POST') return r.fallback()
    const p = r.request().postDataJSON() as { body: string }
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createMessage({ id: 90, channelId: 1, authorId: 1, body: p.body })) })
  })
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/members', (r) =>
    r.fulfill(json([createChannelMember({ userId: 1, name: 'me' }), createChannelMember({ userId: 20, name: '동료' })])))
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/read', (r) => r.fulfill({ status: 204, body: '' }))
  await page.route((u) => u.pathname === '/api/v1/messaging/messages/31', (r) =>
    r.request().method() === 'PATCH'
      ? r.fulfill(json({ ...formatted, body: (r.request().postDataJSON() as { body: string }).body, editedAt: '2026-09-30T03:20:00Z' }))
      : r.fallback())
  return trackRequests(page, 'POST', '/api/v1/messaging/channels/1/messages')
}

test.describe('채팅 서식 (WP-101) — 팀 채팅', () => {
  test('서식 도구 줄 버튼으로 굵게·밑줄·목록을 쓰면 마크다운 본문으로 보낸다', async ({ authenticatedPage: page }) => {
    const sends = await stubChannel(page)
    await page.goto('/chat/channels/1')
    const input = page.getByTestId('message-composer-input')
    const toggle = page.getByTestId('message-composer-input-format')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('message-composer-input-format-toolbar')).toHaveCount(0)

    await input.click()
    await toggle.click()
    const toolbar = page.getByTestId('message-composer-input-format-toolbar')
    await expect(toolbar).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // 버튼은 에디터 포커스를 빼앗지 않는다(iOS 키보드 유지, WP-224).
    await expect(input).toBeFocused()

    await page.getByTestId('message-composer-input-format-bold').click()
    await expect(page.getByTestId('message-composer-input-format-bold')).toHaveAttribute('aria-pressed', 'true')
    await expect(input).toBeFocused()
    await page.keyboard.type('굵게')
    await page.getByTestId('message-composer-input-format-bold').click()
    await page.keyboard.type(' 그리고 ')
    await page.getByTestId('message-composer-input-format-underline').click()
    await page.keyboard.type('밑줄')
    await page.getByTestId('message-composer-input-format-underline').click()
    await page.keyboard.press('Shift+Enter')
    await page.getByTestId('message-composer-input-format-bulletList').click()
    await page.keyboard.type('하나')
    // 목록 안 Shift+Enter = 새 항목.
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('둘')
    await page.keyboard.press('Enter')

    await expect.poll(() => sends.bodies().map((b) => (b as { body: string }).body)).toEqual(['**굵게** 그리고 <u>밑줄</u>\n\n- 하나\n- 둘'])
    // 열림 상태는 기억된다 — 새로고침 뒤에도 열려 있다.
    await page.reload()
    await expect(page.getByTestId('message-composer-input-format-toolbar')).toBeVisible()
  })

  test('서식 줄을 닫아 둬도 단축키·마크다운 입력 규칙이 동작하고 평문은 친 그대로 보낸다', async ({ authenticatedPage: page }) => {
    const sends = await stubChannel(page)
    await page.goto('/chat/channels/1')
    const input = page.getByTestId('message-composer-input')
    await input.click()
    await page.keyboard.type('**굵게** *기울임* `코드` ~~취소~~ a_b 2*3 끝')
    await page.keyboard.press('ControlOrMeta+u')
    await page.keyboard.type('밑줄')
    await page.keyboard.press('Enter')
    await expect.poll(() => sends.bodies().map((b) => (b as { body: string }).body)).toEqual([
      '**굵게** *기울임* `코드` ~~취소~~ a_b 2*3 끝<u>밑줄</u>',
    ])
  })

  test('한글 조합 사이의 마크다운 입력 규칙 — 조합을 마친 글자까지 굵게', async ({ authenticatedPage: page }) => {
    const sends = await stubChannel(page)
    await page.goto('/chat/channels/1')
    const input = page.getByTestId('message-composer-input')
    await input.click()
    await page.keyboard.type('**')
    // 실제 IME 조합(CDP) — 조합 중엔 입력 규칙이 돌지 않고, 확정된 뒤 닫는 ** 에서 굵게가 된다.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '굵', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.imeSetComposition', { text: '굵게', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.insertText', { text: '굵게' })
    await page.keyboard.type('** 끝')
    await expect(input.locator('strong')).toHaveText('굵게')
    await page.keyboard.press('Enter')
    await expect.poll(() => sends.bodies().map((b) => (b as { body: string }).body)).toEqual(['**굵게** 끝'])
  })

  test('날짜처럼 쓴 번호(네 자리)는 번호 목록이 되지 않고 친 그대로 보낸다', async ({ authenticatedPage: page }) => {
    const sends = await stubChannel(page)
    await page.goto('/chat/channels/1')
    const input = page.getByTestId('message-composer-input')
    await input.click()
    await page.keyboard.type('2026. 10. 30. 배포')
    await expect(input.locator('ol')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect.poll(() => sends.bodies().map((b) => (b as { body: string }).body)).toEqual(['2026. 10. 30. 배포'])
  })

  test('링크 — 고른 글에 주소를 걸면 [글](주소), 위험한 주소는 막는다', async ({ authenticatedPage: page }) => {
    const sends = await stubChannel(page)
    await page.goto('/chat/channels/1')
    const input = page.getByTestId('message-composer-input')
    await input.click()
    await page.getByTestId('message-composer-input-format').click()
    await page.keyboard.type('설계 문서')
    // '문서' 두 글자를 고른다.
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.getByTestId('message-composer-input-format-link').click()
    const url = page.getByTestId('message-composer-input-format-link-input')
    await url.fill('javascript:alert(1)')
    await page.getByTestId('message-composer-input-format-link-apply').click()
    await expect(page.getByTestId('message-composer-input-format-link-error')).toHaveText('올바른 링크 주소를 입력하세요')
    await url.fill('docs.example.com/a_b')
    await page.getByTestId('message-composer-input-format-link-apply').click()
    await expect(page.getByTestId('message-composer-input-format-link-popover')).toHaveCount(0)
    await expect(page.getByTestId('message-composer-input-format-link')).toHaveAttribute('aria-pressed', 'true')
    await expect(input).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => sends.bodies().map((b) => (b as { body: string }).body)).toEqual(['설계 [문서](https://docs.example.com/a_b)'])
  })

  test('서식 메시지는 서식으로, 예전 평문 메시지는 예전처럼 그린다', async ({ authenticatedPage: page }) => {
    await stubChannel(page)
    await page.goto('/chat/channels/1')
    const fmt = page.getByTestId('message-body-31')
    await expect(fmt.locator('strong')).toHaveText('배포')
    await expect(fmt.locator('u')).toHaveText('금요일')
    await expect(fmt.locator('del')).toHaveText('목요일')
    await expect(fmt.locator('del')).toHaveCSS('text-decoration-line', 'line-through')
    await expect(fmt.locator('code').first()).toHaveText('v1.2')
    await expect(fmt.locator('ul > li')).toHaveText(['빌드', '검증'])
    await expect(fmt.locator('pre')).toHaveText('kubectl rollout status')

    const legacy = page.getByTestId('message-body-30')
    // 들여쓰기·줄바꿈·밑줄 문자·#·URL 괄호는 글자 그대로(코드 블록·제목·기울임 아님).
    await expect(legacy).toContainText('예전 메시지\n    들여쓴 줄 a_b 2*3 #해시')
    await expect(legacy.locator('pre, h1, em, strong')).toHaveCount(0)
    // `- ` 로 시작한 줄은 이제 목록으로 보인다(글자는 그대로). 바로 다음 줄은 마크다운 규칙대로 그 항목에 이어진다.
    await expect(legacy.locator('ul > li')).toHaveText([/^이건 목록으로 보인다\s+https:\/\/a\.com\/x_\(y\)$/])
    await expect(legacy.getByTestId('chat-link')).toHaveAttribute('href', 'https://a.com/x_(y)')

    if (EVIDENCE) {
      await page.getByTestId('message-composer-input').click()
      await page.getByTestId('message-composer-input-format').click()
      await page.keyboard.type('**굵게** 미리 보기')
      await page.screenshot({ path: `${EVIDENCE}/e2e-desktop.png` })
    }
  })

  test('서식 메시지를 수정하면 서식이 복원되고, 고친 그대로 저장된다', async ({ authenticatedPage: page }) => {
    await stubChannel(page)
    await page.goto('/chat/channels/1')
    await page.getByTestId('message-31').hover()
    await page.getByTestId('message-edit-31').click()
    const editor = page.getByTestId('message-editor-input-31')
    await expect(editor.locator('strong')).toHaveText('배포')
    await expect(editor.locator('u')).toHaveText('금요일')
    await expect(editor.locator('li')).toHaveText(['빌드', '검증'])
    await expect(editor.locator('pre')).toHaveText('kubectl rollout status')

    const patch = page.waitForRequest((r) => r.url().endsWith('/api/v1/messaging/messages/31') && r.method() === 'PATCH')
    // 마지막 목록 항목 끝에 덧붙이고 저장 — 나머지 서식은 그대로 돌아온다.
    await editor.locator('li').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 완료')
    await page.keyboard.press('Enter')
    expect(((await patch).postDataJSON() as { body: string }).body).toBe(
      '**배포** 일정은 <u>금요일</u> ~~목요일~~ `v1.2`\n\n- 빌드\n- 검증 완료\n\n```\nkubectl rollout status\n```',
    )
  })
  test('손대지 않은 예전 메시지는 저장해도 보내지 않는다 — 모양만 바뀌어 (수정됨) 이 붙지 않게', async ({ authenticatedPage: page }) => {
    await stubChannel(page)
    const patches = trackRequests(page, 'PATCH', '/api/v1/messaging/messages/32')
    await page.goto('/chat/channels/1')
    await page.getByTestId('message-32').hover()
    await page.getByTestId('message-edit-32').click()
    await expect(page.getByTestId('message-editor-input-32')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('message-editor-32')).toHaveCount(0)
    expect(patches.count()).toBe(0)
  })
})
