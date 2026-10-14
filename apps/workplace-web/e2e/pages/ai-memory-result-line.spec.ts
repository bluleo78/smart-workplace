// WP-55 채팅 메모리 결과 줄(데스크톱) — 답 아래·후속 질문 위, done 전 되돌리기 비활성, 줄마다 되돌리기, 실패 토스트 3종, 이력 복원, 위임 답 순번,
// 오류·■ 정지로 끝난 턴의 되돌리기(종결 이벤트의 messageId), 긴 문구 줄바꿈. WP-380: 기한 덩어리.
import type { Page } from '@playwright/test'

import { ask, msg, openChatPanel, sessionItem, setupLiveChat, summary, TITLE_A } from '../fixtures/ai-live-chat'
import { memoryError, memoryTool, mockMemoryUndo } from '../fixtures/ai-memory-mock'
import { mockAiPreferences } from '../fixtures/ai-suggestions-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { gate, stableBox } from '../fixtures/wait'

const C = { correlationId: 'corr-a', sessionId: 's-a' }
const lines = (page: Page) => page.getByTestId('chat-memory-result')
const undoLinks = (page: Page) => page.getByTestId('chat-memory-undo')

const saved = { action: 'saved', memoryId: 12, kind: 'PREFERENCE', content: '이슈 목록은 짧은 목록으로 보여 준다', source: 'AI' }
const updated = { action: 'updated', memoryId: 9, kind: 'CONTEXT', content: '백엔드 팀이다', previousContent: '프론트 팀이다', source: 'AI' }
const forgotten = { action: 'forgotten', memoryId: 7, kind: 'PREFERENCE', content: '표로 보여 준다', source: 'USER' }

test('저장 결과 줄이 답 아래·후속 질문 위에 보이고, done 전엔 되돌리기가 꺼져 있다가 누르면 되돌림으로 바뀐다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '앞으로는 이슈 목록을 짧은 목록으로 보여줘')
  await live.push('delta', { ...C, text: '알겠어요. 앞으로 짧은 목록으로 보여 드릴게요.' })
  await memoryTool(live, 1, 'mcp__workplace__remember_memory', saved)

  await expect(lines(page)).toHaveCount(1)
  await expect(lines(page)).toContainText('메모리에 저장함: "이슈 목록은 짧은 목록으로 보여 준다" · 되돌리기')
  await expect(undoLinks(page)).toBeDisabled() // done 전 — 메시지 id 없음
  await expect(page.getByTestId('chat-block-tools')).toHaveCount(0) // 도구 단계 목록에는 없다

  await live.push('done', { ...C, widgets: null, messageId: 2 })
  await live.push('followups', { ...C, messageId: 2, items: ['내 이슈 보여줘'] })
  await expect(undoLinks(page)).toBeEnabled()
  // 되돌리기는 평소에도 링크로 보인다(밑줄 + primary 색, hover 아님) — 터치엔 hover 가 없다. " · 되돌리기" 는 한 덩어리(nowrap)라 "·" 가 줄 끝에 남지 않는다.
  await expect(undoLinks(page)).toHaveCSS('text-decoration-line', 'underline')
  await expect(undoLinks(page).locator('..')).toHaveCSS('white-space', 'nowrap')
  const bubble = await stableBox(page.getByTestId('chat-block').last())
  const line = await stableBox(lines(page).first())
  const chips = await stableBox(page.getByTestId('chat-followups'))
  expect(line.y).toBeGreaterThan(bubble.y + bubble.height - 1)
  expect(chips.y).toBeGreaterThan(line.y + line.height - 1)

  await undoLinks(page).click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 2, blockIndex: 0 })
  await expect(lines(page).first()).toHaveAttribute('data-undone', 'true')
  await expect(lines(page).first()).toContainText('· 되돌림')
  await expect(undoLinks(page)).toHaveCount(0)
})

