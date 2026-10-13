// WP-55 모바일 메모리 결과 줄 — 넘침 없음, 되돌리기 바로 아래 6px 를 탭해도 그 줄을 되돌린다(터치 확장), 줄 간격이 확장보다 넓어 이웃 줄을 가로채지 않는다.
import { ask, setupLiveChat } from '../../fixtures/ai-live-chat'
import { mockMemoryUndo } from '../../fixtures/ai-memory-mock'
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
    await live.push('tool', { ...C, seq, phase: 'start', toolName: 'remember_memory', args: {} })
    await live.push('tool', {
      ...C, seq, phase: 'result', toolName: 'remember_memory', isError: false,
      memory: { action: 'saved', memoryId: 10 + seq, kind: 'PREFERENCE', content, source: 'AI' },
    })
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
