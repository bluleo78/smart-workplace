// WP-55 모바일 메모리 결과 줄 — 넘침 없음, 되돌리기 바로 아래 6px 를 탭해도 그 줄을 되돌린다(터치 확장), 줄 간격이 확장보다 넓어 이웃 줄을 가로채지 않는다.
import { ask, setupLiveChat } from '../../fixtures/ai-live-chat'
import { type HomeChatStartBody } from '../../fixtures/home-chat-mock'
import { memoryError, memoryTool, mockMemoryUndo } from '../../fixtures/ai-memory-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { stableBox } from '../../fixtures/wait'

const C = { correlationId: 'corr-a', sessionId: 's-a' }

test('되돌리기 바로 아래 6px 를 탭해도 그 줄을 되돌리고 가로로 넘치지 않는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await ask(page, live, '앞으로는 짧게 답해줘')
  for (const [seq, content] of [[1, '답은 짧게 한다'], [2, '이슈 목록은 담당자만 붙여 보여 준다']] as const) {
    await memoryTool(live, seq, 'remember_memory', { action: 'saved', memoryId: 10 + seq, kind: 'PREFERENCE', content, source: 'AI' })
  }
  await live.push('delta', { ...C, text: '알겠어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 2 })

  const first = page.getByTestId('chat-memory-undo').first()
  await expect(first).toBeEnabled()
  await expectNoHorizontalOverflow(page)
  const a = await stableBox(first)
  const b = await stableBox(page.getByTestId('chat-memory-undo').nth(1))
  expect(b.y - (a.y + a.height), '줄 간격이 위아래 확장(8px×2) 이상').toBeGreaterThanOrEqual(16)
  await page.touchscreen.tap(a.x + a.width / 2, a.y + a.height + 6)
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 2, blockIndex: 0 })
})

// 후속 질문 칩이 바로 아래에 있어도 — 마지막 되돌리기 바로 아래 6px 탭이 칩 확장에 가로채이지 않고 되돌리기로 간다.
test('후속 질문이 아래 있어도 마지막 되돌리기 바로 아래 6px 탭은 후속 질문이 아닌 되돌리기다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await ask(page, live, '앞으로는 짧게 답해줘')
  for (const seq of [1, 2]) {
    await memoryTool(live, seq, 'remember_memory', { action: 'saved', memoryId: 10 + seq, kind: 'PREFERENCE', content: `선호 ${seq}`, source: 'AI' })
  }
  await live.push('delta', { ...C, text: '알겠어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 2 })
  await live.push('followups', { ...C, messageId: 2, items: ['내 이슈 보여줘', '오늘 일정 알려줘'] })

  await expect(page.getByTestId('chat-followup').first()).toBeVisible()
  const lastUndo = page.getByTestId('chat-memory-undo').last()
  await expect(lastUndo).toBeEnabled()
  const a = await stableBox(lastUndo)
  const row = await stableBox(page.getByTestId('chat-followup').first())
  expect(row.y - (a.y + a.height), '마지막 되돌리기 터치 확장(8px)이 후속 질문 행에 닿지 않는다').toBeGreaterThanOrEqual(8)
  await page.touchscreen.tap(a.x + a.width / 2, a.y + a.height + 6)
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 2, blockIndex: 1 })
  expect(live.starts.count(), '후속 질문은 전송되지 않는다').toBe(1)
})

// 모바일 시트(z-60)가 화면을 덮어도 되돌리기 실패 토스트는 그 위에 보이고, 「설정 열기」 액션을 탭할 수 있다(토스트 층 85, WP-55).
test('되돌리기 실패 토스트가 AI 시트 위에 보이고 설정 열기를 탭할 수 있다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockMemoryUndo(page, [memoryError(409, 'AI_MEMORY_FULL')])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await ask(page, live, '앞으로는 짧게 답해줘')
  await memoryTool(live, 1, 'update_memory', { action: 'updated', memoryId: 9, kind: 'CONTEXT', content: '백엔드 팀이다', previousContent: '프론트 팀이다', source: 'AI' })
  await live.push('delta', { ...C, text: '고쳤어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 2 })

  await page.getByTestId('chat-memory-undo').click()
  const action = page.getByRole('button', { name: '설정 열기' })
  await expect(action).toBeVisible()
  // 에러 토스트는 fixture 가 포인터를 통과시킨다 — 실제 화면과 같은 조건(토스트가 맨 위인지)으로 히트테스트하려고 그 규칙을 걷어낸다.
  await page.evaluate(() => document.querySelector('style[data-test-toast-passthrough]')?.remove())
  const box = await stableBox(action)
  const topmostIsToast = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-sonner-toast]') !== null,
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  expect(topmostIsToast, '토스트가 AI 시트에 가려지지 않는다').toBe(true)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page).toHaveURL(/\/settings\/assistant$/)
})

// WP-379: 모바일 채팅 목록 화면에서 보낸 질문은 app=MESSAGING, 범위 결과 줄이 좁은 화면에서 넘치지 않는다.
test('채팅 목록에서 보낸 질문은 app 이 MESSAGING 이고 범위 결과 줄이 넘치지 않는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await ask(page, live, '앞으로 메신저 요약은 세 줄로 해줘')
  expect(live.starts.lastBody<HomeChatStartBody>()?.app).toBe('MESSAGING')

  await memoryTool(live, 1, 'remember_memory', {
    action: 'saved',
    memoryId: 21,
    kind: 'PREFERENCE',
    content: '메신저 대화 요약은 세 줄로 정리해 보여 준다',
    source: 'AI',
    scope: 'MESSAGING',
  })
  await live.push('done', { ...C, widgets: null, messageId: 2 })
  await expect(page.getByTestId('chat-memory-result')).toContainText('메신저 메모리에 저장함')
  await expectNoHorizontalOverflow(page)
})