test('여러 줄은 문구가 동작별로 다르고 줄마다 따로 되돌린다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '정리해줘')
  await memoryTool(live, 1, 'remember_memory', saved)
  await memoryTool(live, 2, 'update_memory', updated)
  await memoryTool(live, 3, 'workplace_forget_memory', forgotten)
  await live.push('delta', { ...C, text: '세 가지를 정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await expect(lines(page)).toHaveCount(3)
  await expect(lines(page).nth(0)).toContainText('메모리에 저장함: "이슈 목록은 짧은 목록으로 보여 준다"')
  await expect(lines(page).nth(1)).toContainText('메모리를 고침: "백엔드 팀이다"')
  await expect(lines(page).nth(2)).toContainText('메모리에서 지움: "표로 보여 준다"')

  await lines(page).nth(1).getByTestId('chat-memory-undo').click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 5, blockIndex: 1 })
  await expect(lines(page).nth(1)).toHaveAttribute('data-undone', 'true')
  await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'false')
  await expect(lines(page).nth(2)).toHaveAttribute('data-undone', 'false')
})

// 패널이 되돌리기 뮤테이션 하나를 공유해도 진행 중 표시는 줄마다 따로다 — 둘째 줄을 빨리 눌러도 첫 줄의 요청 중 잠금이 풀리지 않는다.
test('응답 전에 다른 줄을 눌러도 앞 줄은 요청이 끝날 때까지 잠겨 있다', async ({ authenticatedPage: page }) => {
  const held = gate()
  const undo = await mockMemoryUndo(page, [], held.p)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '정리해줘')
  await memoryTool(live, 1, 'remember_memory', saved)
  await memoryTool(live, 2, 'update_memory', updated)
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  const first = lines(page).nth(0).getByTestId('chat-memory-undo')
  const second = lines(page).nth(1).getByTestId('chat-memory-undo')
  await first.click()
  await expect(first).toBeDisabled()
  await expect(second).toBeEnabled() // 다른 줄은 따로 누를 수 있다
  await second.click()
  await expect(second).toBeDisabled()
  await expect(first).toBeDisabled() // 둘째 요청이 첫 줄의 진행 중 표시를 지우지 않는다
  await expect.poll(() => undo.count()).toBe(2)

  held.release()
  await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'true')
  await expect(lines(page).nth(1)).toHaveAttribute('data-undone', 'true')
})

test('이미 지워진 메모리·가득 참이면 안내 토스트를 띄우고 줄은 그대로 둔다 — 가득 참은 설정으로 이동할 수 있다', async ({ authenticatedPage: page }) => {
  await mockMemoryUndo(page, [memoryError(404, 'AI_MEMORY_GONE'), memoryError(409, 'AI_MEMORY_FULL')])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '정리해줘')
  await memoryTool(live, 1, 'update_memory', updated)
  await memoryTool(live, 2, 'forget_memory', forgotten)
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await lines(page).nth(0).getByTestId('chat-memory-undo').click()
  await expect(page.getByText('이미 지워진 메모리예요')).toBeVisible()
  await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'false')

  await lines(page).nth(1).getByTestId('chat-memory-undo').click()
  await expect(page.getByText('메모리가 가득 찼어요. 설정에서 정리해 주세요')).toBeVisible()
  await expect(lines(page).nth(1)).toHaveAttribute('data-undone', 'false')
  // 에러 토스트는 fixture 가 포인터를 통과시킨다 — 토스트 안의 action 버튼을 누르려면 그 규칙을 먼저 걷어낸다.
  await page.evaluate(() => document.querySelector('style[data-test-toast-passthrough]')?.remove())
  await page.getByRole('button', { name: '설정 열기' }).click()
  await expect(page).toHaveURL(/\/settings\/assistant$/)
})

// CR4: 고친 뒤 또 바뀐 메모리는 서버가 덮지 않고 409 CHANGED 로 거절한다 — 안내 토스트를 띄우고 줄은 되돌리지 않은 채(다시 누를 수 있게) 둔다.
test('고친 뒤 또 바뀐 메모리면 안내 토스트를 띄우고 줄은 그대로 둔다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page, [memoryError(409, 'AI_MEMORY_CHANGED')])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '팀 바꿔줘')
  await memoryTool(live, 1, 'update_memory', { ...updated, previousKind: 'PREFERENCE' })
  await live.push('delta', { ...C, text: '고쳤어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await undoLinks(page).click()
  await undo.waitFor()
  await expect(page.getByText('그 뒤에 바뀐 메모리라 되돌리지 않았어요')).toBeVisible()
  await expect(lines(page).first()).toHaveAttribute('data-undone', 'false')
  await expect(undoLinks(page)).toBeEnabled()
})

// CR3: 오류로 끝난 턴도 서버가 부분 답변을 저장했으면 error 의 messageId 로 되돌리기가 켜진다(다시 열지 않아도).
test('오류로 끝난 턴도 error 의 messageId 로 되돌리기가 켜진다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '기억하고 정리해줘')
  await live.push('delta', { ...C, text: '기억할게요. 이어서' })
  await memoryTool(live, 1, 'remember_memory', saved)
  await expect(undoLinks(page)).toBeDisabled()
  await live.push('error', { ...C, message: 'AI 구성 요청에 실패했어요.', messageId: 6 })

  await expect(undoLinks(page)).toBeEnabled()
  await undoLinks(page).click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 6, blockIndex: 0 })
  await expect(lines(page).first()).toHaveAttribute('data-undone', 'true')
})

// S13: 텍스트 전에 오류로 끝나도 서버가 결과 줄 때문에 답을 저장해 messageId 를 준다 — 안내 문구 아래 결과 줄이 남고 되돌릴 수 있다.
test('텍스트 전에 오류로 끝나도 결과 줄이 남고 error 의 messageId 로 되돌린다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '앞으로는 짧게 답해줘')
  await memoryTool(live, 1, 'remember_memory', saved)
  await live.push('error', { ...C, message: 'AI 구성 요청에 실패했어요.', messageId: 9 })

  await expect(page.getByTestId('chat-panel')).toContainText('응답 생성에 실패했습니다. 다시 시도해 주세요.')
  await expect(lines(page)).toHaveCount(1)
  await expect(undoLinks(page)).toBeEnabled()
  await undoLinks(page).click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 9, blockIndex: 0 })
  await expect(lines(page).first()).toHaveAttribute('data-undone', 'true')
})

// CR3: ■ 로 멈춘 뒤 서버 cancelled 가 저장한 부분 답변 id 를 실어 오면 멈춘 답의 되돌리기가 켜진다.
test('■ 로 멈춘 턴도 cancelled 의 messageId 로 되돌리기가 켜진다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '기억하고 길게 정리해줘')
  await live.push('delta', { ...C, text: '기억할게요. 이어서' })
  await memoryTool(live, 1, 'remember_memory', saved)
  await page.getByTestId('chat-stop').click()
  await expect(page.getByTestId('chat-interrupted')).toHaveText('중단됨')
  await expect(undoLinks(page)).toBeDisabled() // 서버 종결 전 — 아직 저장 id 를 모른다
  await live.push('cancelled', { ...C, reason: 'user', messageId: 7 })

  await expect(undoLinks(page)).toBeEnabled()
  await undoLinks(page).click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 7, blockIndex: 0 })
  await expect(lines(page).first()).toHaveAttribute('data-undone', 'true')
})

test('이력의 결과 줄은 저장된 되돌림 상태로 보이고, 이력의 메시지 id 로 되돌린다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [
    msg(1, 'USER', TITLE_A),
    {
      ...msg(2, 'ASSISTANT', '정리했어요.'),
      // 서버는 memory 블록을 contentBlocks 에서 떼어 memoryBlocks 로 따로 싣는다(배포 중 구 웹 보호) — 웹은 그대로 결과 줄로 쓴다.
      contentBlocks: [{ kind: 'text', textStart: 0 }],
      memoryBlocks: [
        { kind: 'memory', action: 'saved', memoryId: 12, memoryKind: 'PREFERENCE', content: '짧은 목록', source: 'AI', undone: true },
        { kind: 'memory', action: 'forgotten', memoryId: 7, memoryKind: 'PREFERENCE', content: '표로 보여 준다', source: 'USER', undone: false },
      ],
    },
  ])
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(page.getByTestId('chat-panel')).toContainText('정리했어요.')
  await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'true')
  await expect(lines(page).nth(1).getByTestId('chat-memory-undo')).toBeEnabled()
  await lines(page).nth(1).getByTestId('chat-memory-undo').click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 2, blockIndex: 1 })
  await expect(lines(page).nth(1)).toHaveAttribute('data-undone', 'true') // 이력 줄도 되돌림으로 바뀐다
  await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'true') // 이미 되돌린 줄은 그대로
})

// Review Focus 5: 추천을 끈 사용자(followups 없음)도 done 의 messageId 로 되돌리기가 켜지고, 위임 답(안내 문장이 버려지는 턴)에서도 순번 0 이다.
test('추천을 꺼도 done 뒤 되돌리기가 켜지고 위임 답에서도 순번이 맞다', async ({ authenticatedPage: page }) => {
  await mockAiPreferences(page, false)
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '앞으로 이슈는 짧게, 그리고 WP-1 닫아줘')
  await live.push('progress', { ...C, label: '이슈 전문가에게 위임 중' })
  await live.push('delta', { ...C, text: '확인해 볼게요. ' })
  await memoryTool(live, 1, 'remember_memory', saved)
  await live.push('delta', { ...C, text: 'WP-1 을 닫았어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 8 })

  await expect(undoLinks(page)).toBeEnabled()
  await undoLinks(page).click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 8, blockIndex: 0 })
})

test('긴 메모리 문구는 줄바꿈되어 패널 밖으로 넘치지 않는다', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '기억해줘')
  await memoryTool(live, 1, 'remember_memory', { ...saved, content: 'https://example.com/' + 'a'.repeat(280) })
  await live.push('delta', { ...C, text: '기억할게요.' })
  await live.push('done', { ...C, widgets: null, messageId: 2 })
  const line = lines(page).first()
  await expect(line).toBeVisible()
  const overflow = await line.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const panel = await stableBox(page.getByTestId('chat-panel'))
  const box = await stableBox(line)
  expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width)
})

// WP-379: 앱 범위 결과는 범위 이름을 붙인 문구로, 공통은 WP-55 문구 그대로. 되돌리기 가득 참은 서버가 알려 준 범위로 안내한다.
test('앱 범위 결과 줄은 "이슈 메모리에 저장함" 이고, 되돌리기 가득 참은 그 범위 이름으로 안내한다', async ({ authenticatedPage: page }) => {
  await mockMemoryUndo(page, [memoryError(409, 'AI_MEMORY_FULL', '오류', { scope: 'MAIL' })])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '정리해줘')
  await memoryTool(live, 1, 'remember_memory', { ...saved, scope: 'ISSUE' })
  await memoryTool(live, 2, 'update_memory', { ...updated, scope: null, previousScope: 'ISSUE' })
  await memoryTool(live, 3, 'forget_memory', { ...forgotten, scope: 'MAIL' })
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await expect(lines(page).nth(0)).toContainText('이슈 메모리에 저장함: "이슈 목록은 짧은 목록으로 보여 준다"')
  await expect(lines(page).nth(1)).toContainText('메모리를 고침: "백엔드 팀이다"')
  await expect(lines(page).nth(2)).toContainText('메일 메모리에서 지움: "표로 보여 준다"')

  await lines(page).nth(2).getByTestId('chat-memory-undo').click()
  await expect(page.getByText('메일 메모리가 가득 찼어요. 설정에서 정리해 주세요')).toBeVisible()
  await expect(lines(page).nth(2)).toHaveAttribute('data-undone', 'false')
})

test.describe('기한 (WP-380)', () => {
  test.use({ timezoneId: 'Asia/Seoul' })

  test('기한 있는 결과 줄은 " · 10월 24일까지", 지움 줄엔 없고, 되돌리면 기한도 취소선이다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T03:00:00Z'))
    await mockMemoryUndo(page)
    const live = await setupLiveChat(page)
    live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
    await openChatPanel(page)
    await ask(page, live, '이번 주는 결제 모듈만 볼 거야')
    await memoryTool(live, 1, 'remember_memory', { ...saved, content: '이번 주는 결제 모듈 집중', scope: 'ISSUE', expiresOn: '2026-10-24' })
    await memoryTool(live, 2, 'forget_memory', { ...forgotten, expiresOn: '2026-10-20' })
    await live.push('delta', { ...C, text: '기억할게요.' })
    await live.push('done', { ...C, widgets: null, messageId: 5 })

    await expect(lines(page).nth(0)).toContainText('이슈 메모리에 저장함: "이번 주는 결제 모듈 집중" · 10월 24일까지 · 되돌리기')
    await expect(lines(page).nth(0).getByTestId('chat-memory-expiry')).toHaveCSS('white-space', 'nowrap')
    await expect(lines(page).nth(1).getByTestId('chat-memory-expiry')).toHaveCount(0)

    await lines(page).nth(0).getByTestId('chat-memory-undo').click()
    await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'true')
    await expect(lines(page).nth(0).getByTestId('chat-memory-expiry').locator('..')).toHaveCSS('text-decoration-line', 'line-through')
  })
})
